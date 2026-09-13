/**
 * 角色卡（车卡）路由 —— 本站车卡系统的服务端。
 *
 *   GET    /api/characters                    角色卡列表（本人；管理员可查全部）
 *   POST   /api/characters                    新建角色卡
 *   GET    /api/characters/:id                角色卡详情（含服务端权威派生数据）
 *   PUT    /api/characters/:id                更新角色卡（全量）
 *   DELETE /api/characters/:id                删除角色卡
 *   POST   /api/characters/:id/modules        关联跑团模组（写入「经历」）
 *   DELETE /api/characters/:id/modules/:mid   解除模组关联
 *   POST   /api/characters/:id/duplicate      复制一张角色卡
 *   GET    /api/characters/meta               车卡规则元数据（技能表/职业表/年龄补正）
 *
 * 权限模型（最小权限）：
 *   - 玩家只能读写自己的角色卡。
 *   - 管理员（KP）可以读写全部角色卡，用于统一管理、批量打印与代改。
 *   - 其他玩家仅能读取被标记为 isPublic 的角色卡（只读），默认全部私有。
 *
 * 数据可信性：
 *   - 存储的只有「玩家输入」（属性、技能点投入、背景、经历…）。
 *   - HP/MP/SAN/MOV/伤害加值/体格/技能成功率/点数余额等一律由 shared/coc7e.js
 *     在每次读写时重新计算后下发，客户端无法通过伪造字段获得不当数值。
 */

import { Router } from 'express';
import {
  db, save, findCharacterById, findUserById, findModuleById, publicUser, newId,
  customOccupations, reviewsOf,
} from '../lib/db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireAuth, requireAdmin, optionalAuth } from '../lib/auth.js';
import { parseCharacter, parseReview, parseBatchReview, vArray, vEnum, vId, vStr } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import {
  ALL_CHARS, CHARS, STATUSES, REVIEW_STATUSES, computeSheet, validateSheet, blankSkills, auditSheet,
  DEFAULT_AUDIT_RULES, blankLegendary, blankLegendaryBonus,
} from '../../shared/coc7e.js';

const router = Router();

/**
 * KP 专属字段：只有管理员能改。
 * 玩家自己保存（PUT/PATCH）或自建卡（POST）时，这些字段一律沿用存档原值 / 默认值，
 * 否则玩家可以自己给自己开传奇标记、免掉年龄减益。
 */
const KP_ONLY_FIELDS = ['legendary', 'legendaryBonus', 'agePenaltyWaived'];

function defaultKpOnly(field) {
  if (field === 'legendary') return blankLegendary();
  if (field === 'legendaryBonus') return blankLegendaryBonus();
  return false;
}

/**
 * 传奇标记的「谁在什么时候开的」由服务端盖章：
 * 客户端可以传，但为空时补上当前管理员与时间；关闭时清空，审计上不会留下假的操作人。
 */
function stampLegendary(data, actor) {
  if (!data.legendary) return data;
  if (data.legendary.enabled === true) {
    if (!data.legendary.at) data.legendary.at = Date.now();
    if (!data.legendary.by) data.legendary.by = actor?.username || '';
  } else {
    data.legendary.at = 0;
    data.legendary.by = '';
  }
  return data;
}

/**
 * 教育增强「首次结算后锁定」的服务端兜底（方案 C）。
 *
 *  - 从没结算过 → 放行（玩家可以自己掷第一次 / 手动补录）；
 *  - 已经结算过且有 KP 授权（granted > 0）→ 放行，并消耗一次授权；
 *  - 已经结算过且没有授权 → **忽略提交的 eduBonus / eduGrowth，保留存档值**。
 *
 * 这样玩家即使绕过界面直接发请求，也无法自助重掷或清零；重置只能由 KP 执行。
 */
function guardEduGrowth(data, actor, current) {
  if (actor?.role === 'admin') return data;
  const cur = current?.eduGrowth;
  const curBonus = Number(current?.eduBonus) || 0;
  const settled = cur?.settled === true || curBonus > 0;
  if (!settled) {
    // 首次结算：不允许夹带「授权」或伪造历史流水
    if (data.eduGrowth) {
      data.eduGrowth.granted = 0;
      data.eduGrowth.attempts = (data.eduGrowth.attempts || []).slice(-1);
      if (data.eduGrowth.attempts[0]) {
        data.eduGrowth.attempts[0].via = data.eduGrowth.manual ? 'manual' : 'roll';
      }
      data.eduGrowth.lastGrant = null;
      data.eduGrowth.lastReset = null;
    }
    return data;
  }
  const granted = Number(cur?.granted) || 0;
  if (granted > 0) {
    if (data.eduGrowth) {
      data.eduGrowth.granted = granted - 1;
      // 保留 KP 的授权/重置痕迹，只允许追加一条新流水
      data.eduGrowth.lastGrant = cur?.lastGrant || null;
      data.eduGrowth.lastReset = cur?.lastReset || null;
      data.eduGrowth.attempts = [...(cur?.attempts || []), ...(data.eduGrowth.attempts || []).slice(-1)];
      const last = data.eduGrowth.attempts[data.eduGrowth.attempts.length - 1];
      if (last) last.via = data.eduGrowth.manual ? 'manual' : 'reroll';
    }
    return data;
  }
  // 已锁定：数值与记录都还原成存档值
  if ('eduBonus' in data) data.eduBonus = curBonus;
  if ('eduGrowth' in data || data.eduBonus !== undefined) data.eduGrowth = cur;
  return data;
}

function guardKpOnlyFields(data, actor, current) {
  if (actor?.role === 'admin') return data;
  for (const f of KP_ONLY_FIELDS) {
    if (!(f in data)) continue;
    data[f] = current && current[f] !== undefined ? current[f] : defaultKpOnly(f);
  }
  return data;
}

// ------------------------------------------------------------------ 元数据
/**
 * 车卡参考数据。**允许访客只读访问**（可选登录）：
 * 访客也要求能车卡，需要职业模板与模组列表；这里不返回任何用户隐私数据。
 */
router.get('/characters/meta', optionalAuth, (req, res) => {
  const database = db();
  const me = req.user || null;
  res.json({
    statuses: STATUSES,
    reviewStatuses: REVIEW_STATUSES,
    chars: ALL_CHARS,
    customOccupations: database.customOccupations,
    moduleOptions: database.modules.map((m) => ({
      id: m.id, title: m.title, region: m.region, era: m.era, series: m.series || '',
    })),
    owners: me && me.role === 'admin' ? database.users.map((u) => publicUser(u)) : (me ? [publicUser(me)] : []),
    stats: me ? {
      total: database.characters.length,
      mine: database.characters.filter((c) => c.ownerId === me.id).length,
    } : null,
  });
});

router.use(requireAuth);

// ------------------------------------------------------------------ 工具
function knownModuleIds() {
  return new Set(db().modules.map((m) => m.id));
}

/** 规则引擎上下文：把 KP 自定义职业模板喂进去，前后端算法才会一致 */
function rulesCtx() {
  return { customOccupations: customOccupations() };
}

/** KP 当前的辅助审卡规则 */
function auditRules() {
  return { ...DEFAULT_AUDIT_RULES, ...(db().settings?.auditRules || {}) };
}

function ownerNameOf(ownerId) {
  const u = findUserById(ownerId);
  return u ? u.username : '（已注销）';
}

/** 拼装对外的角色卡对象：存档 + 服务端派生 + 关联的模组标题 */
function present(character, { actor, full = true }) {
  const links = (character.moduleLinks || []).map((l) => {
    const m = findModuleById(l.moduleId);
    return { ...l, moduleTitle: m ? m.title : '（模组已删除）', moduleRegion: m?.region || '', moduleEra: m?.era || '' };
  });
  const ctx = rulesCtx();
  const derived = computeSheet(character, ctx);
  const warnings = validateSheet(character, ctx);
  const canEdit = actor.role === 'admin' || actor.id === character.ownerId;
  const isAdmin = actor.role === 'admin';

  // 审核信息：批复只存在 reviews 集合里，**不属于角色卡本体**，因此不会被打印导出。
  const history = (isAdmin || canEdit) ? reviewsOf(character.id) : [];
  const latest = history[0] || null;
  const reviewStatus = character.reviewStatus || 'none';
  const review = {
    status: reviewStatus,
    submittedAt: character.submittedAt || null,
    reviewedAt: latest?.createdAt || null,
    reviewedByName: latest?.kpName || null,
    // 通过即清空批复；仅驳回时把说明回显给玩家
    comment: reviewStatus === 'rejected' ? (latest?.comment || '') : '',
  };
  const head = {
    id: character.id,
    ownerId: character.ownerId,
    ownerName: ownerNameOf(character.ownerId),
    name: character.name,
    playerName: character.playerName,
    occupationId: character.occupationId,
    age: character.age,
    era: character.era,
    status: character.status,
    isPublic: Boolean(character.isPublic),
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
    canEdit,
    isOwner: actor.id === character.ownerId,
    canReview: isAdmin,
    reviewStatus,
    review,
  };

  if (!full) {
    return {
      ...head,
      occupationName: derived.occupation?.name || '无职业',
      hp: derived.hp, san: derived.san, mov: derived.mov,
      skillCount: derived.skills.filter((s) => s.used).length,
      customSkillCount: derived.customSkillCount,
      moduleCount: links.length,
      spent: derived.spent,
      budget: derived.budget,
      warningCount: warnings.length,
      // 列表页也要能一眼看到「传奇 / 年龄豁免 / 教育成长」，KP 才能不下钻就审：
      legendary: derived.legendary,
      legendaryBonus: derived.legendaryBonus,
      legendaryBonusTotal: CHARS.reduce((a, k) => a + (derived.legendaryBonus[k] || 0), 0),
      agePenaltyWaived: derived.waiveAgePenalty,
      ageAdjust: {
        eduChecks: derived.ageAdjust.eduChecks,
        eduBonus: derived.ageAdjust.eduBonus,
        settled: derived.ageAdjust.settled,
        waived: derived.ageAdjust.waived,
      },
      eduGrowth: derived.eduGrowth,
    };
  }

  // 完整存档：编辑器需要全部"玩家输入"，派生值一律走 derived
  return {
    ...head,
    gender: character.gender || '',
    residence: character.residence || '',
    birthplace: character.birthplace || '',
    chars: derived.raw,
    eduBonus: derived.ageAdjust.eduBonus,
    eduGrowth: derived.eduGrowth,
    applyAgeAdjust: derived.ageAdjust.apply,
    ageAlloc: character.ageAlloc || {},
    legendary: derived.legendary,
    legendaryBonus: derived.legendaryBonus,
    agePenaltyWaived: derived.waiveAgePenalty,
    notes: character.notes || '',
    armorPenalty: character.armorPenalty || 0,
    occPicks: character.occPicks || { free: [], social: [], choices: [] },
    skills: (character.skills || []).map((s) => ({
      id: s.id, key: s.key, custom: s.custom || '', occ: s.occ || 0, interest: s.interest || 0, growth: s.growth || 0,
    })),
    customSkills: (character.customSkills || []).map((s) => ({
      id: s.id, name: s.name, base: s.base || 0, occ: s.occ || 0,
      interest: s.interest || 0, growth: s.growth || 0, isOccupation: Boolean(s.isOccupation),
    })),
    weapons: character.weapons || [],
    equipment: character.equipment || '',
    currency: character.currency || 'USD',
    extraAssets: character.extraAssets || '',
    skillMarks: character.skillMarks || {},
    background: character.background || {},
    experience: character.experience || '',
    moduleLinks: links,
    derived,
    warnings,
    audit: isAdmin ? auditSheet(character, auditRules(), ctx) : null,
    reviewHistory: isAdmin ? history.slice(0, 10) : [],
  };
}

/** 读取权限判定 */
function loadReadable(req) {
  const id = vId(req.params.id, '角色卡');
  const c = findCharacterById(id);
  if (!c) throw notFound('角色卡不存在');
  const isOwner = c.ownerId === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin && !c.isPublic) {
    audit(req, 'character.read_denied', { characterId: id });
    throw forbidden('该角色卡未公开');
  }
  return { c, isOwner, isAdmin };
}

/** 写入权限判定 */
function loadWritable(req) {
  const id = vId(req.params.id, '角色卡');
  const c = findCharacterById(id);
  if (!c) throw notFound('角色卡不存在');
  if (req.user.role !== 'admin' && c.ownerId !== req.user.id) {
    audit(req, 'character.write_denied', { characterId: id });
    throw forbidden('只能修改自己的角色卡');
  }
  return c;
}

/** 派生字段摘要，用于审计留痕（不记录整张卡，避免日志膨胀） */
function digest(c) {
  const d = computeSheet(c);
  return { name: c.name, occupation: d.occupation?.name || '', hp: d.hp, san: d.san, mov: d.mov };
}

// ------------------------------------------------------------------ 列表
router.get('/characters', (req, res) => {
  const database = db();
  const isAdmin = req.user.role === 'admin';
  const mineOnly = req.query.scope !== 'all' || !isAdmin;

  let list = database.characters;
  if (mineOnly) {
    list = list.filter((c) => c.ownerId === req.user.id);
  } else if (typeof req.query.ownerId === 'string' && req.query.ownerId) {
    const ownerId = vId(req.query.ownerId, '所属玩家', { required: false });
    list = list.filter((c) => c.ownerId === ownerId);
  }
  if (typeof req.query.status === 'string' && req.query.status) {
    const status = vEnum(req.query.status, '状态', STATUSES, 'active');
    list = list.filter((c) => c.status === status);
  }
  if (typeof req.query.moduleId === 'string' && req.query.moduleId) {
    const mid = vId(req.query.moduleId, '模组', { required: false });
    list = list.filter((c) => (c.moduleLinks || []).some((l) => l.moduleId === mid));
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40).toLowerCase() : '';
  if (q) {
    list = list.filter((c) => `${c.name} ${c.playerName} ${ownerNameOf(c.ownerId)}`.toLowerCase().includes(q));
  }
  const sorted = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json({
    total: sorted.length,
    scope: mineOnly ? 'mine' : 'all',
    items: sorted.map((c) => present(c, { actor: req.user, full: false })),
  });
});

// ------------------------------------------------------------------ 新建
router.post('/characters', (req, res) => {
  // 管理员可以代玩家建卡（用于面团代录），但 ownerId 必须真实存在
  let ownerId = req.user.id;
  if (req.user.role === 'admin' && req.body?.ownerId) {
    const target = vId(req.body.ownerId, '所属玩家');
    if (!findUserById(target)) throw badRequest('指定的玩家不存在');
    ownerId = target;
  }
  const data = guardKpOnlyFields(
    parseCharacter(req.body, { knownModuleIds: knownModuleIds(), ctx: rulesCtx() }),
    req.user,
    null,
  );
  const now = Date.now();
  const character = {
    id: newId('c'),
    ownerId,
    ...data,
    skills: data.skills && data.skills.length ? data.skills : blankSkills(),
    createdAt: now,
    updatedAt: now,
  };
  db().characters.push(character);
  save();
  audit(req, 'character.create', { characterId: character.id, ownerId, ...digest(character) });
  res.json(present(character, { actor: req.user }));
});

// ------------------------------------------------------------------ 详情
router.get('/characters/:id', (req, res) => {
  const { c, isAdmin, isOwner } = loadReadable(req);
  const out = present(c, { actor: req.user });
  out.canEdit = isAdmin || isOwner;
  res.json(out);
});

// ------------------------------------------------------------------ 更新
// PUT  = 全量替换（车卡编辑器保存整张卡时使用）
router.put('/characters/:id', (req, res) => {
  const c = loadWritable(req);
  // 归属不可被改写：即使管理员代改，也不会把卡转移到别人名下
  // current 传入存档：请求体没带的字段（如「模组经历」）沿用存档值，而不是被当成清空
  const data = stampLegendary(guardEduGrowth(guardKpOnlyFields(
    parseCharacter(req.body, {
      knownModuleIds: knownModuleIds(), current: c, ctx: rulesCtx(),
    }),
    req.user,
    c,
  ), req.user, c), req.user);
  delete data.ownerId;
  Object.assign(c, data, { updatedAt: Date.now() });
  // 卡片内容变了，已通过的审核即失效；驳回意见保留到玩家重新提交
  if (c.reviewStatus === 'approved') c.reviewStatus = 'none';
  save();
  audit(req, 'character.update', { characterId: c.id, ownerId: c.ownerId, ...digest(c) });
  res.json(present(c, { actor: req.user }));
});

// PATCH = 局部更新（列表里切换状态/公开性、KP 批量改归属等轻量操作）
router.patch('/characters/:id', (req, res) => {
  const c = loadWritable(req);
  const data = stampLegendary(guardEduGrowth(guardKpOnlyFields(
    parseCharacter(req.body, {
      partial: true, knownModuleIds: knownModuleIds(), current: c, ctx: rulesCtx(),
    }),
    req.user,
    c,
  ), req.user, c), req.user);
  delete data.ownerId;
  if (req.user.role === 'admin' && typeof req.body?.ownerId === 'string' && req.body.ownerId) {
    const target = vId(req.body.ownerId, '所属玩家');
    if (!findUserById(target)) throw badRequest('指定的玩家不存在');
    c.ownerId = target;
  }
  Object.assign(c, data, { updatedAt: Date.now() });
  if (c.reviewStatus === 'approved') c.reviewStatus = 'none';
  save();
  audit(req, 'character.patch', { characterId: c.id, fields: Object.keys(data) });
  res.json(present(c, { actor: req.user }));
});

router.delete('/characters/:id', (req, res) => {
  const c = loadWritable(req);
  const database = db();
  database.characters = database.characters.filter((x) => x.id !== c.id);
  save();
  audit(req, 'character.delete', { characterId: c.id, ownerId: c.ownerId, name: c.name });
  res.json({ success: true });
});

router.post('/characters/:id/duplicate', (req, res) => {
  const { c, isOwner, isAdmin } = loadReadable(req);
  if (!isOwner && !isAdmin) throw forbidden('只能复制自己的角色卡');
  const now = Date.now();
  const copy = {
    ...JSON.parse(JSON.stringify(c)),
    id: newId('c'),
    ownerId: req.user.role === 'admin' && req.body?.ownerId ? vId(req.body.ownerId, '所属玩家') : req.user.id,
    name: `${vStr(req.body?.name, '角色名', { max: 40 }) || c.name}（副本）`.slice(0, 40),
    createdAt: now,
    updatedAt: now,
  };
  db().characters.push(copy);
  save();
  audit(req, 'character.duplicate', { from: c.id, characterId: copy.id });
  res.json(present(copy, { actor: req.user }));
});

// ------------------------------------------------------------------ 模组经历
router.post('/characters/:id/modules', (req, res) => {
  const c = loadWritable(req);
  const moduleId = vId(req.body?.moduleId, '模组');
  const mod = findModuleById(moduleId);
  if (!mod) throw notFound('找不到该模组，请先在档案馆收录');
  const links = c.moduleLinks || (c.moduleLinks = []);
  if (links.length >= 60) throw badRequest('关联的模组过多（上限 60 个）');
  const item = {
    moduleId,
    role: vEnum(req.body?.role, '参与身份', ['PC', 'NPC', 'KP', '旁观'], 'PC'),
    date: typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : '',
    note: vStr(req.body?.note, '经历备注', { max: 200 }),
  };
  const exist = links.findIndex((l) => l.moduleId === moduleId);
  if (exist >= 0) links[exist] = item; else links.push(item);
  c.updatedAt = Date.now();
  save();
  audit(req, 'character.link_module', { characterId: c.id, moduleId, role: item.role });
  res.json(present(c, { actor: req.user }));
});

router.delete('/characters/:id/modules/:moduleId', (req, res) => {
  const c = loadWritable(req);
  const moduleId = vId(req.params.moduleId, '模组');
  const before = (c.moduleLinks || []).length;
  c.moduleLinks = (c.moduleLinks || []).filter((l) => l.moduleId !== moduleId);
  if (c.moduleLinks.length === before) throw notFound('该角色卡没有关联此模组');
  c.updatedAt = Date.now();
  save();
  audit(req, 'character.unlink_module', { characterId: c.id, moduleId });
  res.json(present(c, { actor: req.user }));
});

// ------------------------------------------------------------------ 审核流程
/**
 * 提交审核：玩家（或 KP）把角色卡送去给 KP 过目。
 * 审核状态与批复都**不进入角色卡本体**，因此打印导出时不会出现。
 */
router.post('/characters/:id/submit', (req, res) => {
  const c = loadWritable(req);
  if ((c.reviewStatus || 'none') === 'pending') throw badRequest('这张角色卡已经在审核队列里了');
  c.reviewStatus = 'pending';
  c.submittedAt = Date.now();
  c.updatedAt = Date.now();
  save();
  audit(req, 'character.submit_review', { characterId: c.id, ownerId: c.ownerId, ...digest(c) });
  res.json(present(c, { actor: req.user }));
});

/** 撤回审核 */
router.post('/characters/:id/withdraw', (req, res) => {
  const c = loadWritable(req);
  if ((c.reviewStatus || 'none') !== 'pending') throw badRequest('只有审核中的角色卡可以撤回');
  c.reviewStatus = 'none';
  c.submittedAt = null;
  c.updatedAt = Date.now();
  save();
  audit(req, 'character.withdraw_review', { characterId: c.id });
  res.json(present(c, { actor: req.user }));
});

/**
 * KP 批复：通过 / 驳回。
 *  - 通过：清空批复（不留意见），只记录审核人与时间。
 *  - 驳回：必须写明理由；理由存在 reviews 集合里，玩家在详情页能看到，但不进角色卡、不打印。
 */
router.post('/characters/:id/review', requireAdmin, (req, res) => {
  const id = vId(req.params.id, '角色卡');
  const c = findCharacterById(id);
  if (!c) throw notFound('角色卡不存在');
  const { verdict, comment } = parseReview(req.body);
  const ctx = rulesCtx();
  const rules = auditRules();
  const result = auditSheet(c, rules, ctx);
  const now = Date.now();

  db().reviews.push({
    id: newId('rv'),
    characterId: c.id,
    kpId: req.user.id,
    kpName: req.user.username,
    verdict,
    comment: verdict === 'rejected' ? comment : '',
    stats: result.stats,
    findings: result.findings.map((f) => ({ id: f.id, level: f.level, detail: f.detail })),
    createdAt: now,
  });
  c.reviewStatus = verdict === 'approved' ? 'approved' : 'rejected';
  c.reviewedAt = now;
  c.reviewedBy = req.user.id;
  c.updatedAt = now;
  save();
  audit(req, `character.review_${verdict}`, {
    characterId: c.id, ownerId: c.ownerId, findings: result.findings.length,
  });
  res.json(present(c, { actor: req.user }));
});

/** 审核队列（KP）：默认只列待审核的卡 */
router.get('/admin/reviews', requireAdmin, (req, res) => {
  const status = typeof req.query.status === 'string' && REVIEW_STATUSES.includes(req.query.status)
    ? req.query.status
    : 'pending';
  const list = db().characters
    .filter((c) => (c.reviewStatus || 'none') === status)
    .sort((a, b) => (a.submittedAt || a.updatedAt || 0) - (b.submittedAt || b.updatedAt || 0));
  res.json({
    status,
    total: list.length,
    items: list.map((c) => present(c, { actor: req.user, full: false })),
  });
});

/** KP 辅助审卡：批量（默认审所有待审核的卡，也可指定玩家 / 状态） */
router.post('/admin/audit/batch', requireAdmin, (req, res) => {
  const scope = typeof req.body?.scope === 'string' ? req.body.scope : 'pending';
  const status = typeof req.body?.status === 'string' ? req.body.status : '';
  const ownerId = typeof req.body?.ownerId === 'string' && req.body.ownerId
    ? vId(req.body.ownerId, '所属玩家', { required: false }) : '';
  const rules = auditRules();
  const ctx = rulesCtx();

  let list = db().characters;
  if (scope === 'manual') {
    // 手动勾选：只审 KP 指定的这些卡
    const ids = vArray(req.body?.characterIds, '角色卡', { max: 200 })
      .map((x) => vId(x, '角色卡', { required: false })).filter(Boolean);
    if (!ids.length) throw badRequest('手动模式下请至少勾选一张角色卡');
    const wanted = new Set(ids);
    list = list.filter((c) => wanted.has(c.id));
  } else if (scope === 'pending') {
    list = list.filter((c) => (c.reviewStatus || 'none') === 'pending');
  } else if (scope === 'owner' && ownerId) {
    list = list.filter((c) => c.ownerId === ownerId);
  }
  if (status && STATUSES.includes(status)) list = list.filter((c) => c.status === status);

  const results = list.map((c) => ({
    characterId: c.id,
    name: c.name,
    ownerName: ownerNameOf(c.ownerId),
    reviewStatus: c.reviewStatus || 'none',
    updatedAt: c.updatedAt,
    ...auditSheet(c, rules, ctx),
  }));
  audit(req, 'admin.audit_batch', {
    scope, count: results.length, failed: results.filter((r) => !r.passed).length,
  });
  res.json({
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    rules,
    items: results,
  });
});

/**
 * KP 批量批复：对选中的角色卡一次性通过 / 驳回。
 * 用于「批量审卡 → 人工确认 → 打上通过标签」的流程。
 */
router.post('/admin/reviews/batch', requireAdmin, (req, res) => {
  const { verdict, comment, characterIds } = parseBatchReview(req.body);
  const database = db();
  const now = Date.now();
  const done = [];
  const skipped = [];
  for (const id of characterIds) {
    const c = findCharacterById(id);
    if (!c) { skipped.push({ id, reason: '角色卡不存在' }); continue; }
    if (verdict === 'approved' && (c.reviewStatus || 'none') === 'approved') {
      skipped.push({ id, name: c.name, reason: '已经是通过状态' });
      continue;
    }
    database.reviews.push({
      id: newId('rv'),
      characterId: c.id,
      kpId: req.user.id,
      kpName: req.user.username,
      verdict,
      comment: verdict === 'rejected' ? comment : '',
      stats: auditSheet(c, auditRules(), rulesCtx()).stats,
      findings: [],
      batch: true,
      createdAt: now,
    });
    c.reviewStatus = verdict === 'approved' ? 'approved' : 'rejected';
    c.reviewedAt = now;
    c.reviewedBy = req.user.id;
    c.updatedAt = now;
    done.push({ id: c.id, name: c.name, ownerId: c.ownerId });
  }
  save();
  audit(req, `admin.review_batch_${verdict}`, { requested: characterIds.length, done: done.length });
  res.json({ success: true, verdict, reviewed: done.length, skipped, items: done });
});

/** KP 辅助审卡：单张（注意：必须注册在 /audit/batch 之后，否则 batch 会被当成 id） */
router.post('/admin/audit/:id', requireAdmin, (req, res) => {
  const id = vId(req.params.id, '角色卡');
  const c = findCharacterById(id);
  if (!c) throw notFound('角色卡不存在');
  const rules = auditRules();
  res.json({
    characterId: c.id,
    name: c.name,
    ownerName: ownerNameOf(c.ownerId),
    rules,
    ...auditSheet(c, rules, rulesCtx()),
  });
});

export default router;
