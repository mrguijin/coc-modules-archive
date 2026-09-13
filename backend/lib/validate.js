/**
 * 输入校验与白名单。
 *
 * 原则（最小权限 / 永不信任客户端）：
 *  - 每个写接口都用**显式字段白名单**重建对象，绝不 `{...req.body}` 直接入库 ——
 *    这样客户端无法凭空塞入 id / role / createdAt 等非授权字段（原实现的越权写入漏洞即源于此）。
 *  - 所有字符串长度、数值区间、枚举值都在这里收口；越界即 400，不做"尽力而为"的兜底。
 *  - 错误信息只说明"哪个字段不合法"，不泄露内部结构。
 */

import { badRequest } from './errors.js';
import {
  ALL_CHARS, CHARS, ERAS, STATUSES, MODULE_ROLES, REVIEW_STATUSES, CHAR_MIN, CHAR_MAX,
  SKILL_CAP, CUSTOM_SKILL_MAX, SKILL_BY_KEY, SKILLS, SPEC_SLOTS, SOCIAL_SKILLS,
  OCCUPATION_BY_ID, blankSkills, blankWeapons, DEFAULT_AUDIT_RULES, AUDIT_RULE_META,
  currenciesFor, DEFAULT_CURRENCY, BUILTIN_WEAPON, WEAPON_BY_NAME,
  blankEduGrowth, normalizeEduGrowth, blankLegendary, normalizeLegendary,
  blankLegendaryBonus,
} from '../../shared/coc7e.js';

const ID_RE = /^[A-Za-z0-9_-]{1,48}$/;

export function vId(value, field, { required = true } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    if (required) throw badRequest(`${field}不能为空`);
    return '';
  }
  if (!ID_RE.test(s)) throw badRequest(`${field}格式不合法`);
  return s;
}

export function vStr(value, field, { min = 0, max = 200, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field}不能为空`);
    return '';
  }
  if (typeof value !== 'string') throw badRequest(`${field}必须是文本`);
  const s = value.trim();
  if (required && !s) throw badRequest(`${field}不能为空`);
  if (s.length < min) throw badRequest(`${field}至少需要 ${min} 个字符`);
  if (s.length > max) throw badRequest(`${field}最多 ${max} 个字符`);
  return s;
}

/** 多行文本：保留换行，只做长度与类型约束 */
export function vText(value, field, { max = 2000 } = {}) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw badRequest(`${field}必须是文本`);
  const s = value.replace(/\r\n/g, '\n').trim();
  if (s.length > max) throw badRequest(`${field}最多 ${max} 个字符`);
  return s;
}

export function vInt(value, field, { min = 0, max = 100, def = 0 } = {}) {
  if (value === undefined || value === null || value === '') return def;
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${field}必须是数字`);
  const t = Math.trunc(n);
  if (t < min || t > max) throw badRequest(`${field}必须在 ${min}-${max} 之间`);
  return t;
}

export function vNum(value, field, { min = 0, max = 1000, def = 0 } = {}) {
  if (value === undefined || value === null || value === '') return def;
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${field}必须是数字`);
  if (n < min || n > max) throw badRequest(`${field}必须在 ${min}-${max} 之间`);
  return n;
}

export function vBool(value, def = false) {
  if (value === undefined || value === null) return def;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return def;
}

export function vEnum(value, field, values, def) {
  if (value === undefined || value === null || value === '') {
    if (def !== undefined) return def;
    throw badRequest(`${field}不能为空`);
  }
  if (!values.includes(value)) throw badRequest(`${field}取值不合法`);
  return value;
}

export function vArray(value, field, { max = 100 } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest(`${field}必须是数组`);
  if (value.length > max) throw badRequest(`${field}最多 ${max} 项`);
  return value;
}

export function vDate(value, field) {
  const s = vStr(value, field, { max: 10 });
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest(`${field}需为 YYYY-MM-DD 格式`);
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(t)) throw badRequest(`${field}不是有效日期`);
  return s;
}

// ------------------------------------------------------------------ 账号
/**
 * 用户名规则（注册 / 发号 / 改名 共用）：
 * 支持中文、字母、数字、下划线、点、连字符，2-24 位；不允许空白与控制字符。
 */
const USERNAME_RE = /^[一-龥A-Za-z0-9_.-]{2,24}$/;

export function vUsername(value, field = '用户名') {
  const s = vStr(value, field, { min: 2, max: 24, required: true });
  if (!USERNAME_RE.test(s)) {
    throw badRequest(`${field}只能包含中文、字母、数字、下划线、点或连字符，长度 2-24 位`);
  }
  return s;
}

export function parseRegister(body) {
  return {
    username: vUsername(body?.username),
    password: vStr(body?.password, '密码', { min: 1, max: 128, required: true }),
  };
}

/** 修改用户名（本人改自己 / KP 改他人，入参相同） */
export function parseUsernameChange(body) {
  return { username: vUsername(body?.username, '新用户名') };
}

export function parseLogin(body) {
  return {
    username: vStr(body?.username, '用户名', { min: 1, max: 24, required: true }),
    password: vStr(body?.password, '密码', { min: 1, max: 128, required: true }),
  };
}

export function parseNewUser(body) {
  return {
    username: vUsername(body?.username),
    password: vStr(body?.password, '初始密码', { min: 1, max: 128, required: true }),
    role: vEnum(body?.role, '角色', ['user', 'admin'], 'user'),
  };
}

const TITLES = ['见习调查员', '资深调查员', '精英调查员', '传奇调查员', '神话调查员'];

export function parseTitle(body) {
  return { title: vEnum(body?.title, '头衔', TITLES) };
}

export function parsePasswordChange(body) {
  return {
    oldPassword: vStr(body?.oldPassword, '当前密码', { min: 1, max: 128, required: true }),
    newPassword: vStr(body?.newPassword, '新密码', { min: 1, max: 128, required: true }),
  };
}

// ------------------------------------------------------------------ 模组
export function parseModule(body, { partial = false } = {}) {
  const b = body || {};
  const need = (field) => (!partial || b[field] !== undefined);
  const out = {};
  if (need('title')) out.title = vStr(b.title, '模组名称', { min: 1, max: 60, required: !partial });
  if (need('series')) out.series = vStr(b.series, '合集/系列', { max: 40 });
  if (need('region')) out.region = vStr(b.region, '地区', { max: 40 });
  if (need('era')) out.era = vEnum(b.era, '时代', ERAS, '1920s');
  if (need('players')) out.players = vStr(b.players, '人数', { max: 20 });
  if (need('duration')) out.duration = vStr(b.duration, '时长', { max: 20 });
  if (need('description')) out.description = vText(b.description, '简介', { max: 4000 });
  if (need('charInfo')) out.charInfo = vText(b.charInfo, '车卡要求', { max: 2000 });
  if (need('occupations')) out.occupations = vText(b.occupations, '推荐职业', { max: 2000 });
  if (need('skills')) out.skills = vText(b.skills, '推荐技能', { max: 2000 });
  if (need('notes')) out.notes = vText(b.notes, 'KP 备注', { max: 2000 });
  if (need('isPinned')) out.isPinned = vBool(b.isPinned, false);
  return out;
}

// ------------------------------------------------------------------ 带团记录
export function parseSession(body) {
  const b = body || {};
  return {
    moduleId: vId(b.moduleId, '模组'),
    date: vDate(b.date, '日期'),
    duration: vNum(b.duration, '时长', { min: 0.5, max: 72, def: 4 }),
    playerCount: vInt(b.playerCount, '人数', { min: 0, max: 30, def: 0 }),
    investigators: vText(b.investigators, '玩家名单', { max: 300 }),
  };
}

// ------------------------------------------------------------------ 角色卡
function parseChars(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest('属性必须是对象');
  const out = {};
  for (const k of ALL_CHARS) {
    out[k] = vInt(value[k], `属性 ${k}`, { min: CHAR_MIN, max: CHAR_MAX, def: 0 });
  }
  return out;
}

/** 职业 id：内置职业为数字字符串，KP 自定义职业为 c_ 开头的字符串 */
export function parseOccupationId(value, ctx = {}) {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return '';
  const raw = String(value).trim().slice(0, 40);
  if (!/^[A-Za-z0-9_]{1,40}$/.test(raw)) throw badRequest('职业标识不合法');
  const custom = (ctx.customOccupations || []).some((o) => String(o.id) === raw);
  if (custom) return raw;
  if (OCCUPATION_BY_ID[raw]) return raw;
  throw badRequest('职业不存在');
}

/** 自定义技能：玩家自命名，基础值自填；数量与长度均受限 */
function parseCustomSkills(value) {
  if (value === undefined || value === null) return [];
  const arr = vArray(value, '自定义技能', { max: CUSTOM_SKILL_MAX });
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const name = vStr(item.name, '自定义技能名称', { max: 24 });
    if (!name) continue;
    let id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!/^cs_[A-Za-z0-9]{1,24}$/.test(id) || seen.has(id)) {
      id = `cs_${Math.random().toString(36).slice(2, 10)}`;
    }
    seen.add(id);
    out.push({
      id,
      name,
      base: vInt(item.base, `自定义技能「${name}」基础值`, { min: 0, max: SKILL_CAP, def: 0 }),
      occ: vInt(item.occ, `自定义技能「${name}」职业点`, { min: 0, max: SKILL_CAP, def: 0 }),
      interest: vInt(item.interest, `自定义技能「${name}」兴趣点`, { min: 0, max: SKILL_CAP, def: 0 }),
      growth: vInt(item.growth, `自定义技能「${name}」成长点`, { min: 0, max: SKILL_CAP, def: 0 }),
      isOccupation: vBool(item.isOccupation, false),
    });
  }
  return out;
}

/** 技能投入：只接受已知槽位，其余字段一律忽略/重建 */
function parseSkills(value) {
  if (value === undefined || value === null) return null;
  const arr = vArray(value, '技能', { max: 200 });
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' ? item.id : '';
    const [key, idxRaw] = id.split('#');
    if (!SKILL_BY_KEY[key]) continue;
    const idx = idxRaw === undefined ? 0 : Number(idxRaw);
    const slots = SKILLS.find((s) => s.key === key)?.spec ? (SPEC_SLOTS[SKILL_BY_KEY[key].spec] || 1) : 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= slots) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      key,
      custom: vStr(item.custom, '技能方向/语种', { max: 24 }),
      occ: vInt(item.occ, '职业点', { min: 0, max: SKILL_CAP, def: 0 }),
      interest: vInt(item.interest, '兴趣点', { min: 0, max: SKILL_CAP, def: 0 }),
      growth: vInt(item.growth, '成长点', { min: 0, max: SKILL_CAP, def: 0 }),
    });
  }
  return out;
}

/**
 * 教育增强结算记录（KP 要能看到玩家有没有成长过、骰了几次）。
 * 数值全部走 shared 的规范化，避免前端塞进超长文本或越界数字。
 */
function parseEduGrowth(value) {
  if (value === undefined || value === null) return blankEduGrowth();
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest('教育增强记录格式不正确');
  const g = normalizeEduGrowth(value);
  if (value.by !== undefined) g.by = vStr(value.by, '结算人', { max: 40 });
  return g;
}

/** 传奇标记（只有 KP 能设置，路由层会做权限保护） */
function parseLegendary(value) {
  if (value === undefined || value === null) return blankLegendary();
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest('传奇标记格式不正确');
  const l = normalizeLegendary(value);
  if (value.note !== undefined) l.note = vText(value.note, '传奇备注', { max: 200 });
  return l;
}

/** 传奇额外调整值：只接受已知属性键，0-999 的整数，单独一栏不与原始属性混用 */
function parseLegendaryBonus(value) {
  if (value === undefined || value === null) return blankLegendaryBonus();
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest('传奇调整值格式不正确');
  const out = blankLegendaryBonus();
  for (const k of ALL_CHARS) {
    if (value[k] === undefined || value[k] === null || value[k] === '') continue;
    out[k] = vInt(value[k], `传奇调整值（${k}）`, { min: 0, max: 999, def: 0 });
  }
  return out;
}

/**
 * 年龄补正分配：规则里「外貌」是固定减值，只有 力量/体型/体质/敏捷 需要玩家自行分配。
 * 因此只接受这四个键与 0-99 的整数，其它键一律丢弃。
 */
function parseAgeAlloc(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest('年龄补正分配格式不正确');
  const out = {};
  for (const k of ['STR', 'SIZ', 'CON', 'DEX']) {
    const v = value[k];
    if (v === undefined || v === null || v === '') continue;
    out[k] = vInt(v, `年龄补正（${k}）`, { min: 0, max: 99, def: 0 });
  }
  return out;
}

function parseOccPicks(value, occupationId) {
  const occ = occupationId ? OCCUPATION_BY_ID[occupationId] : null;
  const b = value && typeof value === 'object' ? value : {};
  const freeRaw = vArray(b.free, '任意特长', { max: 12 });
  const socialRaw = vArray(b.social, '社交技能', { max: 12 });
  const choicesRaw = vArray(b.choices, '任选技能', { max: 12 });

  const free = freeRaw
    .filter((k) => typeof k === 'string' && SKILL_BY_KEY[k] && !SKILL_BY_KEY[k].spec)
    .slice(0, occ ? Math.max(0, occ.free) : 0);
  const social = socialRaw
    .filter((k) => typeof k === 'string' && SOCIAL_SKILLS.includes(k))
    .slice(0, occ ? Math.max(0, occ.social) : 0);
  const choices = (occ?.choices || []).map((group, i) => {
    const pick = choicesRaw[i];
    return typeof pick === 'string' && group.includes(pick) ? pick : '';
  });
  return { free, social, choices };
}

/** 技能标记：只有已知槽位能打勾，避免存进来一堆垃圾键 */
function parseSkillMarks(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest('技能标记格式不正确');
  const known = new Set(blankSkills().map((s) => s.id));
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(value)) {
    if (n >= 120) break;
    if (!known.has(k) && !/^cs_[A-Za-z0-9]{1,24}$/.test(k)) continue;
    if (v) { out[k] = true; n += 1; }
  }
  return out;
}

function parseWeapons(value) {
  const arr = vArray(value, '武器', { max: 12 });
  const rows = arr.map((w) => ({
    name: vStr(w?.name, '武器名称', { max: 40 }),
    skill: vStr(w?.skill, '使用技能', { max: 40 }),
    damage: vStr(w?.damage, '伤害', { max: 30 }),
    range: vStr(w?.range, '射程', { max: 30 }),
    attacks: vStr(w?.attacks, '每轮攻击', { max: 20 }),
    ammo: vStr(w?.ammo, '装弹量', { max: 20 }),
    malfunction: vStr(w?.malfunction, '故障值', { max: 20 }),
  })).filter((w) => w.name);

  // 「徒手」是常驻条目：即使客户端没提交也要补上，且不可被改名/删除
  const bare = WEAPON_BY_NAME[BUILTIN_WEAPON];
  const withoutBare = rows.filter((w) => w.name !== BUILTIN_WEAPON);
  return [{
    name: bare.name, skill: bare.skill, damage: bare.damage, range: bare.range,
    attacks: bare.attacks, ammo: bare.ammo, malfunction: bare.malfunction, builtin: true,
  }, ...withoutBare].slice(0, 12);
}

/** 经历：可关联模组（角色卡 ↔ 模组 多对多） */
export function parseModuleLinks(value, knownModuleIds) {
  const arr = vArray(value, '模组经历', { max: 60 });
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const moduleId = vId(item?.moduleId, '模组', { required: false });
    if (!moduleId || seen.has(moduleId)) continue;
    if (knownModuleIds && !knownModuleIds.has(moduleId)) continue; // 只允许关联真实存在的模组
    seen.add(moduleId);
    out.push({
      moduleId,
      role: vEnum(item?.role, '参与身份', MODULE_ROLES, 'PC'),
      date: vDate(item?.date, '日期'),
      note: vText(item?.note, '经历备注', { max: 200 }),
    });
  }
  return out;
}

/**
 * 角色卡入参解析。partial=true 用于 PATCH 语义（只更新传入的字段）。
 * 注意：ownerId / id / createdAt / updatedAt / derived 等字段**不接受客户端输入**。
 * @param {object} body 请求体
 * @param {{partial?:boolean, knownModuleIds?:Set<string>|null, current?:object|null}} opts
 *        current 为已有存档：PATCH 时用来补全未提交但会影响校验的字段（如职业）。
 */
export function parseCharacter(body, { partial = false, knownModuleIds = null, current = null, ctx = {} } = {}) {
  const b = body || {};
  const has = (k) => b[k] !== undefined;
  const need = (k) => (!partial || has(k));
  const out = {};

  if (need('name')) out.name = vStr(b.name, '角色名', { min: 1, max: 40, required: true });
  if (need('playerName')) out.playerName = vStr(b.playerName, '玩家名', { max: 40 });
  if (has('occupationId')) {
    out.occupationId = parseOccupationId(b.occupationId, ctx);
  } else if (!partial) {
    out.occupationId = '';
  }
  // 项目要求：玩家必须从职业列表里选一个职业，不再支持"自定义/无职业"
  const resolvedOcc = out.occupationId !== undefined ? out.occupationId : (current?.occupationId || '');
  if (!resolvedOcc) throw badRequest('请先选择一个职业（不再支持自定义职业）');

  // PATCH 未提交职业时，沿用存档中的职业，否则「任选技能」会被误清空
  const occId = out.occupationId !== undefined
    ? out.occupationId
    : (partial ? (current?.occupationId || '') : '');
  if (need('age')) out.age = vInt(b.age, '年龄', { min: 15, max: 120, def: 25 });
  if (need('gender')) out.gender = vStr(b.gender, '性别', { max: 20 });
  if (need('residence')) out.residence = vStr(b.residence, '住地', { max: 40 });
  if (need('birthplace')) out.birthplace = vStr(b.birthplace, '故乡/出身', { max: 40 });
  if (need('era')) out.era = vEnum(b.era, '时代', ERAS, '1920s');

  if (need('chars')) {
    const c = parseChars(b.chars);
    if (!c) throw badRequest('属性不能为空');
    out.chars = c;
  } else if (!partial) {
    const c = {};
    for (const k of ALL_CHARS) c[k] = 0;
    out.chars = c;
  }

  if (need('eduBonus')) out.eduBonus = vInt(b.eduBonus, '教育增强', { min: 0, max: 999, def: 0 });
  if (need('eduGrowth')) out.eduGrowth = parseEduGrowth(b.eduGrowth);
  if (need('applyAgeAdjust')) out.applyAgeAdjust = vBool(b.applyAgeAdjust, true);
  if (need('ageAlloc')) out.ageAlloc = parseAgeAlloc(b.ageAlloc);
  // 以下三项是 KP 专属（路由层会对非管理员保留存档原值）
  if (need('legendary')) out.legendary = parseLegendary(b.legendary);
  if (need('legendaryBonus')) out.legendaryBonus = parseLegendaryBonus(b.legendaryBonus);
  if (need('agePenaltyWaived')) out.agePenaltyWaived = vBool(b.agePenaltyWaived, false);
  if (need('notes')) out.notes = vText(b.notes, '备注', { max: 4000 });
  if (need('armorPenalty')) out.armorPenalty = vInt(b.armorPenalty, '护甲减值', { min: 0, max: 10, def: 0 });
  if (need('occPicks')) out.occPicks = parseOccPicks(b.occPicks, occId);

  if (has('skills')) {
    const parsed = parseSkills(b.skills);
    if (!parsed) throw badRequest('技能格式不正确');
    out.skills = parsed;
  } else if (!partial) {
    out.skills = blankSkills();
  }

  if (has('customSkills') || !partial) {
    out.customSkills = parseCustomSkills(b.customSkills);
  }

  if (has('currency')) {
    const era = out.era || current?.era || '1920s';
    const codes = currenciesFor(era).map((c) => c.code);
    out.currency = vEnum(b.currency, '货币', codes, DEFAULT_CURRENCY[era] || 'USD');
  } else if (!partial) {
    out.currency = DEFAULT_CURRENCY[out.era || '1920s'] || 'USD';
  }
  if (has('extraAssets')) out.extraAssets = vText(b.extraAssets, '额外资产', { max: 400 });
  else if (!partial) out.extraAssets = '';

  if (has('skillMarks')) out.skillMarks = parseSkillMarks(b.skillMarks);
  else if (!partial) out.skillMarks = {};

  if (need('weapons')) out.weapons = parseWeapons(b.weapons);
  if (need('equipment')) out.equipment = vText(b.equipment, '装备和物品', { max: 4000 });
  // 消费水平 / 现金 / 资产由信用评级 + 时代 + 货币自动推导，**不接受客户端提交**（锁死不可改）

  if (need('background')) {
    const g = b.background && typeof b.background === 'object' ? b.background : {};
    out.background = {
      appearance: vText(g.appearance, '形象描述', { max: 600 }),
      traits: vText(g.traits, '特质', { max: 600 }),
      ideology: vText(g.ideology, '思想与信念', { max: 600 }),
      injuries: vText(g.injuries, '伤口和疤痕', { max: 600 }),
      people: vText(g.people, '重要之人', { max: 600 }),
      phobias: vText(g.phobias, '恐惧症和躁狂症', { max: 600 }),
      locations: vText(g.locations, '意义非凡之地', { max: 600 }),
      tomes: vText(g.tomes, '神话典籍/法术/魔法物品', { max: 600 }),
      possessions: vText(g.possessions, '宝贵之物', { max: 600 }),
      encounters: vText(g.encounters, '第三类接触', { max: 600 }),
    };
  } else if (!partial) {
    out.background = {
      appearance: '', traits: '', ideology: '', injuries: '', people: '',
      phobias: '', locations: '', tomes: '', possessions: '', encounters: '',
    };
  }

  // 「模组经历」由角色卡详情页的专用接口维护，车卡编辑器并不管理它。
  // 因此全量 PUT 时若请求体里**根本没有** moduleLinks 这个键，就沿用存档里的关联，
  // 不能当成「清空」——否则「编辑角色卡 → 保存」会把关联模组全部抹掉。
  // 需要清空时请显式提交 moduleLinks: []，或走 DELETE /characters/:id/modules/:moduleId。
  if (has('moduleLinks')) out.moduleLinks = parseModuleLinks(b.moduleLinks, knownModuleIds);
  else if (!partial) out.moduleLinks = Array.isArray(current?.moduleLinks) ? current.moduleLinks : [];
  if (need('experience')) out.experience = vText(b.experience, '经历', { max: 4000 });
  if (need('status')) out.status = vEnum(b.status, '状态', STATUSES, 'draft');
  if (need('isPublic')) out.isPublic = vBool(b.isPublic, false);

  // 非 partial 时补齐默认值，保证入库结构完整
  if (!partial) {
    out.experience = out.experience ?? '';
    out.equipment = out.equipment ?? '';
    out.weapons = out.weapons ?? blankWeapons();
    out.moduleLinks = out.moduleLinks ?? [];   // 走到这里说明 body 没给 moduleLinks（新建卡）
    out.status = out.status ?? 'draft';
    out.isPublic = out.isPublic ?? false;
    out.playerName = out.playerName ?? '';
    out.gender = out.gender ?? '';
    out.residence = out.residence ?? '';
    out.birthplace = out.birthplace ?? '';
    out.era = out.era ?? '1920s';
    out.eduBonus = out.eduBonus ?? 0;
    out.eduGrowth = out.eduGrowth ?? blankEduGrowth();
    out.applyAgeAdjust = out.applyAgeAdjust ?? true;
    out.ageAlloc = out.ageAlloc ?? {};
    out.legendary = out.legendary ?? blankLegendary();
    out.legendaryBonus = out.legendaryBonus ?? blankLegendaryBonus();
    out.agePenaltyWaived = out.agePenaltyWaived ?? false;
    out.notes = out.notes ?? '';
    out.armorPenalty = out.armorPenalty ?? 0;
    out.occPicks = out.occPicks ?? { free: [], social: [], choices: [] };
    out.customSkills = out.customSkills ?? [];
  }
  return out;
}

// ------------------------------------------------------- KP 自定义职业模板
const STAT_KEYS = ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU'];

/** 职业点公式：接受 { terms:[{stat,mult}], max:[{stat,mult}] }，并做白名单校验 */
function parsePointSpec(value) {
  const src = value && typeof value === 'object' ? value : {};
  const read = (arr, field) => vArray(arr, field, { max: 8 }).map((t) => {
    const stat = vEnum(t?.stat, `${field} 属性`, STAT_KEYS);
    const mult = vInt(t?.mult, `${field} 倍数`, { min: 1, max: 10, def: 1 });
    return { stat, mult };
  });
  const terms = read(src.terms, '职业点公式');
  const max = read(src.max, '职业点取大项');
  if (terms.length === 0 && max.length === 0) throw badRequest('职业点公式至少要有一项');
  return { terms, max };
}

/** 本职技能键：只接受内置技能键，过滤未知项 */
function parseOccupationKeys(value) {
  return vArray(value, '本职技能', { max: 40 })
    .filter((k) => typeof k === 'string' && SKILL_BY_KEY[k])
    .filter((k, i, a) => a.indexOf(k) === i);
}

/** 额外允许的自定义技能名（供 KP 模板使用，玩家不选职业也能被标记为本职） */
function parseCustomKeys(value) {
  return vArray(value, '自定义本职技能', { max: 20 })
    .map((k) => (typeof k === 'string' ? k.trim().slice(0, 24) : ''))
    .filter(Boolean)
    .filter((k, i, a) => a.indexOf(k) === i);
}

/** 任选其一组：每组是一批技能键，玩家从中选一个 */
function parseChoiceGroups(value) {
  return vArray(value, '任选技能组', { max: 8 }).map((group) => vArray(group, '任选技能组', { max: 20 })
    .filter((k) => typeof k === 'string' && SKILL_BY_KEY[k])
    .filter((k, i, a) => a.indexOf(k) === i))
    .filter((g) => g.length > 0);
}

export function parseOccupationTemplate(body) {
  const b = body || {};
  const crMin = vInt(b.crMin, '信用评级下限', { min: 0, max: 99, def: 0 });
  const crMax = vInt(b.crMax, '信用评级上限', { min: 0, max: 99, def: 99 });
  if (crMin > crMax) throw badRequest('信用评级下限不能大于上限');
  return {
    name: vStr(b.name, '职业名称', { min: 1, max: 24, required: true }),
    cr: [crMin, crMax],
    attr: vStr(b.attr, '技能点说明', { max: 40 }) || '自定义公式',
    pts: parsePointSpec(b.pts),
    keys: parseOccupationKeys(b.keys),
    choices: parseChoiceGroups(b.choices),
    customKeys: parseCustomKeys(b.customKeys),
    social: vInt(b.social, '社交技能槽位', { min: 0, max: 6, def: 0 }),
    free: vInt(b.free, '任意特长槽位', { min: 0, max: 8, def: 0 }),
    desc: vText(b.desc, '职业简介', { max: 200 }),
  };
}

// ------------------------------------------------------------- 审卡规则
/** 只接受已知规则键，值按类型收敛；未提交的键用默认值补齐 */
export function parseAuditRules(body) {
  const b = body && typeof body === 'object' ? body : {};
  const out = { ...DEFAULT_AUDIT_RULES };
  for (const meta of AUDIT_RULE_META) {
    if (b[meta.key] === undefined) continue;
    if (meta.type === 'number') {
      const n = Number(b[meta.key]);
      if (!Number.isFinite(n) || n < 0 || n > 10000) throw badRequest(`${meta.label}必须是 0-10000 的数字`);
      out[meta.key] = Math.round(n * 100) / 100;
    } else {
      out[meta.key] = vBool(b[meta.key], DEFAULT_AUDIT_RULES[meta.key]);
    }
  }
  out.enabled = vBool(b.enabled, out.enabled);
  if (out.charTotalMin && out.charTotalMax && out.charTotalMin > out.charTotalMax) {
    throw badRequest('属性总和下限不能大于上限');
  }
  return out;
}

// ------------------------------------------------------------- 审核批复
export function parseReview(body) {
  const b = body || {};
  const verdict = vEnum(b.verdict, '审核结论', ['approved', 'rejected']);
  const comment = vText(b.comment, '批复', { max: 500 });
  if (verdict === 'rejected' && !comment) throw badRequest('驳回时必须填写批复说明，方便玩家修改');
  return { verdict, comment: verdict === 'approved' ? '' : comment };
}

export function parseBatchReview(body) {
  const b = body || {};
  const verdict = vEnum(b.verdict, '审核结论', ['approved', 'rejected']);
  const comment = vText(b.comment, '批复', { max: 500 });
  if (verdict === 'rejected' && !comment) throw badRequest('批量驳回时必须填写批复说明');
  const ids = vArray(b.characterIds, '角色卡', { max: 200 })
    .map((x) => vId(x, '角色卡', { required: false }))
    .filter(Boolean);
  if (!ids.length) throw badRequest('请至少选择一张角色卡');
  return { verdict, comment: verdict === 'approved' ? '' : comment, characterIds: [...new Set(ids)] };
}

export { REVIEW_STATUSES };

export { CHARS };
