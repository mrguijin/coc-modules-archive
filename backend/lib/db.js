/**
 * 数据层：单文件 JSON 存储 + 原子写入 + 每日备份 + 数据结构迁移。
 *
 * 为什么保留 JSON 文件而不是换数据库？
 *  - 本站数据量极小（几十个用户、几十张角色卡），JSON 完全够用，运维成本为零（备份 = 拷一个文件）。
 *  - 但**必须**修掉原实现的三个致命点：整文件覆写非原子（断电/被杀会写出半个文件）、无备份、无迁移入口。
 *  本实现改为「写临时文件 → fsync → rename」的原子替换，并在每天首次写入前留一份快照。
 *
 * 数据常驻内存，所有写操作通过 save() 落盘；单进程部署下不存在并发写冲突。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isVeryWeak, hashPassword, hashToken, tokenExpiry } from './security.js';
import { blankEduGrowth, blankLegendary, blankLegendaryBonus } from '../../shared/coc7e.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.COCOC_DATA_DIR
  ? path.resolve(process.env.COCOC_DATA_DIR)
  : path.join(__dirname, '..', 'data');
export const DB_FILE = process.env.COCOC_DB_FILE
  ? path.resolve(process.env.COCOC_DB_FILE)
  : path.join(DATA_DIR, 'database.json');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_KEEP = 14;
export const SCHEMA_VERSION = 6;

let data = null;

// ------------------------------------------------------------------ 结构
function emptyDB() {
  return {
    schemaVersion: SCHEMA_VERSION,
    users: [],
    modules: [],
    played_records: [],
    sessions: [],
    characters: [],
    customOccupations: [],   // KP 自定义职业模板
    reviews: [],             // 角色卡审核记录（批复只存在这里，不进角色卡本体）
    settings: { auditRules: null }, // KP 辅助审卡规则（null = 使用内置默认值）
  };
}

function ensureShape(d) {
  const out = d && typeof d === 'object' ? d : {};
  for (const key of ['users', 'modules', 'played_records', 'sessions', 'characters',
    'customOccupations', 'reviews']) {
    if (!Array.isArray(out[key])) out[key] = [];
  }
  if (!out.settings || typeof out.settings !== 'object') out.settings = { auditRules: null };
  return out;
}

// ------------------------------------------------------------------ 迁移
/**
 * v1 -> v2：
 *  - 明文口令 → scrypt 哈希（迁移时明文还在，直接一次性哈希，之后数据库中不再有明文）
 *  - 明文 token → SHA-256 摘要（已登录的浏览器仍持有原始 token，摘要比对依然有效，不会把人踢下线）
 *  - 新建 characters 表
 *  - 补 createdAt/updatedAt
 */
function migrate(d) {
  const notes = [];
  let changed = false;
  let weak = 0;

  for (const u of d.users) {
    if (typeof u.password === 'string' && u.password && !u.passwordHash) {
      const rec = hashPassword(u.password);
      u.passwordHash = rec.hash;
      u.passwordSalt = rec.salt;
      u.passwordAlgo = 'scrypt';
      u.passwordParams = { N: rec.N, r: rec.r, p: rec.p };
      // 仅对"短到不合规"的口令做提醒；普通弱口令不再强制（项目要求不做强度强制）
      if (isVeryWeak(u.password)) {
        u.mustChangePassword = true;
        weak += 1;
      }
    }
    if (u.password !== undefined) { delete u.password; changed = true; }

    if (typeof u.token === 'string' && u.token && !u.tokenHash) {
      u.tokenHash = hashToken(u.token);
      u.tokenExpiresAt = tokenExpiry();
    }
    if (u.token !== undefined) { delete u.token; changed = true; }

    if (u.tokenHash && !u.tokenExpiresAt) { u.tokenExpiresAt = tokenExpiry(); changed = true; }
    if (!u.createdAt) { u.createdAt = Number(u.id) || Date.now(); changed = true; }
    if (!u.updatedAt) { u.updatedAt = u.createdAt; changed = true; }
    if (typeof u.title !== 'string') { u.title = u.role === 'admin' ? '首席守秘人' : '见习调查员'; changed = true; }
  }
  if (changed) notes.push('用户口令已哈希化、令牌已摘要化');
  if (weak) notes.push(`${weak} 个账号仍在使用弱口令，已标记为需要改密`);

  // v3 -> v4：口令不再强制强度，清掉历史遗留的「需改密」标记
  for (const u of d.users) {
    if (u.mustChangePassword) { u.mustChangePassword = false; changed = true; }
  }

  // v2 -> v3：角色卡增加审核状态字段；新增自定义职业 / 审核记录 / 审卡规则容器
  for (const c of d.characters) {
    if (!c.reviewStatus) { c.reviewStatus = 'none'; changed = true; }
  }
  if (!d.settings || typeof d.settings !== 'object') { d.settings = { auditRules: null }; changed = true; }

  // v4 -> v5：年龄补正改为「力量/体型/体质/敏捷 合计减 N 点、自行分配」，
  // 旧卡补一个空的分配表（空 = 引擎按默认平均分配结算，老卡不会因此丢减值）
  for (const c of d.characters) {
    if (!c.ageAlloc || typeof c.ageAlloc !== 'object' || Array.isArray(c.ageAlloc)) {
      c.ageAlloc = {};
      changed = true;
    }
  }

  // v5 -> v6：教育增强结算记录 / 传奇标记与额外调整值 / KP 年龄减益豁免 / 玩家备注
  for (const c of d.characters) {
    if (!c.eduGrowth || typeof c.eduGrowth !== 'object' || Array.isArray(c.eduGrowth)) {
      const g = blankEduGrowth();
      // 老卡只要已经有教育增强数值，就视为「已结算过」，避免旧提示重新冒出来
      if (Number(c.eduBonus) > 0) { g.settled = true; g.gain = Number(c.eduBonus); }
      c.eduGrowth = g;
      changed = true;
    }
    if (!c.legendary || typeof c.legendary !== 'object' || Array.isArray(c.legendary)) {
      c.legendary = blankLegendary();
      changed = true;
    }
    if (!c.legendaryBonus || typeof c.legendaryBonus !== 'object' || Array.isArray(c.legendaryBonus)) {
      c.legendaryBonus = blankLegendaryBonus();
      changed = true;
    }
    if (typeof c.agePenaltyWaived !== 'boolean') { c.agePenaltyWaived = false; changed = true; }
    if (typeof c.notes !== 'string') { c.notes = ''; changed = true; }
  }

  if (!d.schemaVersion || d.schemaVersion < SCHEMA_VERSION) {
    d.schemaVersion = SCHEMA_VERSION;
    changed = true;
    notes.push(`数据结构升级到 v${SCHEMA_VERSION}（角色卡审核状态 / 自定义职业 / 审卡规则 / 年龄补正分配 / 成长记录与传奇标记）`);
  }
  return { changed, notes };
}

// ------------------------------------------------------------------ 读写
export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // 兼容旧版：数据文件最初放在 backend/database.json，首次运行时搬进 backend/data/
  const legacy = path.join(__dirname, '..', 'database.json');
  if (!fs.existsSync(DB_FILE) && fs.existsSync(legacy) && path.resolve(legacy) !== path.resolve(DB_FILE)) {
    fs.copyFileSync(legacy, DB_FILE);
    console.log(`[db] 已从旧路径 ${legacy} 迁移数据文件`);
    console.log('[db] ⚠️  旧文件里可能仍留有明文口令，确认新库可用后请手动删除它：');
    console.log(`[db]     rm "${legacy}"`);
  }
  let raw = null;
  let existed = false;
  if (fs.existsSync(DB_FILE)) {
    existed = true;
    raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  }
  data = ensureShape(raw || emptyDB());
  const { changed, notes } = migrate(data);
  if (changed || !existed) {
    if (existed) backup('pre-migration');
    writeAtomic(data);
    for (const n of notes) console.log(`[db] ${n}`);
  }
  console.log(`[db] ${DB_FILE} 已载入：users=${data.users.length} modules=${data.modules.length} `
    + `characters=${data.characters.length} 自定义职业=${data.customOccupations.length} 审核记录=${data.reviews.length}`);
  return data;
}

export function db() {
  if (!data) load();
  return data;
}

/** 落盘（原子替换） */
export function save() {
  if (!data) return;
  writeAtomic(data);
}

function writeAtomic(obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  backup('daily');
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  const payload = JSON.stringify(obj, null, 2);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, payload, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, DB_FILE);
}

/** 备份策略：每天最多一份（daily）、迁移前一份（pre-migration），只保留最近 N 份 */
function backup(tag) {
  if (!fs.existsSync(DB_FILE)) return;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(BACKUP_DIR, tag === 'daily' ? `database-${day}.json` : `database-${tag}-${Date.now()}.json`);
    if (!fs.existsSync(file)) fs.copyFileSync(DB_FILE, file);
    const list = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('database-')).sort();
    while (list.length > BACKUP_KEEP) {
      const victim = list.shift();
      fs.unlinkSync(path.join(BACKUP_DIR, victim));
    }
  } catch (err) {
    console.error('[db] 备份失败（不影响主流程）:', err.message);
  }
}

// ------------------------------------------------------------------ 查询助手
export function findUserById(id) {
  return db().users.find((u) => u.id === id) || null;
}
export function findUserByToken(rawToken) {
  if (!rawToken) return null;
  const h = hashToken(rawToken);
  const now = Date.now();
  const user = db().users.find((u) => u.tokenHash && u.tokenHash === h) || null;
  if (!user) return null;
  if (user.tokenExpiresAt && user.tokenExpiresAt < now) return null;
  return user;
}
export function findModuleById(id) {
  return db().modules.find((m) => m.id === id) || null;
}
export function findCharacterById(id) {
  return db().characters.find((c) => c.id === id) || null;
}
export function findCustomOccupationById(id) {
  return db().customOccupations.find((o) => String(o.id) === String(id)) || null;
}
/** KP 自定义职业模板（供规则引擎解析 occupationId） */
export function customOccupations() {
  return db().customOccupations;
}
/** 某张角色卡的审核记录（按时间倒序，最新在前） */
export function reviewsOf(characterId) {
  return db().reviews
    .filter((r) => r.characterId === characterId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** 对外安全投影：任何情况下都不得把口令/令牌字段返回给客户端 */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    title: u.title || '见习调查员',
    mustChangePassword: Boolean(u.mustChangePassword),
  };
}

/**
 * 改名后的连带处理：把该用户名下、playerName 正好等于旧名的角色卡一并改名，
 * 避免"卡上写着旧名字"的错位。玩家自己手填过的其它名字不动。
 * @returns {number} 被同步的角色卡数量
 */
export function syncPlayerName(userId, oldName, newName) {
  let n = 0;
  for (const c of db().characters) {
    if (c.ownerId === userId && (c.playerName || '') === oldName) {
      c.playerName = newName;
      c.updatedAt = Date.now();
      n += 1;
    }
  }
  return n;
}

/** 用户名是否已被占用（改名时排除自己） */
export function usernameTaken(username, exceptUserId = null) {
  return db().users.some((u) => u.username === username && u.id !== exceptUserId);
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}
