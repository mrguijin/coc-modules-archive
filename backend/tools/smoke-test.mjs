/**
 * 后端冒烟测试：不需要任何测试框架，`node tools/smoke-test.mjs` 即可运行。
 *
 * 覆盖：
 *  - 旧数据迁移（明文口令 → 哈希后仍可登录；数据库中不再有明文）
 *  - 鉴权、越权（IDOR）、最小权限
 *  - 角色卡 CRUD、服务端权威派生值、注入防护、规则提示
 *  - 模组经历关联与级联清理
 *  - 输入校验、限流、令牌吊销
 *
 * 用法：
 *   node tools/smoke-test.mjs [原始database.json路径]
 *
 * 不传路径时使用内置夹具 `tools/fixtures/legacy-v1-database.json`：
 * 一份 v1.0 形态的合成旧库（含明文口令与明文令牌），因此「旧库迁移」这一段
 * 在没有真实历史数据的机器上也能照跑，不会因为缺少 backend/database.json 而失败。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SEED = process.argv[2] || path.join(__dirname, 'fixtures', 'legacy-v1-database.json');
const PORT = Number(process.env.SMOKE_PORT || 3199);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
function section(t) { console.log(`\n== ${t} ==`); }

async function api(method, url, { token, body } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* 无响应体 */ }
  return { status: res.status, json };
}

// ---------------------------------------------------------------- 准备环境
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-smoke-'));
const dbFile = path.join(tmp, 'database.json');
fs.copyFileSync(SEED, dbFile);
const seed = JSON.parse(fs.readFileSync(SEED, 'utf-8'));
const admin = seed.users.find((u) => u.role === 'admin');
const player = seed.users.find((u) => u.role === 'user');
const moduleId = seed.modules[0].id;

const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), COCOC_DATA_DIR: tmp, COCOC_HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d.toString(); });
child.stderr.on('data', (d) => { serverLog += d.toString(); });

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function cleanup(code) {
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(code);
}

try {
  if (!await waitReady()) {
    console.error('服务未能在超时时间内启动：\n' + serverLog);
    cleanup(1);
  }

  section('健康检查与迁移');
  const health = await api('GET', '/api/health');
  ok('GET /api/health 返回 200', health.status === 200 && health.json?.ok === true);

  const migrated = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
  ok('数据库中已无明文 password 字段', migrated.users.every((u) => u.password === undefined));
  ok('数据库中已无明文 token 字段', migrated.users.every((u) => u.token === undefined));
  ok('口令已哈希（scrypt）', migrated.users.every((u) => u.passwordHash && u.passwordSalt));
  ok('已有 characters 表', Array.isArray(migrated.characters));

  section('鉴权');
  const noAuth = await api('GET', '/api/user/me');
  ok('未带令牌访问 /api/user/me → 401', noAuth.status === 401);

  const badLogin = await api('POST', '/api/login', { body: { username: admin.username, password: 'definitely-wrong' } });
  ok('错误口令登录 → 401', badLogin.status === 401);

  const login = await api('POST', '/api/login', { body: { username: admin.username, password: admin.password } });
  ok('旧明文口令迁移后仍可登录', login.status === 200 && Boolean(login.json?.token));
  const adminToken = login.json?.token;
  ok('登录响应不含口令/令牌哈希', !JSON.stringify(login.json).includes('passwordHash'));

  const me = await api('GET', '/api/user/me', { token: adminToken });
  ok('GET /api/user/me 返回本人', me.json?.username === admin.username && me.json?.role === 'admin');

  const pLogin = await api('POST', '/api/login', { body: { username: player.username, password: player.password } });
  const playerToken = pLogin.json?.token;
  ok('普通玩家可登录', pLogin.status === 200 && Boolean(playerToken));

  const otherLogin = await api('POST', '/api/login', { body: { username: admin.username, password: admin.password } });
  const adminToken2 = otherLogin.json?.token;
  const oldToken = await api('GET', '/api/user/me', { token: adminToken });
  ok('重复登录后旧令牌失效（令牌轮换）', oldToken.status === 401);

  const logout = await api('POST', '/api/logout', { token: adminToken2 });
  const afterLogout = await api('GET', '/api/user/me', { token: adminToken2 });
  ok('登出后令牌立即失效', logout.status === 200 && afterLogout.status === 401);

  const adminLogin = await api('POST', '/api/login', { body: { username: admin.username, password: admin.password } });
  const A = adminLogin.json.token;

  section('角色卡：创建与派生计算');
  const blank = {
    name: '冒烟测试调查员', playerName: '测试', occupationId: 2, age: 32, gender: '男',
    era: '1920s', chars: { STR: 50, CON: 60, SIZ: 70, DEX: 60, APP: 50, INT: 70, POW: 55, EDU: 80, Luck: 45 },
    // 故意注入越权字段，服务端必须忽略
    id: 'HACKED_ID', createdAt: 1, role: 'admin', themeColor: 'hacked',
    skills: [
      { id: 'accounting', key: 'accounting', occ: 60, interest: 0, growth: 0 },
      { id: 'credit', key: 'credit', occ: 45, interest: 0, growth: 0 },
      { id: 'spotHidden', key: 'spotHidden', occ: 0, interest: 25, growth: 0 },
      { id: 'notARealSkill', key: 'notARealSkill', occ: 99, interest: 0, growth: 0 },
      { id: 'dodge', key: 'dodge', occ: 0, interest: 20, growth: 0 },
    ],
  };
  const created = await api('POST', '/api/characters', { token: A, body: blank });
  ok('创建角色卡 → 200', created.status === 200, JSON.stringify(created.json).slice(0, 200));
  const card = created.json;
  ok('服务端忽略客户端传入的 id', card.id !== 'HACKED_ID' && String(card.id).startsWith('c_'));
  ok('归属强制为当前用户', card.ownerId === seed.users.find((u) => u.username === admin.username).id);

  // 普通玩家尝试把角色卡挂到别人名下 → 必须被忽略
  const asPlayer = await api('POST', '/api/characters', {
    token: playerToken, body: { ...blank, name: '越权归属测试', ownerId: seed.users.find((u) => u.username === admin.username).id },
  });
  ok('玩家无法指定归属（ownerId 被忽略）', asPlayer.status === 200
    && asPlayer.json.ownerId === seed.users.find((u) => u.username === player.username).id);
  await api('DELETE', `/api/characters/${asPlayer.json.id}`, { token: A });

  // KP 代玩家建卡（面团代录）
  const forPlayer = await api('POST', '/api/characters', {
    token: A, body: { ...blank, name: '代录角色卡', ownerId: seed.users.find((u) => u.username === player.username).id },
  });
  ok('KP 可为指定玩家代建角色卡', forPlayer.status === 200
    && forPlayer.json.ownerId === seed.users.find((u) => u.username === player.username).id);
  await api('DELETE', `/api/characters/${forPlayer.json.id}`, { token: A });

  const badOwner = await api('POST', '/api/characters', { token: A, body: { ...blank, ownerId: 'u_not_exist' } });
  ok('指定不存在的玩家 → 400', badOwner.status === 400);
  const d = card.derived;
  ok('HP = ⌊(体质+体型)/10⌋ = 13', d.hp === 13, `实际 ${d.hp}`);
  ok('MP = ⌊意志/5⌋ = 11', d.mp === 11, `实际 ${d.mp}`);
  ok('理智 = 意志 = 55', d.san === 55, `实际 ${d.san}`);
  ok('闪避基础 = ⌊敏捷/2⌋ = 30', d.dodgeBase === 30, `实际 ${d.dodgeBase}`);
  ok('母语基础 = 教育 = 80', d.ownLanguageBase === 80);
  ok('职业点预算 = 教育×4 = 320', d.budget.occupation === 320, `实际 ${d.budget.occupation}`);
  ok('兴趣点预算 = 智力×2 = 140', d.budget.interest === 140);
  ok('不存在的技能被丢弃', !d.skills.some((s) => s.key === 'notARealSkill'));
  const dodgeSkill = d.skills.find((s) => s.key === 'dodge');
  ok('闪避 = 基础(30) + 兴趣(20) = 50', dodgeSkill.total === 50, `实际 ${dodgeSkill.total}`);
  const overInvest = await api('POST', '/api/characters', {
    token: A, body: { ...blank, skills: [{ id: 'dodge', key: 'dodge', occ: 0, interest: 999, growth: 0 }] },
  });
  ok('单技能投入超过 99 → 400（服务端拒绝而非静默截断）', overInvest.status === 400);
  ok('信用评级属于可投职业点的技能', d.skills.find((s) => s.key === 'credit').isOccupation === true);
  ok('未选职业时不产生职业点花费提示以外的崩溃', Array.isArray(card.warnings));

  section('角色卡：年龄补正（分配式）');
  const mkAge = async (age, extra = {}) => (await api('POST', '/api/characters', {
    token: A, body: { ...blank, name: `年龄补正测试${age}`, age, ...extra },
  })).json;
  const young = await mkAge(30);
  ok('20-39 岁：不扣属性、需要 1 次教育增强检定',
    young.derived.ageAdjust.eduChecks === 1 && young.derived.ageAdjust.poolPoints === 0
    && young.derived.eff.STR === 50, JSON.stringify(young.derived.ageAdjust));

  const teen = await mkAge(17);
  ok('15-19 岁：力量/体型合计 −5（默认平均分配，不是各 −5）',
    teen.derived.ageAdjust.poolPoints === 5
    && teen.derived.ageAdjust.alloc.STR + teen.derived.ageAdjust.alloc.SIZ === 5
    && teen.derived.eff.STR + teen.derived.eff.SIZ === 50 + 70 - 5,
    JSON.stringify(teen.derived.ageAdjust));
  ok('15-19 岁：体质不参与扣点', teen.derived.eff.CON === 60, `实际 ${teen.derived.eff.CON}`);
  ok('15-19 岁：教育 −5、幸运掷两次取高',
    teen.derived.eff.EDU === 75 && teen.derived.ageAdjust.luckRolls === 2);

  const mid = await mkAge(45, { ageAlloc: { STR: 5, CON: 0, DEX: 0, APP: 9 } });
  ok('40-49 岁：力量/体质/敏捷合计 −5，由玩家自行分配',
    mid.derived.eff.STR === 45 && mid.derived.eff.CON === 60 && mid.derived.eff.DEX === 60,
    `STR=${mid.derived.eff.STR} CON=${mid.derived.eff.CON} DEX=${mid.derived.eff.DEX}`);
  ok('40-49 岁：外貌固定 −5', mid.derived.eff.APP === 45, `实际 ${mid.derived.eff.APP}`);
  ok('年龄分配随存档保存并回传', mid.ageAlloc?.STR === 5 && mid.ageAlloc?.CON === 0,
    JSON.stringify(mid.ageAlloc));
  ok('年龄分配里的非法键（外貌）被丢弃', mid.ageAlloc?.APP === undefined);

  const dist = await mkAge(55, { ageAlloc: { STR: 1, CON: 1, DEX: 1 } });
  ok('分配不满时提示剩余点数', dist.warnings.some((w) => w.includes('年龄补正未分配完')),
    JSON.stringify(dist.warnings));

  const senior = await mkAge(65);
  ok('60-69 岁：外貌 −15、教育增强 ×4、移动力随年龄下降',
    senior.derived.eff.APP === 35 && senior.derived.ageAdjust.eduChecks === 4 && senior.derived.mov === 4,
    `APP=${senior.derived.eff.APP} checks=${senior.derived.ageAdjust.eduChecks} mov=${senior.derived.mov}`);

  const eduGrow = await mkAge(45, { eduBonus: 10, ageAlloc: { STR: 5, CON: 0, DEX: 0 } });
  ok('教育增强只加教育，不会关掉年龄减值',
    eduGrow.derived.eff.EDU === 90 && eduGrow.derived.eff.STR === 45 && eduGrow.applyAgeAdjust === true,
    `EDU=${eduGrow.derived.eff.EDU} STR=${eduGrow.derived.eff.STR}`);

  const badAlloc = await api('POST', '/api/characters', {
    token: A, body: { ...blank, name: '非法分配', age: 45, ageAlloc: { STR: 999 } },
  });
  ok('年龄分配超出范围 → 400', badAlloc.status === 400);
  for (const c of [young, teen, mid, dist, senior, eduGrow]) {
    await api('DELETE', `/api/characters/${c.id}`, { token: A });
  }

  section('角色卡：职业指定专攻方向（对照 Excel 原文）');
  const priestId = 211;   // 牧师（《克苏鲁煤气灯》）：本职技能里直接写了「拉丁语」
  const priestMissing = await api('POST', '/api/characters', {
    token: A, body: { ...blank, name: '牧师未选方向', occupationId: priestId },
  });
  ok('牧师未填拉丁语：编辑器提示 + KP 审卡都会提醒',
    priestMissing.status === 200
    && priestMissing.json.warnings.some((w) => w.includes('拉丁语'))
    && priestMissing.json.audit.findings.some((f) => f.id === 'occBranch.language'),
    JSON.stringify(priestMissing.json.audit?.findings?.map((f) => f.id)));
  const priestOk = await api('POST', '/api/characters', {
    token: A,
    body: {
      ...blank,
      name: '牧师已选拉丁语',
      occupationId: priestId,
      skills: [{ id: 'language#0', key: 'language', custom: '拉丁语', occ: 0, interest: 20, growth: 0 }],
    },
  });
  ok('选了拉丁语之后不再提示该专攻方向',
    priestOk.status === 200
    && !priestOk.json.warnings.some((w) => w.includes('拉丁语'))
    && !priestOk.json.audit.findings.some((f) => f.id === 'occBranch.language'));
  for (const c of [priestMissing.json, priestOk.json]) {
    await api('DELETE', `/api/characters/${c.id}`, { token: A });
  }

  section('角色卡：教育增强记录 / 传奇标记 / 备注（v1.7）');
  const eduCard = await api('POST', '/api/characters', {
    token: A,
    body: {
      ...blank, name: '成长记录测试', occupationId: 2, age: 45,
      eduBonus: 0,
      eduGrowth: { settled: true, manual: false, count: 2, gain: 0, rolls: [{ roll: 88, gain: 0 }, { roll: 71, gain: 0 }], at: 1700000000000, by: 'keeper' },
      notes: '面团补录：与深潜者交了手',
    },
  });
  ok('教育增强记录可保存', eduCard.status === 200
    && eduCard.json.eduGrowth.settled === true && eduCard.json.eduGrowth.count === 2
    && eduCard.json.eduGrowth.rolls.length === 2, JSON.stringify(eduCard.json?.eduGrowth));
  ok('结算过（哪怕 0 提升）就不再提示教育增强',
    !eduCard.json.warnings.some((w) => w.includes('教育增强检定')),
    JSON.stringify(eduCard.json.warnings));
  ok('备注可保存且随详情返回', eduCard.json.notes === '面团补录：与深潜者交了手');

  const eduManual = await api('PUT', `/api/characters/${eduCard.json.id}`, {
    token: A, body: { ...blank, name: '成长记录测试', occupationId: 2, age: 45, eduBonus: 12, notes: '' },
  });
  ok('手动录入教育增强后提示消失', !eduManual.json.warnings.some((w) => w.includes('教育增强检定')));
  ok('清零（eduBonus 0 + 未结算）后提示回来',
    (await api('PUT', `/api/characters/${eduCard.json.id}`, {
      token: A,
      body: { ...blank, name: '成长记录测试', occupationId: 2, age: 45, eduBonus: 0, eduGrowth: { settled: false, manual: false, count: 0, gain: 0, rolls: [], at: 0, by: '' } },
    })).json.warnings.some((w) => w.includes('教育增强检定')));

  const legend = await api('PUT', `/api/characters/${eduCard.json.id}`, {
    token: A,
    body: {
      ...blank, name: '传奇测试', occupationId: 2, age: 45,
      legendary: { enabled: true, by: 'keeper', at: 1700000000000, note: '跑完《奈亚拉托提普的面具》' },
      legendaryBonus: { STR: 120, SIZ: 30 },
    },
  });
  ok('KP 可给角色卡开传奇标记并填写额外调整值',
    legend.status === 200 && legend.json.legendary.enabled === true
    && legend.json.derived.eff.STR === blank.chars.STR + 120 - legend.json.derived.ageAdjust.alloc.STR
    && legend.json.derived.legendaryBonus.SIZ === 30,
    JSON.stringify(legend.json?.derived?.legendaryBonus));
  ok('传奇额外调整值单独成栏（raw 与 eff 分开）',
    legend.json.derived.raw.STR === blank.chars.STR && legend.json.derived.legendaryBonus.STR === 120);
  ok('突破 99 后按表格算体格/伤害加值',
    legend.json.derived.strSiz === legend.json.derived.eff.STR + legend.json.derived.eff.SIZ
    && typeof legend.json.derived.build === 'number',
    `STR+SIZ=${legend.json.derived.strSiz} build=${legend.json.derived.build}`);
  ok('传奇卡在审卡里给出 info 提示且不受属性上限规则约束',
    legend.json.audit.findings.some((f) => f.id === 'legendary')
    && !legend.json.audit.findings.some((f) => f.id.startsWith('charMax')),
    JSON.stringify(legend.json.audit.findings.map((f) => f.id)));

  const waived = await api('PUT', `/api/characters/${eduCard.json.id}`, {
    token: A,
    body: { ...blank, name: '豁免年龄测试', occupationId: 2, age: 65, agePenaltyWaived: true, eduBonus: 15 },
  });
  ok('KP 豁免年龄减益：属性不降、成长照常',
    waived.json.derived.eff.STR === blank.chars.STR && waived.json.derived.eff.APP === blank.chars.APP
    && waived.json.derived.eff.EDU === blank.chars.EDU + 15 && waived.json.derived.mov === 8 - 1,
    `STR=${waived.json.derived.eff.STR} APP=${waived.json.derived.eff.APP} EDU=${waived.json.derived.eff.EDU} mov=${waived.json.derived.mov}`);

  // 玩家不能自己开传奇 / 免年龄减益（KP 专属字段）
  const playerCard = await api('POST', '/api/characters', {
    token: playerToken,
    body: {
      ...blank, name: '玩家越权测试', occupationId: 2, age: 65,
      legendary: { enabled: true }, legendaryBonus: { STR: 99 }, agePenaltyWaived: true,
    },
  });
  ok('玩家自建卡无法带上传奇标记 / 年龄豁免',
    playerCard.status === 200 && playerCard.json.legendary.enabled === false
    && playerCard.json.derived.legendaryBonus.STR === 0 && playerCard.json.agePenaltyWaived === false,
    JSON.stringify({ l: playerCard.json?.legendary, w: playerCard.json?.agePenaltyWaived }));
  const playerTryEdit = await api('PUT', `/api/characters/${playerCard.json.id}`, {
    token: playerToken,
    body: { ...blank, name: '玩家越权测试', occupationId: 2, age: 65, legendary: { enabled: true }, legendaryBonus: { STR: 99 }, agePenaltyWaived: true },
  });
  ok('玩家保存时 KP 专属字段被服务端拒绝',
    playerTryEdit.json.legendary.enabled === false && playerTryEdit.json.derived.legendaryBonus.STR === 0);
  await api('DELETE', `/api/characters/${playerCard.json.id}`, { token: A });

  // KP 在「角色卡管理列表」里直接给别人的卡开传奇（不进入编辑器）
  const listTarget = await api('POST', '/api/characters', {
    token: playerToken, body: { ...blank, name: '列表快捷传奇测试', occupationId: 2, age: 30 },
  });
  const quick = await api('PATCH', `/api/characters/${listTarget.json.id}`, {
    token: A, body: { legendary: { enabled: true }, legendaryBonus: { STR: 66 } },
  });
  ok('KP 可在列表页用 PATCH 直接开传奇（无需进入编辑）',
    quick.status === 200 && quick.json.legendary.enabled === true
    && quick.json.derived.legendaryBonus.STR === 66,
    JSON.stringify(quick.json?.legendary));
  ok('传奇标记由服务端盖章操作人与时间',
    quick.json.legendary.by === admin.username && quick.json.legendary.at > 0,
    JSON.stringify(quick.json?.legendary));
  const summary = await api('GET', '/api/characters?scope=all', { token: A });
  const row = summary.json.items.find((x) => x.id === listTarget.json.id);
  ok('列表摘要带上传奇 / 教育成长 / 年龄豁免，KP 不下钻也能看到',
    row?.legendary?.enabled === true && row?.legendaryBonus?.STR === 66
    && row?.legendaryBonusTotal === 66 && row?.eduGrowth && row?.ageAdjust,
    JSON.stringify({ l: row?.legendary, t: row?.legendaryBonusTotal }));
  const playerCannotQuick = await api('PATCH', `/api/characters/${listTarget.json.id}`, {
    token: playerToken, body: { legendary: { enabled: false }, legendaryBonus: { STR: 0 } },
  });
  ok('玩家在列表页也改不动传奇（服务端保留 KP 的值）',
    playerCannotQuick.json.legendary.enabled === true && playerCannotQuick.json.derived.legendaryBonus.STR === 66);
  await api('DELETE', `/api/characters/${listTarget.json.id}`, { token: A });
  await api('DELETE', `/api/characters/${eduCard.json.id}`, { token: A });

  section('审卡规则：混点严格化（v1.7）');
  const mixedCard = await api('POST', '/api/characters', {
    token: A,
    body: {
      ...blank, name: '混点测试', occupationId: 2,
      skills: [
        { id: 'spotHidden', key: 'spotHidden', occ: 15, interest: 15, growth: 0 },
        { id: 'credit', key: 'credit', occ: 30, interest: 10, growth: 0 },
        { id: 'stealth', key: 'stealth', occ: 20, interest: 0, growth: 0 },
      ],
    },
  });
  const mixedFindings = mixedCard.json.audit.findings;
  ok('同一技能同时吃职业点与兴趣点 → 不合规',
    mixedFindings.some((f) => f.id === 'forbidMixedPoints.sameSkill' && f.level === 'error'),
    JSON.stringify(mixedFindings.map((f) => f.id)));
  ok('信用评级投兴趣点 → 不合规',
    mixedFindings.some((f) => f.id === 'forbidMixedPoints.credit' && f.level === 'error'));
  ok('职业点投在非本职技能（潜行）→ 不合规',
    mixedFindings.some((f) => f.id === 'forbidMixedPoints' && f.level === 'error'));
  ok('编辑器警告里也能看到混点提示',
    mixedCard.json.warnings.some((w) => w.includes('同时吃职业点与兴趣点'))
    && mixedCard.json.warnings.some((w) => w.includes('信用评级只能用职业点')));
  await api('DELETE', `/api/characters/${mixedCard.json.id}`, { token: A });

  section('教育增强：首次结算后锁定（方案 C）');
  const settle = (extra = {}) => ({
    settled: true, manual: false, count: 2, gain: 8,
    rolls: [{ roll: 88, gain: 5 }, { roll: 71, gain: 3 }], at: 1700000000000, by: '玩家',
    attempts: [{ at: 1700000000000, by: '玩家', manual: false, count: 2, gain: 8, rolls: [], totalAfter: 8, via: 'roll' }],
    ...extra,
  });
  const lockCard = await api('POST', '/api/characters', {
    token: playerToken,
    body: { ...blank, name: '教育锁定测试', occupationId: 2, age: 45, eduBonus: 8, eduGrowth: settle() },
  });
  ok('玩家首次结算教育增强 → 允许', lockCard.status === 200
    && lockCard.json.eduGrowth.settled === true && lockCard.json.eduGrowth.locked === true
    && lockCard.json.eduGrowth.attempts.length === 1, JSON.stringify(lockCard.json?.eduGrowth?.locked));

  const playerRetry = await api('PUT', `/api/characters/${lockCard.json.id}`, {
    token: playerToken,
    body: {
      ...blank, name: '教育锁定测试', occupationId: 2, age: 45, eduBonus: 20,
      eduGrowth: settle({ gain: 20, attempts: [
        { at: 1700000000000, by: '玩家', gain: 8, totalAfter: 8, via: 'roll' },
        { at: 1700000009999, by: '玩家', gain: 20, totalAfter: 20, via: 'reroll' },
      ] }),
    },
  });
  ok('已结算后玩家自助重掷 → 服务端保留存档值（仍是 +8 / 1 条流水）',
    playerRetry.status === 200 && playerRetry.json.eduBonus === 8
    && playerRetry.json.eduGrowth.gain === 8 && playerRetry.json.eduGrowth.attempts.length === 1,
    JSON.stringify({ b: playerRetry.json?.eduBonus, a: playerRetry.json?.eduGrowth?.attempts?.length }));

  const playerReset = await api('PUT', `/api/characters/${lockCard.json.id}`, {
    token: playerToken,
    body: { ...blank, name: '教育锁定测试', occupationId: 2, age: 45, eduBonus: 0, eduGrowth: { settled: false } },
  });
  ok('玩家自助清零教育增强 → 被拦住',
    playerReset.json.eduBonus === 8 && playerReset.json.eduGrowth.settled === true);

  const playerSelfGrant = await api('PUT', `/api/characters/${lockCard.json.id}`, {
    token: playerToken,
    body: { ...blank, name: '教育锁定测试', occupationId: 2, age: 45, eduBonus: 8, eduGrowth: settle({ granted: 5 }) },
  });
  ok('玩家自己伪造「已授权 5 次」→ granted 被清零', playerSelfGrant.json.eduGrowth.granted === 0,
    JSON.stringify(playerSelfGrant.json?.eduGrowth?.granted));

  const stillThere = await api('GET', `/api/characters/${lockCard.json.id}`, { token: A });
  ok('被拦下的重掷没有破坏存档（KP 仍能读到那张卡）',
    stillThere.status === 200 && stillThere.json.eduBonus === 8);
  const kpGrant = await api('PATCH', `/api/characters/${lockCard.json.id}`, {
    token: A, body: { eduGrowth: { ...playerSelfGrant.json.eduGrowth, granted: 1, lastGrant: { at: 1700000001111, by: 'keeper' } } },
  });
  ok('KP 可授权一次重掷', kpGrant.status === 200 && kpGrant.json.eduGrowth.granted === 1
    && kpGrant.json.eduGrowth.locked === false, JSON.stringify(kpGrant.json?.eduGrowth?.granted));

  const playerReroll = await api('PUT', `/api/characters/${lockCard.json.id}`, {
    token: playerToken,
    body: {
      ...blank, name: '教育锁定测试', occupationId: 2, age: 45, eduBonus: 15,
      eduGrowth: settle({
        gain: 15, attempts: [
          { at: 1700000000000, by: '玩家', gain: 8, totalAfter: 8, via: 'roll' },
          { at: 1700000002222, by: '玩家', gain: 15, totalAfter: 15, via: 'reroll' },
        ],
      }),
    },
  });
  ok('用掉授权后可以重掷一次（流水追加、授权扣回 0）',
    playerReroll.status === 200 && playerReroll.json.eduBonus === 15
    && playerReroll.json.eduGrowth.attempts.length === 2 && playerReroll.json.eduGrowth.granted === 0
    && playerReroll.json.eduGrowth.rerolls === 1,
    JSON.stringify({ b: playerReroll.json?.eduBonus, n: playerReroll.json?.eduGrowth?.attempts?.length, g: playerReroll.json?.eduGrowth?.granted }));

  const playerRetryAgain = await api('PUT', `/api/characters/${lockCard.json.id}`, {
    token: playerToken,
    body: { ...blank, name: '教育锁定测试', occupationId: 2, age: 45, eduBonus: 30, eduGrowth: settle({ gain: 30 }) },
  });
  ok('授权用完后再次重掷又被拦住', playerRetryAgain.json.eduBonus === 15);

  const auditReroll = await api('POST', `/api/admin/audit/${lockCard.json.id}`, { token: A });
  ok('审卡结论里能看到「重掷过」',
    auditReroll.json.findings.some((f) => f.id === 'eduReroll'),
    JSON.stringify(auditReroll.json.findings.map((f) => f.id)));

  const kpReset = await api('PATCH', `/api/characters/${lockCard.json.id}`, {
    token: A, body: { eduBonus: 0, eduGrowth: { settled: false, lastReset: { at: 1700000003333, by: 'keeper' } } },
  });
  ok('KP 可重置教育增强（数值清零、留下重置痕迹）',
    kpReset.json.eduBonus === 0 && kpReset.json.eduGrowth.settled === false
    && kpReset.json.eduGrowth.lastReset?.by === 'keeper');
  const afterReset = await api('POST', `/api/admin/audit/${lockCard.json.id}`, { token: A });
  ok('重置后审卡提示「教育增强未结算」',
    afterReset.json.findings.some((f) => f.id === 'eduUnsettled'));
  await api('DELETE', `/api/characters/${lockCard.json.id}`, { token: A });

  const overBudget = await api('POST', '/api/characters', {
    token: A,
    body: {
      ...blank,
      name: '超支测试',
      skills: [
        { id: 'accounting', key: 'accounting', occ: 99, interest: 0, growth: 0 },
        { id: 'law', key: 'law', occ: 99, interest: 0, growth: 0 },
        { id: 'library', key: 'library', occ: 99, interest: 0, growth: 0 },
        { id: 'listen', key: 'listen', occ: 99, interest: 0, growth: 0 },
      ],
    },
  });
  ok('职业点超支时给出警告但允许保存', overBudget.status === 200
    && overBudget.json.warnings.some((w) => w.includes('职业点超支')),
  JSON.stringify(overBudget.json?.warnings));
  await api('DELETE', `/api/characters/${overBudget.json.id}`, { token: A });

  section('角色卡：越权防护');
  const playerList0 = await api('GET', '/api/characters', { token: playerToken });
  ok('玩家只能看到自己的角色卡', playerList0.json?.items?.every((c) => c.ownerId !== card.ownerId) !== false);

  const playerRead = await api('GET', `/api/characters/${card.id}`, { token: playerToken });
  ok('玩家读取他人私有角色卡 → 403', playerRead.status === 403, `实际 ${playerRead.status}`);

  const playerWrite = await api('PUT', `/api/characters/${card.id}`, { token: playerToken, body: { name: '篡改' } });
  ok('玩家修改他人角色卡 → 403', playerWrite.status === 403);

  const playerDelete = await api('DELETE', `/api/characters/${card.id}`, { token: playerToken });
  ok('玩家删除他人角色卡 → 403', playerDelete.status === 403);

  const adminRead = await api('GET', `/api/characters/${card.id}`, { token: A });
  ok('KP 可读取任意角色卡（统一管理）', adminRead.status === 200 && adminRead.json.canEdit === true);

  const allScope = await api('GET', '/api/characters?scope=all', { token: A });
  ok('KP 可用 scope=all 拉取全部角色卡', allScope.status === 200 && allScope.json.scope === 'all');

  const playerScopeAll = await api('GET', '/api/characters?scope=all', { token: playerToken });
  ok('玩家请求 scope=all 仍被限制为本人', playerScopeAll.json.scope === 'mine');

  section('角色卡：公开只读');
  const pub = await api('PATCH', `/api/characters/${card.id}`, { token: A, body: { isPublic: true } });
  ok('可设为公开', pub.status === 200 && pub.json.isPublic === true);
  const playerReadPublic = await api('GET', `/api/characters/${card.id}`, { token: playerToken });
  ok('公开后他人可读', playerReadPublic.status === 200);
  ok('公开后他人仍不可写', playerReadPublic.json.canEdit === false);
  const playerWritePublic = await api('PATCH', `/api/characters/${card.id}`, { token: playerToken, body: { isPublic: false } });
  ok('PATCH 也受归属校验保护', playerWritePublic.status === 403);
  ok('公开卡的写入仍被拒绝', playerWritePublic.status === 403);

  section('角色卡：模组经历关联');
  const linked = await api('POST', `/api/characters/${card.id}/modules`, {
    token: A, body: { moduleId, role: 'PC', date: '2026-01-02', note: '第一次跑团' },
  });
  ok('关联模组成功', linked.status === 200 && linked.json.moduleLinks.length === 1);
  ok('关联返回模组标题', linked.json.moduleLinks[0].moduleTitle === seed.modules[0].title);

  const badLink = await api('POST', `/api/characters/${card.id}/modules`, {
    token: A, body: { moduleId: 'm_not_exist' },
  });
  ok('关联不存在的模组 → 404', badLink.status === 404);

  const filtered = await api('GET', `/api/characters?scope=all&moduleId=${moduleId}`, { token: A });
  ok('可按模组筛选角色卡', filtered.json.items.some((c) => c.id === card.id));

  // 回归：车卡编辑器保存整张卡（全量 PUT）时，请求体里没有 moduleLinks，
  // 旧实现会把它当成「清空」，导致「编辑角色卡 → 保存」后关联模组消失。
  const fullPut = await api('PUT', `/api/characters/${card.id}`, {
    token: A, body: { ...blank, name: '冒烟测试调查员' },
  });
  ok('全量保存（不带 moduleLinks）不会清空关联模组',
    fullPut.status === 200 && fullPut.json.moduleLinks.length === 1,
    JSON.stringify(fullPut.json?.moduleLinks));

  const roundTrip = await api('PUT', `/api/characters/${card.id}`, {
    token: A,
    body: {
      ...blank,
      name: '冒烟测试调查员',
      moduleLinks: [{ moduleId, role: 'PC', date: '2026-01-02', note: '第一次跑团' }],
    },
  });
  ok('编辑器带上 moduleLinks 时按提交内容保存',
    roundTrip.status === 200 && roundTrip.json.moduleLinks.length === 1
    && roundTrip.json.moduleLinks[0].moduleId === moduleId);

  const cleared = await api('PUT', `/api/characters/${card.id}`, {
    token: A, body: { ...blank, name: '冒烟测试调查员', moduleLinks: [] },
  });
  ok('显式提交 moduleLinks: [] 才会清空关联',
    cleared.status === 200 && cleared.json.moduleLinks.length === 0, JSON.stringify(cleared.json?.moduleLinks));
  // 复位，后面的断言仍然期望这张卡关联着模组
  await api('POST', `/api/characters/${card.id}/modules`, {
    token: A, body: { moduleId, role: 'PC', date: '2026-01-02', note: '第一次跑团' },
  });

  section('输入校验');
  const badName = await api('POST', '/api/characters', { token: A, body: { ...blank, name: '' } });
  ok('空角色名 → 400', badName.status === 400);
  const longName = await api('POST', '/api/characters', { token: A, body: { ...blank, name: 'x'.repeat(41) } });
  ok('超长角色名 → 400', longName.status === 400);
  const badAge = await api('POST', '/api/characters', { token: A, body: { ...blank, age: 200 } });
  ok('非法年龄 → 400', badAge.status === 400);
  const badOcc = await api('POST', '/api/characters', { token: A, body: { ...blank, occupationId: 99999 } });
  ok('不存在的职业 → 400', badOcc.status === 400);
  const badChars = await api('POST', '/api/characters', { token: A, body: { ...blank, chars: { STR: 500 } } });
  ok('属性越界 → 400', badChars.status === 400);
  const badCharType = await api('POST', '/api/characters', { token: A, body: { ...blank, chars: 'oops' } });
  ok('属性类型错误 → 400', badCharType.status === 400);

  const modInject = await api('POST', '/api/modules', {
    token: A, body: { title: '注入测试模组', era: '现代', id: 'm_fake', themeColor: 'x', createdAt: 1 },
  });
  ok('模组创建忽略客户端 id/themeColor', modInject.json.id !== 'm_fake' && modInject.json.themeColor !== 'x');
  ok('模组创建补全服务端时间戳', typeof modInject.json.createdAt === 'number' && modInject.json.createdAt > 1e12);

  // 按项目要求：不再强制密码强度，只校验长度下限
  const weakPwd = await api('POST', '/api/admin/users', { token: A, body: { username: 'weakuser', password: '123456' } });
  ok('允许创建 123456 这类弱口令账号（不强制强度）', weakPwd.status === 200, JSON.stringify(weakPwd.json));
  if (weakPwd.status === 200) await api('DELETE', `/api/admin/users/${weakPwd.json.user.id}`, { token: A });
  const shortPwd = await api('POST', '/api/admin/users', { token: A, body: { username: 'shortpwd', password: '123' } });
  ok('过短口令（<6 位）仍被拒绝', shortPwd.status === 400);

  const okUser = await api('POST', '/api/admin/users', { token: A, body: { username: 'smokeplayer', password: 'abc123' } });
  ok('创建账号成功', okUser.status === 200);
  const newUserId = okUser.json.user.id;

  const playerAdmin = await api('GET', '/api/admin/users', { token: playerToken });
  ok('普通玩家访问管理接口 → 403', playerAdmin.status === 403);

  section('修改用户名');
  const renUser = await api('POST', '/api/admin/users', { token: A, body: { username: 'renametest', password: 'abc123' } });
  ok('建一个用于改名的账号', renUser.status === 200);
  const renId = renUser.json.user.id;
  const renLogin = await api('POST', '/api/login', { body: { username: 'renametest', password: 'abc123' } });
  const renToken = renLogin.json.token;
  const renCard = await api('POST', '/api/characters', {
    token: renToken, body: { ...blank, name: '改名测试卡', playerName: 'renametest', occupationId: 2 },
  });
  ok('该账号建一张玩家名=用户名的卡', renCard.status === 200);

  const renBadName = await api('PUT', '/api/user/username', { token: renToken, body: { username: 'a b' } });
  ok('用户名含空格 → 400', renBadName.status === 400);
  const renShort = await api('PUT', '/api/user/username', { token: renToken, body: { username: 'x' } });
  ok('用户名过短 → 400', renShort.status === 400);
  const renDup = await api('PUT', '/api/user/username', { token: renToken, body: { username: admin.username } });
  ok('用户名被占用 → 400', renDup.status === 400);
  const renSame = await api('PUT', '/api/user/username', { token: renToken, body: { username: 'renametest' } });
  ok('与原名相同 → 400', renSame.status === 400);

  const renamed = await api('PUT', '/api/user/username', { token: renToken, body: { username: '改名后的调查员' } });
  ok('本人可改用户名（支持中文）', renamed.status === 200 && renamed.json.user.username === '改名后的调查员', JSON.stringify(renamed.json));
  ok('连带同步了角色卡玩家名', renamed.json.syncedCharacters === 1, `同步 ${renamed.json.syncedCharacters} 张`);
  const afterRename = await api('GET', `/api/characters/${renCard.json.id}`, { token: renToken });
  ok('角色卡 playerName 已更新', afterRename.json.playerName === '改名后的调查员');
  // 注意：登录会轮换令牌（单点登录语义），所以「原令牌仍有效」必须在重新登录之前断言
  ok('改名不影响当前会话令牌', (await api('GET', '/api/user/me', { token: renToken })).status === 200);
  ok('改名后旧用户名无法登录', (await api('POST', '/api/login', { body: { username: 'renametest', password: 'abc123' } })).status === 401);
  ok('改名后新用户名可登录', (await api('POST', '/api/login', { body: { username: '改名后的调查员', password: 'abc123' } })).status === 200);

  const kpRename = await api('PUT', `/api/admin/users/${renId}/username`, { token: A, body: { username: 'kp改的名字' } });
  ok('KP 可代改用户名', kpRename.status === 200 && kpRename.json.user.username === 'kp改的名字');
  const playerRename = await api('PUT', `/api/admin/users/${renId}/username`, { token: playerToken, body: { username: 'hack' } });
  ok('玩家调用管理端改名 → 403', playerRename.status === 403);
  const renameAudit = await api('GET', '/api/admin/audit', { token: A });
  ok('改名写入审计日志', JSON.stringify(renameAudit.json).includes('rename'));
  await api('DELETE', `/api/admin/users/${renId}`, { token: A });

  section('v1.3 新规则');
  const noOcc = await api('POST', '/api/characters', { token: A, body: { ...blank, name: '没职业的卡', occupationId: '' } });
  ok('不选职业建卡 → 400（必须选职业）', noOcc.status === 400, JSON.stringify(noOcc.json));
  const badOcc2 = await api('POST', '/api/characters', { token: A, body: { ...blank, name: '假职业', occupationId: 'cocc_fake' } });
  ok('不存在的职业 → 400', badOcc2.status === 400);

  const wealth = await api('POST', '/api/characters', {
    token: A,
    body: {
      ...blank, name: '资产测试', occupationId: 2, era: '1920s', currency: 'USD',
      chars: { STR: 50, CON: 50, SIZ: 60, DEX: 50, APP: 50, INT: 60, POW: 50, EDU: 80, Luck: 50 },
      skills: [{ id: 'credit', key: 'credit', occ: 60, interest: 0, growth: 0 }],
      assets: { spending: '伪造的', cash: '伪造的', assets: '伪造的' },
      extraAssets: '祖父留下的乡间别墅',
      skillMarks: { accounting: true, notASkill: true },
    },
  });
  ok('资产/消费水平可自动推导', wealth.status === 200 && wealth.json.derived.wealth.level === '小康', JSON.stringify(wealth.json?.derived?.wealth));
  ok('信用评级 60 → 1920s 现金 $300', wealth.json.derived.wealth.cashText === '$300', wealth.json.derived.wealth.cashText);
  ok('资产按小康档 CR×500 推出（$30,000）', wealth.json.derived.wealth.assetsText === '$30,000', wealth.json.derived.wealth.assetsText);
  ok('客户端提交的 assets 被忽略（锁死不可改）', !JSON.stringify(wealth.json).includes('伪造的'));
  ok('额外资产可自由填写', wealth.json.extraAssets === '祖父留下的乡间别墅');
  ok('技能标记只接受已知技能', wealth.json.derived.markedCount === 1, `实际 ${wealth.json.derived.markedCount}`);
  const eraCur = await api('PUT', `/api/characters/${wealth.json.id}`, {
    token: A,
    body: { ...blank, name: '资产测试', occupationId: 2, era: '现代', currency: 'CNY',
      chars: { STR: 50, CON: 50, SIZ: 60, DEX: 50, APP: 50, INT: 60, POW: 50, EDU: 80, Luck: 50 },
      skills: [{ id: 'credit', key: 'credit', occ: 60, interest: 0, growth: 0 }] },
  });
  ok('切换时代+货币后按新表计算（现代 ¥42000）', eraCur.json.derived.wealth.cashText === '¥42,000', eraCur.json.derived.wealth.cashText);
  const badCur = await api('PUT', `/api/characters/${wealth.json.id}`, {
    token: A, body: { ...blank, name: 'x', occupationId: 2, era: '1920s', currency: 'EUR' },
  });
  ok('1920s 不接受只属于现代的货币代码（€）', badCur.status === 400);

  const weapons = await api('POST', '/api/characters', {
    token: A, body: { ...blank, name: '武器测试', occupationId: 2, weapons: [{ name: '点38左轮', skill: '手枪', damage: '1D10' }] },
  });
  ok('武器表第一条固定为「徒手」', weapons.json.weapons[0].name === '徒手' && weapons.json.weapons[0].builtin === true);
  ok('自定义武器追加在徒手之后', weapons.json.weapons.length === 2 && weapons.json.weapons[1].name === '点38左轮');
  const bareOnly = await api('POST', '/api/characters', {
    token: A, body: { ...blank, name: '只有徒手', occupationId: 2, weapons: [] },
  });
  ok('提交空武器表也会补上徒手', bareOnly.json.weapons.length === 1 && bareOnly.json.weapons[0].name === '徒手');

  const marks = await api('PUT', `/api/characters/${weapons.json.id}`, {
    token: A,
    body: { ...blank, name: '武器测试', occupationId: 2, skillMarks: { accounting: true, dodge: true } },
  });
  ok('多个技能标记可保存', marks.json.derived.markedCount === 2);

  section('职业模板自定义技能');
  const tpl2 = await api('POST', '/api/admin/occupations', {
    token: A,
    body: {
      name: '房规职业（测试）', crMin: 10, crMax: 40, attr: '教育×2',
      pts: { terms: [{ stat: 'EDU', mult: 2 }], max: [] },
      keys: ['library'], customKeys: ['驾驶（坦克）', '驾驶（坦克）', ''], free: 1,
    },
  });
  ok('职业模板可带自定义技能名', tpl2.status === 200 && tpl2.json.customKeys.length === 1, JSON.stringify(tpl2.json?.customKeys));
  const withTplSkill = await api('POST', '/api/characters', {
    token: A,
    body: {
      ...blank, name: '房规技能卡', occupationId: tpl2.json.id,
      customSkills: [{ id: 'cs_tank', name: '驾驶（坦克）', base: 1, occ: 20, interest: 0, growth: 0 }],
    },
  });
  ok('模板里的自定义技能被视为本职', withTplSkill.json.derived.skills.find((x) => x.id === 'cs_tank')?.isOccupation === true);
  ok('因此可用职业点提升', withTplSkill.json.derived.skills.find((x) => x.id === 'cs_tank')?.occ === 20);

  section('批量批复');
  const c1 = await api('POST', '/api/characters', { token: A, body: { ...blank, name: '批量A', occupationId: 2 } });
  const c2 = await api('POST', '/api/characters', { token: A, body: { ...blank, name: '批量B', occupationId: 2 } });
  await api('POST', `/api/characters/${c1.json.id}/submit`, { token: A });
  await api('POST', `/api/characters/${c2.json.id}/submit`, { token: A });
  const batchBad = await api('POST', '/api/admin/reviews/batch', { token: A, body: { characterIds: [c1.json.id], verdict: 'rejected', comment: '' } });
  ok('批量驳回必须写批复', batchBad.status === 400);
  const batchEmpty = await api('POST', '/api/admin/reviews/batch', { token: A, body: { characterIds: [], verdict: 'approved' } });
  ok('未选择任何角色卡 → 400', batchEmpty.status === 400);
  const batchPlayer = await api('POST', '/api/admin/reviews/batch', { token: playerToken, body: { characterIds: [c1.json.id], verdict: 'approved' } });
  ok('玩家调用批量批复 → 403', batchPlayer.status === 403);
  const batchOk = await api('POST', '/api/admin/reviews/batch', { token: A, body: { characterIds: [c1.json.id, c2.json.id], verdict: 'approved' } });
  ok('批量通过成功', batchOk.status === 200 && batchOk.json.reviewed === 2);
  const afterBatch = await api('GET', `/api/characters/${c1.json.id}`, { token: A });
  ok('批量通过后状态为已通过', afterBatch.json.reviewStatus === 'approved');
  ok('批量通过不留批复', afterBatch.json.review.comment === '');
  const batchAgain = await api('POST', '/api/admin/reviews/batch', { token: A, body: { characterIds: [c1.json.id], verdict: 'approved' } });
  ok('重复批量通过会被跳过', batchAgain.json.skipped.length === 1);

  section('驳回后可重新提交');
  const rejectThenEdit = await api('POST', `/api/characters/${c2.json.id}/review`, { token: A, body: { verdict: 'rejected', comment: '请调整' } });
  ok('先驳回', rejectThenEdit.json.reviewStatus === 'rejected');
  const resubmit = await api('POST', `/api/characters/${c2.json.id}/submit`, { token: A });
  ok('驳回后可以再次提交审核', resubmit.status === 200 && resubmit.json.reviewStatus === 'pending', JSON.stringify(resubmit.json));
  await api('DELETE', `/api/characters/${c1.json.id}`, { token: A });
  await api('DELETE', `/api/characters/${c2.json.id}`, { token: A });
  await api('DELETE', `/api/admin/occupations/${tpl2.json.id}`, { token: A });
  await api('DELETE', `/api/characters/${wealth.json.id}`, { token: A });
  await api('DELETE', `/api/characters/${weapons.json.id}`, { token: A });
  await api('DELETE', `/api/characters/${bareOnly.json.id}`, { token: A });
  await api('DELETE', `/api/characters/${withTplSkill.json.id}`, { token: A });

  section('级联清理');
  const charCountBefore = JSON.parse(fs.readFileSync(dbFile, 'utf-8')).characters.length;
  const delUser = await api('DELETE', `/api/admin/users/${newUserId}`, { token: A });
  ok('删除账号成功', delUser.status === 200);

  const delModule = await api('DELETE', `/api/modules/${moduleId}`, { token: A });
  ok('删除模组成功', delModule.status === 200);
  const afterModuleDelete = await api('GET', `/api/characters/${card.id}`, { token: A });
  ok('删除模组后角色卡经历关联被摘除', afterModuleDelete.json.moduleLinks.length === 0);
  const charCountAfter = JSON.parse(fs.readFileSync(dbFile, 'utf-8')).characters.length;
  ok('删除账号时级联清理其角色卡', charCountAfter <= charCountBefore);

  section('限流');
  let limited = false;
  for (let i = 0; i < 14; i++) {
    const r = await api('POST', '/api/login', { body: { username: 'nobody-here', password: 'x'.repeat(12) } });
    if (r.status === 429) { limited = true; break; }
  }
  ok('连续登录失败触发限流 429', limited);

  section('删除与审计');
  const del = await api('DELETE', `/api/characters/${card.id}`, { token: A });
  ok('删除自己的角色卡成功', del.status === 200);
  const gone = await api('GET', `/api/characters/${card.id}`, { token: A });
  ok('删除后不可再读取', gone.status === 404);

  const audit = await api('GET', '/api/admin/audit', { token: A });
  ok('审计日志可读且包含记录', audit.status === 200 && audit.json.entries.length > 0);
  const auditStr = JSON.stringify(audit.json);
  ok('审计日志不含口令字段', !auditStr.includes('password') && !auditStr.includes('tokenHash'));


  section('自定义技能');
  const withCustom = await api('POST', '/api/characters', {
    token: A,
    body: {
      ...blank,
      name: '自定义技能测试',
      customSkills: [
        { id: 'cs_alpha', name: '驾驶（坦克）', base: 1, occ: 0, interest: 15, growth: 0, isOccupation: false },
        { id: 'cs_beta', name: '酿酒', base: 5, occ: 10, interest: 0, growth: 0, isOccupation: true },
        { id: 'bad_id', name: '', base: 1 },
      ],
    },
  });
  ok('自定义技能可保存', withCustom.status === 200);
  const csList = withCustom.json?.derived?.skills?.filter((x) => x.kind === 'custom') || [];
  ok('自定义技能参与计算', csList.length === 2, `实际 ${csList.length}`);
  ok('自定义技能总成功率正确（1+15=16）', csList.find((x) => x.name === '驾驶（坦克）')?.total === 16);
  ok('未命名的自定义技能被丢弃', !csList.some((x) => !x.name));
  const badCustom = await api('POST', '/api/characters', {
    token: A, body: { ...blank, name: '超量自定义', customSkills: Array.from({ length: 30 }, (_, i) => ({ id: `cs_x${i}`, name: `技能${i}`, base: 1 })) },
  });
  ok('自定义技能数量超限 → 400', badCustom.status === 400);
  await api('DELETE', `/api/characters/${withCustom.json.id}`, { token: A });

  section('职业模板（KP 自定义）');
  const tpl = await api('POST', '/api/admin/occupations', {
    token: A,
    body: {
      name: '深潜者信徒（测试）', crMin: 0, crMax: 30, attr: '教育×2＋意志×2',
      pts: { terms: [{ stat: 'EDU', mult: 2 }, { stat: 'POW', mult: 2 }], max: [] },
      keys: ['cthulhu', 'occult', 'swim'], choices: [['spotHidden', 'listen']], social: 0, free: 2,
      desc: '测试用自定义职业',
    },
  });
  ok('KP 可新增职业模板', tpl.status === 200 && String(tpl.json.id).startsWith('cocc'));
  const tplId = tpl.json.id;
  const dupTpl = await api('POST', '/api/admin/occupations', { token: A, body: { name: '深潜者信徒（测试）', pts: { terms: [{ stat: 'EDU', mult: 4 }] } } });
  ok('同名职业模板 → 400', dupTpl.status === 400);
  const badTpl = await api('POST', '/api/admin/occupations', { token: A, body: { name: '空公式', pts: { terms: [], max: [] } } });
  ok('没有点数公式的模板 → 400', badTpl.status === 400);
  const playerTpl = await api('POST', '/api/admin/occupations', { token: playerToken, body: { name: '玩家不该能建', pts: { terms: [{ stat: 'EDU', mult: 2 }] } } });
  ok('普通玩家建职业模板 → 403', playerTpl.status === 403);

  const metaWithTpl = await api('GET', '/api/characters/meta', { token: playerToken });
  ok('元数据里能看到 KP 的职业模板', metaWithTpl.json.customOccupations.some((o) => o.id === tplId));

  const usingTpl = await api('POST', '/api/characters', {
    token: A,
    body: { ...blank, name: '用模板车卡', occupationId: tplId, chars: { STR: 50, CON: 50, SIZ: 60, DEX: 50, APP: 40, INT: 60, POW: 70, EDU: 80, Luck: 50 } },
  });
  ok('可使用自定义职业建卡', usingTpl.status === 200);
  ok('自定义职业预算按公式计算（80×2+70×2=300）', usingTpl.json.derived.budget.occupation === 300, `实际 ${usingTpl.json.derived.budget.occupation}`);
  ok('自定义职业解析正确', usingTpl.json.derived.occupation?.name === '深潜者信徒（测试）');
  ok('自定义职业标记自定义', usingTpl.json.derived.occupation?.custom === true);
  ok('自定义职业的本职技能生效', usingTpl.json.derived.allowedSkills.includes('cthulhu'));
  const badOccTpl = await api('POST', '/api/characters', { token: A, body: { ...blank, name: '野职业', occupationId: 'cocc_not_exist' } });
  ok('引用不存在的职业模板 → 400', badOccTpl.status === 400);

  section('审核流程');
  const submitted = await api('POST', `/api/characters/${usingTpl.json.id}/submit`, { token: A });
  ok('提交审核成功', submitted.status === 200 && submitted.json.reviewStatus === 'pending');
  const resubmit2 = await api('POST', `/api/characters/${usingTpl.json.id}/submit`, { token: A });
  ok('重复提交 → 400', resubmit2.status === 400);

  const queue = await api('GET', '/api/admin/reviews', { token: A });
  ok('KP 审核队列包含该卡', queue.json.items.some((x) => x.id === usingTpl.json.id));
  const playerQueue = await api('GET', '/api/admin/reviews', { token: playerToken });
  ok('玩家访问审核队列 → 403', playerQueue.status === 403);

  const noComment = await api('POST', `/api/characters/${usingTpl.json.id}/review`, { token: A, body: { verdict: 'rejected', comment: '' } });
  ok('驳回但不写批复 → 400', noComment.status === 400);
  const playerReview = await api('POST', `/api/characters/${usingTpl.json.id}/review`, { token: playerToken, body: { verdict: 'approved', comment: 'x' } });
  ok('玩家自己批复 → 403', playerReview.status === 403);

  const rejected = await api('POST', `/api/characters/${usingTpl.json.id}/review`, {
    token: A, body: { verdict: 'rejected', comment: '力量偏低，请重新分配点数' },
  });
  ok('KP 驳回成功', rejected.status === 200 && rejected.json.reviewStatus === 'rejected');
  ok('驳回后玩家能看到批复', rejected.json.review.comment.includes('力量偏低'));
  const ownerSees = await api('GET', `/api/characters/${usingTpl.json.id}`, { token: A });
  ok('详情里带审核状态', ownerSees.json.review.status === 'rejected');

  const approved = await api('POST', `/api/characters/${usingTpl.json.id}/review`, {
    token: A, body: { verdict: 'approved', comment: '这条批复应当被清空' },
  });
  ok('KP 通过审核', approved.status === 200 && approved.json.reviewStatus === 'approved');
  ok('通过后批复被清空', approved.json.review.comment === '', `实际「${approved.json.review.comment}」`);

  const rawDb = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
  const rawCard = rawDb.characters.find((c) => c.id === usingTpl.json.id);
  // notes 是 v1.7 新增的「玩家备注」字段（不属于批复），experience 是经历栏
  ok('批复不写入角色卡本体', Object.keys(rawCard).every((k) => !/comment|批复|note/i.test(k) || k === 'experience' || k === 'notes'));
  ok('审核记录单独存放', rawDb.reviews.some((r) => r.characterId === rawCard.id && r.verdict === 'rejected'));
  ok('角色卡只有审核状态字段', typeof rawCard.reviewStatus === 'string' && rawCard.reviewStatus === 'approved');

  const editAfterApprove = await api('PUT', `/api/characters/${usingTpl.json.id}`, {
    token: A, body: { ...blank, name: '通过后又改了', occupationId: tplId },
  });
  ok('通过后再编辑 → 审核状态重置', editAfterApprove.json.reviewStatus === 'none');

  section('KP 辅助审卡');
  const rulesGet = await api('GET', '/api/admin/audit-rules', { token: A });
  ok('可读取审卡规则', rulesGet.status === 200 && rulesGet.json.rules && rulesGet.json.meta.length > 0);
  const rulesPut = await api('PUT', '/api/admin/audit-rules', {
    token: A, body: { enabled: true, charMax: 90, occPointsMax: 100, forbidMixedPoints: true, skillMax: 80 },
  });
  ok('可保存审卡规则', rulesPut.status === 200 && rulesPut.json.rules.charMax === 90);
  const badRules = await api('PUT', '/api/admin/audit-rules', { token: A, body: { charMax: -5 } });
  ok('非法规则值 → 400', badRules.status === 400);
  const playerRules = await api('PUT', '/api/admin/audit-rules', { token: playerToken, body: { enabled: true } });
  ok('玩家改审卡规则 → 403', playerRules.status === 403);

  const auditOne = await api('POST', `/api/admin/audit/${usingTpl.json.id}`, { token: A });
  ok('单张审卡返回结论', auditOne.status === 200 && typeof auditOne.json.passed === 'boolean');
  ok('单张审卡返回规则统计', auditOne.json.stats && 'charTotal' in auditOne.json.stats);
  const auditPlayer = await api('POST', `/api/admin/audit/${usingTpl.json.id}`, { token: playerToken });
  ok('玩家调用审卡 → 403', auditPlayer.status === 403);

  const auditBatch = await api('POST', '/api/admin/audit/batch', { token: A, body: { scope: 'all' } });
  ok('批量审卡返回汇总', auditBatch.status === 200 && typeof auditBatch.json.total === 'number');
  ok('批量审卡区分通过与不通过', auditBatch.json.passed + auditBatch.json.failed === auditBatch.json.total);

  // 手动勾选模式
  const manualNoIds = await api('POST', '/api/admin/audit/batch', { token: A, body: { scope: 'manual' } });
  ok('手动模式未勾选任何卡 → 400', manualNoIds.status === 400);
  const manual = await api('POST', '/api/admin/audit/batch', {
    token: A, body: { scope: 'manual', characterIds: [usingTpl.json.id] },
  });
  ok('手动勾选模式只审选中的卡', manual.status === 200 && manual.json.total === 1
    && manual.json.items[0].characterId === usingTpl.json.id);
  const secondCard = await api('POST', '/api/characters', { token: A, body: { ...blank, name: '手动多选B', occupationId: 2 } });
  const manualAll = await api('POST', '/api/admin/audit/batch', {
    token: A, body: { scope: 'manual', characterIds: [usingTpl.json.id, secondCard.json.id] },
  });
  ok('手动模式支持多选', manualAll.json.total === 2);
  await api('DELETE', `/api/characters/${secondCard.json.id}`, { token: A });

  // 构造一张必然违规的卡，验证规则确实生效
  const offender = await api('POST', '/api/characters', {
    token: A,
    body: {
      ...blank, name: '违规测试卡', occupationId: 2,
      chars: { STR: 99, CON: 99, SIZ: 99, DEX: 99, APP: 99, INT: 99, POW: 99, EDU: 99, Luck: 99 },
      skills: [
        { id: 'stealth', key: 'stealth', occ: 90, interest: 0, growth: 0 },
        { id: 'credit', key: 'credit', occ: 0, interest: 0, growth: 0 },
      ],
    },
  });
  const offenderAudit = await api('POST', `/api/admin/audit/${offender.json.id}`, { token: A });
  ok('超限属性被判不合规', offenderAudit.json.passed === false);
  ok('属性上限规则命中', offenderAudit.json.findings.some((f) => f.id.startsWith('charMax')));
  ok('混点规则命中（潜行非会计师本职）', offenderAudit.json.findings.some((f) => f.id === 'forbidMixedPoints'));
  ok('信用评级区间规则命中', offenderAudit.json.findings.some((f) => f.id === 'requireCreditInRange'));
  await api('DELETE', `/api/characters/${offender.json.id}`, { token: A });

  const tplDel = await api('DELETE', `/api/admin/occupations/${tplId}`, { token: A });
  ok('删除职业模板成功', tplDel.status === 200);
  ok('删除模板会报告受影响的角色卡数', typeof tplDel.json.affectedCharacters === 'number');
  await api('DELETE', `/api/characters/${usingTpl.json.id}`, { token: A });

  console.log(`\n================ 结果：${pass} 通过 / ${fail} 失败 ================`);
  if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
  cleanup(fail ? 1 : 0);
} catch (err) {
  console.error('测试异常：', err);
  console.error(serverLog.slice(-3000));
  cleanup(1);
}
