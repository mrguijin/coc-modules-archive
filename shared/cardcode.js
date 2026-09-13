/**
 * 角色卡编码导入 / 导出。
 *
 * 目的：把一张卡压成一段可复制的文本，别人粘贴后即可「照着改」，不用重新点技能点。
 *   COC7G1:<base64url(gzip(json))>:<校验码>   ← 浏览器/Node 支持 gzip 时的默认格式
 *   COC7C1:<base64url(json)>:<校验码>          ← 不支持压缩 API 时的降级格式
 *
 * 只导出**玩家输入**（派生值一律由规则引擎重算），且**不含** id / 归属 / 审核 / 模组经历：
 * 导入方拿到的是"能继续编辑的车卡数据"，不是别人的账号资产。
 * 纯函数（除 gzip 外无副作用），前端与测试共用。
 */

import { blankSheet, ALL_CHARS, clampInt } from './coc7e.js';

const VERSION_GZ = 'COC7G1';
const VERSION_RAW = 'COC7C1';

/** 允许在编码里传输的字段（其余一律丢弃） */
const FIELDS = [
  'name', 'playerName', 'occupationId', 'age', 'gender', 'residence', 'birthplace', 'era',
  'chars', 'eduBonus', 'eduGrowth', 'applyAgeAdjust', 'ageAlloc', 'armorPenalty',
  'occPicks', 'skills', 'customSkills', 'weapons', 'equipment', 'currency', 'extraAssets',
  'background', 'experience', 'notes', 'status',
];

// ------------------------------------------------------------------ 编解码工具
function b64encode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(text) {
  const s = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 简易校验码（djb2）：粘贴时被截断/改动能立刻发现 */
export function checksum(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(-6);
}

async function gzip(text) {
  const cs = new CompressionStream('gzip');
  const stream = new Blob([text]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}

const hasStreams = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

// ------------------------------------------------------------------ 打包 / 解包
/** 从完整角色卡里挑出可导出的字段 */
export function packCard(sheet) {
  const s = sheet || {};
  const out = {};
  for (const k of FIELDS) {
    if (s[k] === undefined || s[k] === null) continue;
    out[k] = s[k];
  }
  return out;
}

/**
 * 把编码还原成一张**可直接编辑**的角色卡数据（以 blankSheet 兜底，字段全部经过裁剪）。
 * @returns {{ ok:boolean, sheet?:object, error?:string }}
 */
export function unpackCard(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: '编码内容不是一张角色卡' };
  const base = blankSheet();
  const out = { ...base };
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const int = (v, min, max, dflt = 0) => clampInt(v, min, max, dflt);

  out.name = str(obj.name, 40);
  out.playerName = str(obj.playerName, 40);
  out.occupationId = obj.occupationId === undefined || obj.occupationId === null ? '' : String(obj.occupationId).slice(0, 32);
  out.age = int(obj.age, 15, 120, 25);
  out.gender = str(obj.gender, 20);
  out.residence = str(obj.residence, 40);
  out.birthplace = str(obj.birthplace, 40);
  out.era = ['1920s', '现代', '其他'].includes(obj.era) ? obj.era : '1920s';

  out.chars = { ...base.chars };
  if (obj.chars && typeof obj.chars === 'object') {
    for (const k of ALL_CHARS) out.chars[k] = int(obj.chars[k], 0, 99, 0);
  }
  out.eduBonus = int(obj.eduBonus, 0, 999, 0);
  if (obj.eduGrowth && typeof obj.eduGrowth === 'object') out.eduGrowth = { ...base.eduGrowth, ...obj.eduGrowth };
  out.applyAgeAdjust = obj.applyAgeAdjust !== false;
  if (obj.ageAlloc && typeof obj.ageAlloc === 'object') {
    out.ageAlloc = {};
    for (const k of ['STR', 'SIZ', 'CON', 'DEX']) {
      if (obj.ageAlloc[k] !== undefined) out.ageAlloc[k] = int(obj.ageAlloc[k], 0, 99, 0);
    }
  }
  out.armorPenalty = int(obj.armorPenalty, 0, 10, 0);

  if (obj.occPicks && typeof obj.occPicks === 'object') {
    const arr = (v, max) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, max) : []);
    out.occPicks = {
      free: arr(obj.occPicks.free, 12),
      social: arr(obj.occPicks.social, 12),
      choices: arr(obj.occPicks.choices, 12),
    };
  }

  if (Array.isArray(obj.skills)) {
    out.skills = obj.skills
      .filter((s) => s && typeof s.id === 'string' && typeof s.key === 'string')
      .slice(0, 200)
      .map((s) => ({
        id: s.id.slice(0, 32),
        key: s.key.slice(0, 32),
        custom: str(s.custom, 24),
        occ: int(s.occ, 0, 99, 0),
        interest: int(s.interest, 0, 99, 0),
        growth: int(s.growth, 0, 99, 0),
      }));
  }
  if (Array.isArray(obj.customSkills)) {
    out.customSkills = obj.customSkills.slice(0, 20).map((s, i) => ({
      id: typeof s?.id === 'string' && s.id ? s.id.slice(0, 32) : `cs_import${i}`,
      name: str(s?.name, 24),
      base: int(s?.base, 0, 99, 0),
      occ: int(s?.occ, 0, 99, 0),
      interest: int(s?.interest, 0, 99, 0),
      growth: int(s?.growth, 0, 99, 0),
      isOccupation: Boolean(s?.isOccupation),
    })).filter((s) => s.name);
  }
  if (Array.isArray(obj.weapons)) {
    out.weapons = obj.weapons.slice(0, 11).map((w) => ({
      name: str(w?.name, 40),
      skill: str(w?.skill, 40),
      damage: str(w?.damage, 30),
      range: str(w?.range, 30),
      attacks: str(w?.attacks, 20),
      ammo: str(w?.ammo, 20),
      malfunction: str(w?.malfunction, 20),
    })).filter((w) => w.name);
  }
  out.equipment = str(obj.equipment, 4000);
  out.currency = str(obj.currency, 8);
  out.extraAssets = str(obj.extraAssets, 400);
  if (obj.background && typeof obj.background === 'object') {
    out.background = { ...base.background };
    for (const k of Object.keys(base.background)) out.background[k] = str(obj.background[k], 600);
  }
  out.experience = str(obj.experience, 4000);
  out.notes = str(obj.notes, 4000);
  out.status = ['draft', 'active', 'retired', 'dead'].includes(obj.status) ? obj.status : 'draft';
  // 导入的卡一律从「未提交审核」的草稿开始，且不带传奇标记（那要 KP 单独给）
  out.legendary = { ...base.legendary };
  out.legendaryBonus = { ...base.legendaryBonus };
  out.agePenaltyWaived = false;
  out.moduleLinks = [];
  out.skillMarks = {};
  out.isPublic = false;
  return { ok: true, sheet: out };
}

// ------------------------------------------------------------------ 对外 API
/** 导出一段编码（优先 gzip 压缩版） */
export async function exportCardCode(sheet) {
  const json = JSON.stringify(packCard(sheet));
  if (hasStreams()) {
    try {
      const bytes = await gzip(json);
      const payload = b64encode(bytes);
      return `${VERSION_GZ}:${payload}:${checksum(payload)}`;
    } catch { /* 落到未压缩格式 */ }
  }
  const payload = b64encode(new TextEncoder().encode(json));
  return `${VERSION_RAW}:${payload}:${checksum(payload)}`;
}

/**
 * 解析一段编码。
 * @returns {Promise<{ok:boolean, sheet?:object, error?:string}>}
 */
export async function importCardCode(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: '请先粘贴角色卡编码' };
  const m = /^(COC7[GC]1):([A-Za-z0-9_-]+)(?::([A-Za-z0-9]+))?$/.exec(raw);
  if (!m) return { ok: false, error: '这不是本站的角色卡编码（应以 COC7G1: 或 COC7C1: 开头）' };
  const [, ver, payload, sum] = m;
  if (sum && sum !== checksum(payload)) return { ok: false, error: '编码校验失败，可能复制时被截断或改动，请重新复制完整内容' };
  let json;
  try {
    if (ver === VERSION_GZ) {
      if (!hasStreams()) return { ok: false, error: '当前浏览器不支持解压该编码，请改用未压缩编码或换浏览器' };
      json = await gunzip(b64decode(payload));
    } else {
      json = new TextDecoder().decode(b64decode(payload));
    }
  } catch {
    return { ok: false, error: '编码内容已损坏，无法解析' };
  }
  try {
    return unpackCard(JSON.parse(json));
  } catch {
    return { ok: false, error: '编码内容不是合法的角色卡数据' };
  }
}
