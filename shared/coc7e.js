/**
 * COC 第 7 版「半自动车卡」规则引擎 —— 纯函数，前端与后端共用。
 *
 * 设计原则：
 *  1. 一切派生值（HP/MP/SAN/MOV/DB/体格/半值/五分之一/技能成功率/点数预算）都由此处**重新计算**，
 *     绝不接受调用方传入的派生结果，因此存档里永远不会出现被篡改或过期的派生数据。
 *  2. 不修改入参，全部返回新对象（后端可直接用于响应，前端可直接用于渲染）。
 *  3. 规则冲突只产出 warnings（软提示），不阻塞保存 —— KP 常有房规，系统只做辅助与提示。
 *  4. KP 的「辅助审卡」规则见 auditSheet()：全部可选，未启用的规则不产生任何判定。
 *
 * 数据来源：shared/coc7e-reference.js（由官方空白卡 Excel 生成）。
 */

import {
  SKILLS, SKILL_BY_KEY, SKILL_BY_NAME, SPEC_PRESETS, SPEC_OPTIONS, SPEC_SLOTS,
  SOCIAL_SKILLS, OCCUPATIONS, OCCUPATION_BY_ID, WEAPONS, WEAPON_BY_NAME,
} from './coc7e-reference.js';

export {
  SKILLS, SKILL_BY_KEY, SKILL_BY_NAME, SPEC_PRESETS, SPEC_OPTIONS, SPEC_SLOTS,
  SOCIAL_SKILLS, OCCUPATIONS, OCCUPATION_BY_ID, WEAPONS, WEAPON_BY_NAME,
};

/** 八大属性 + 幸运 */
export const CHARS = ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU'];
export const ALL_CHARS = [...CHARS, 'Luck'];
export const CHAR_LABEL = {
  STR: '力量', CON: '体质', SIZ: '体型', DEX: '敏捷',
  APP: '外貌', INT: '智力', POW: '意志', EDU: '教育', Luck: '幸运',
};

export const STATUSES = ['draft', 'active', 'retired', 'dead'];
export const STATUS_LABEL = { draft: '草稿', active: '使用中', retired: '已退役', dead: '已死亡' };
export const MODULE_ROLES = ['PC', 'NPC', 'KP', '旁观'];
export const ERAS = ['1920s', '现代', '其他'];

/** 审核状态（**不随角色卡打印导出**） */
export const REVIEW_STATUSES = ['none', 'pending', 'approved', 'rejected'];
export const REVIEW_LABEL = {
  none: '未提交审核', pending: '待审核', approved: '已通过', rejected: '已驳回',
};

/** 单技能点投入上限（克苏鲁神话除外，规则允许继续增长） */
export const SKILL_CAP = 99;
/** 角色属性合法区间 */
export const CHAR_MIN = 0;
export const CHAR_MAX = 99;
/** 自定义技能数量上限 */
export const CUSTOM_SKILL_MAX = 20;

/** 需要高亮显示的特殊技能（编辑器与打印共用同一份定义） */
export const SPECIAL_SKILLS = ['credit', 'cthulhu'];

/**
 * 「具名技能」：这些技能虽然不属于专攻组，但同样需要一个自定义名称才有意义。
 * 目前只有母语（需要写明是哪门语言）。为空时**只提示不强制**。
 */
export function isNamedSkill(key) {
  return Boolean(SKILL_BY_KEY[key]?.flags?.includes('named'));
}
export const NAMED_SKILL_HINT = {
  ownLanguage: { label: '语种', placeholder: '例：中文 / 英语 / 拉丁语', warn: '母语未选择语种（不强制，建议填写）' },
};

/** 新建角色卡时给专攻槽位预置的默认方向（规则书最常见的两项） */
export const DEFAULT_SPECS = { 'fighting#0': '斗殴', 'firearms#0': '手枪' };

/** 武器表里必须常驻、不可删除的那一条 */
export const BUILTIN_WEAPON = '徒手';

/**
 * 货币与生活水平（数值取自官方空白卡「资产及物价参考」表）。
 * 换算倍率为**叙事参考**：规则书原表以美元计，其他币种按近似汇率折算。
 */
export const CURRENCIES = {
  '1920s': [
    { code: 'USD', label: '美元 $', symbol: '$', mult: 1 },
    { code: 'GBP', label: '英镑 £', symbol: '£', mult: 0.2 },
    { code: 'CNY', label: '银元 / 大洋', symbol: '元', mult: 2 },
    { code: 'FRF', label: '法郎', symbol: 'Fr', mult: 25 },
  ],
  '现代': [
    { code: 'CNY', label: '人民币 ¥', symbol: '¥', mult: 7 },
    { code: 'USD', label: '美元 $', symbol: '$', mult: 1 },
    { code: 'EUR', label: '欧元 €', symbol: '€', mult: 0.9 },
  ],
};
export const DEFAULT_CURRENCY = { '1920s': 'USD', '现代': 'CNY', '其他': 'USD' };

/**
 * 生活水平档位（官方「资产及物价参考」表）。
 * cash / assets 为按信用评级计算的系数，`fixed` 表示该档为固定值不乘 CR。
 */
const WEALTH_BANDS = {
  '1920s': [
    { min: 0, max: 0, level: '身无分文', cash: { fixed: 0.5 }, assets: { fixed: '没有' } },
    { min: 1, max: 9, level: '拮据', cash: { mult: 1 }, assets: { mult: 10 } },
    { min: 10, max: 49, level: '标准', cash: { mult: 2 }, assets: { mult: 50 } },
    { min: 50, max: 89, level: '小康', cash: { mult: 5 }, assets: { mult: 500 } },
    { min: 90, max: 98, level: '富裕', cash: { mult: 20 }, assets: { mult: 2000 } },
    { min: 99, max: 99, level: '富豪', cash: { fixed: 50000 }, assets: { fixed: '500万+' } },
  ],
  '现代': [
    { min: 0, max: 0, level: '身无分文', cash: { fixed: 10 }, assets: { fixed: '没有' } },
    { min: 1, max: 9, level: '拮据', cash: { mult: 20 }, assets: { mult: 200 } },
    { min: 10, max: 49, level: '标准', cash: { mult: 40 }, assets: { mult: 1000 } },
    { min: 50, max: 89, level: '小康', cash: { mult: 100 }, assets: { mult: 10000 } },
    { min: 90, max: 98, level: '富裕', cash: { mult: 400 }, assets: { mult: 40000 } },
    { min: 99, max: 99, level: '富豪', cash: { fixed: 1000000 }, assets: { fixed: '1亿+' } },
  ],
};
export const WEALTH_LEVELS = ['身无分文', '拮据', '标准', '小康', '富裕', '富豪'];

/** 取某个时代可用的货币列表 */
export function currenciesFor(era) {
  return CURRENCIES[era] || CURRENCIES['1920s'];
}
export function currencyOf(era, code) {
  const list = currenciesFor(era);
  return list.find((c) => c.code === code) || list[0];
}

/** 千分位 + 最多两位小数 */
function fmtMoney(n) {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 由**信用评级 + 时代 + 货币**推出消费水平 / 现金 / 资产（这三项玩家不能手改）。
 * @returns {{level,cash,assets,cashText,assetsText,symbol}}
 */
export function wealthOf(creditRating, era = '1920s', currencyCode) {
  const cr = clampInt(creditRating, 0, 99, 0);
  const bands = WEALTH_BANDS[era] || WEALTH_BANDS['1920s'];
  const band = bands.find((b) => cr >= b.min && cr <= b.max) || bands[bands.length - 1];
  const cur = currencyOf(era, currencyCode);
  const calc = (spec) => {
    if (spec.fixed !== undefined) return spec.fixed;
    return (spec.mult || 0) * cr * cur.mult;
  };
  const cash = calc(band.cash);
  const assets = calc(band.assets);
  return {
    level: band.level,
    symbol: cur.symbol,
    currency: cur.code,
    currencyLabel: cur.label,
    mult: cur.mult,
    cash,
    assets,
    cashText: typeof cash === 'number' ? `${cur.symbol}${fmtMoney(cash)}` : String(cash),
    assetsText: typeof assets === 'number' ? `${cur.symbol}${fmtMoney(assets)}` : String(assets),
  };
}

// ------------------------------------------------------------------ 年龄
/**
 * 年龄补正表（COC 7e 核心规则，与官方空白卡「年龄补正」栏一致）。
 *
 * ⚠️ 规则要点：除**外貌是固定减值**外，其余属性都是「合计减少 N 点，由玩家自行分配」
 * （例如 40 岁是「力量/体质/敏捷合计 −5」，**不是三项各 −5**）。
 * 因此这里返回的是补正池 `pools: [{ keys, points }]`，具体扣在哪几项由 `ageAlloc` 决定；
 * 没填写分配时用 defaultAgeAlloc() 平均分配兜底，保证老存档与新卡都能算出结果。
 *
 * @returns {{pools:Array<{keys:string[],points:number}>, app:number, edu:number,
 *            eduChecks:number, luckRolls:number, movPenalty:number, label:string}}
 */
export function ageAdjust(age) {
  const a = Number(age);
  const base = { pools: [], app: 0, edu: 0, eduChecks: 0, luckRolls: 1, movPenalty: 0, label: '' };
  if (!Number.isFinite(a) || a <= 0) return { ...base, label: '未填写年龄' };
  if (a <= 14) return { ...base, label: '14 岁以下（超出调查员常规范围）' };
  if (a <= 19) {
    return {
      ...base,
      pools: [{ keys: ['STR', 'SIZ'], points: 5 }],
      edu: -5,
      luckRolls: 2,
      label: '15-19 岁：力量/体型合计 −5（自行分配），教育 −5，幸运掷两次取高',
    };
  }
  if (a <= 39) return { ...base, eduChecks: 1, label: '20-39 岁：进行 1 次教育增强检定' };
  const pool = (points) => [{ keys: ['STR', 'CON', 'DEX'], points }];
  if (a <= 49) {
    return {
      ...base,
      pools: pool(5),
      app: -5,
      eduChecks: 2,
      movPenalty: ageMovPenalty(a),
      label: '40-49 岁：力量/体质/敏捷合计 −5（自行分配），外貌 −5，教育增强检定 ×2',
    };
  }
  if (a <= 59) {
    return {
      ...base,
      pools: pool(10),
      app: -10,
      eduChecks: 3,
      movPenalty: ageMovPenalty(a),
      label: '50-59 岁：力量/体质/敏捷合计 −10（自行分配），外貌 −10，教育增强检定 ×3',
    };
  }
  if (a <= 69) {
    return {
      ...base,
      pools: pool(20),
      app: -15,
      eduChecks: 4,
      movPenalty: ageMovPenalty(a),
      label: '60-69 岁：力量/体质/敏捷合计 −20（自行分配），外貌 −15，教育增强检定 ×4',
    };
  }
  if (a <= 79) {
    return {
      ...base,
      pools: pool(40),
      app: -20,
      eduChecks: 4,
      movPenalty: ageMovPenalty(a),
      label: '70-79 岁：力量/体质/敏捷合计 −40（自行分配），外貌 −20，教育增强检定 ×4',
    };
  }
  if (a <= 89) {
    return {
      ...base,
      pools: pool(80),
      app: -25,
      eduChecks: 4,
      movPenalty: ageMovPenalty(a),
      label: '80-89 岁：力量/体质/敏捷合计 −80（自行分配），外貌 −25，教育增强检定 ×4',
    };
  }
  return { ...base, movPenalty: ageMovPenalty(a), label: '90 岁及以上：请与 KP 商议' };
}

/** 年龄补正池涉及的属性键（15-19 为 力量/体型，40+ 为 力量/体质/敏捷） */
export function agePoolKeys(adj) {
  return [...(adj?.pools?.[0]?.keys || [])];
}

/** 年龄补正池需要合计减少的点数 */
export function agePoolPoints(adj) {
  return Math.max(0, Number(adj?.pools?.[0]?.points) || 0);
}

/** 默认分配：把补正池平均分给相关属性（余数按顺序补给前面的属性） */
export function defaultAgeAlloc(adj) {
  const keys = agePoolKeys(adj);
  const need = agePoolPoints(adj);
  const out = {};
  if (!keys.length || !need) return out;
  const each = Math.floor(need / keys.length);
  let rest = need - each * keys.length;
  for (const k of keys) {
    out[k] = each + (rest > 0 ? 1 : 0);
    if (rest > 0) rest -= 1;
  }
  return out;
}

/**
 * 结算玩家填写的年龄补正分配：
 *  - 完全没填（池内一个属性都没有数字）→ 用默认平均分配兜底（老存档也能算出结果）；
 *  - 填过就以填的为准（缺失的属性按 0 计），允许玩家故意少分，校验时给出提示。
 */
export function resolveAgeAlloc(adj, alloc) {
  const keys = agePoolKeys(adj);
  const out = {};
  if (!keys.length) return out;
  const src = alloc && typeof alloc === 'object' ? alloc : {};
  const filled = keys.some((k) => src[k] !== undefined && src[k] !== null && src[k] !== ''
    && Number.isFinite(Number(src[k])));
  if (!filled) return defaultAgeAlloc(adj);
  for (const k of keys) out[k] = clampInt(src[k], 0, 99, 0);
  return out;
}

// --------------------------------------------------- 传奇标记 / 成长记录
/**
 * 「传奇标记」：由 KP 单独给某张角色卡开启，允许它突破属性 99 的上限。
 * 额外调整值走另一个字段 `legendaryBonus`，在界面上**单独一栏**，不与掷骰属性混用。
 */
export function blankLegendary() {
  return { enabled: false, by: '', at: 0, note: '' };
}

export function normalizeLegendary(v) {
  const o = v && typeof v === 'object' ? v : {};
  return {
    enabled: o.enabled === true,
    by: typeof o.by === 'string' ? o.by.slice(0, 40) : '',
    at: Number.isFinite(Number(o.at)) ? Math.trunc(Number(o.at)) : 0,
    note: typeof o.note === 'string' ? o.note.slice(0, 200) : '',
  };
}

export function blankLegendaryBonus() {
  const out = {};
  for (const k of ALL_CHARS) out[k] = 0;
  return out;
}

export function normalizeLegendaryBonus(v) {
  const o = v && typeof v === 'object' ? v : {};
  const out = {};
  for (const k of ALL_CHARS) out[k] = clampInt(o[k], 0, 999, 0);
  return out;
}

/**
 * 教育增强结算记录。
 *
 * v1.7.2 起：
 *  - `attempts` 是**累计流水**，每次结算 append 一条（不再只留最近一条）；
 *  - `granted` 是 KP 已授权、玩家还没用掉的重掷次数；
 *  - 结算过（settled）且没有授权时 **locked = true**：玩家不能再自己重掷或清零，
 *    服务端也会拒绝（见 backend/routes/characters.js 的 guardEduGrowth）。
 */
export function blankEduGrowth() {
  return {
    settled: false, manual: false, count: 0, gain: 0, rolls: [], at: 0, by: '',
    attempts: [], granted: 0, rerolls: 0, locked: false, lastGrant: null, lastReset: null,
  };
}

function normEduRoll(r) {
  return { roll: clampInt(r?.roll, 1, 100, 0), gain: clampInt(r?.gain, 0, 99, 0) };
}

function normStamp(v) {
  if (!v || typeof v !== 'object') return null;
  return {
    at: Number.isFinite(Number(v.at)) ? Math.trunc(Number(v.at)) : 0,
    by: typeof v.by === 'string' ? v.by.slice(0, 40) : '',
  };
}

export function normalizeEduGrowth(v) {
  const o = v && typeof v === 'object' ? v : {};
  const rolls = (Array.isArray(o.rolls) ? o.rolls : []).slice(0, 12).map(normEduRoll);
  const attempts = (Array.isArray(o.attempts) ? o.attempts : []).slice(-20).map((a) => ({
    at: Number.isFinite(Number(a?.at)) ? Math.trunc(Number(a.at)) : 0,
    by: typeof a?.by === 'string' ? a.by.slice(0, 40) : '',
    manual: a?.manual === true,
    count: clampInt(a?.count, 0, 99, 0),
    gain: clampInt(a?.gain, -99, 999, 0),
    rolls: (Array.isArray(a?.rolls) ? a.rolls : []).slice(0, 12).map(normEduRoll),
    totalAfter: clampInt(a?.totalAfter, 0, 9999, 0),
    via: ['roll', 'manual', 'reroll'].includes(a?.via) ? a.via : 'roll',
  }));
  const granted = clampInt(o.granted, 0, 99, 0);
  return {
    settled: o.settled === true,
    manual: o.manual === true,
    count: clampInt(o.count, 0, 99, 0),
    gain: clampInt(o.gain, -99, 999, 0),
    rolls,
    at: Number.isFinite(Number(o.at)) ? Math.trunc(Number(o.at)) : 0,
    by: typeof o.by === 'string' ? o.by.slice(0, 40) : '',
    attempts,
    granted,
    rerolls: Math.max(0, attempts.length - 1),
    locked: false,                     // 由 computeSheet 依据 settled / granted 计算
    lastGrant: normStamp(o.lastGrant),
    lastReset: normStamp(o.lastReset),
  };
}

/**
 * KP 授权一次「教育增强重掷」：玩家下次结算时消耗一次授权（服务端也会扣减）。
 * @param {object} growth 现有 eduGrowth
 * @param {string} actor  操作人（管理员用户名）
 */
export function grantEduReroll(growth, actor = '') {
  const g = normalizeEduGrowth(growth);
  return {
    ...g,
    granted: Math.min(99, g.granted + 1),
    lastGrant: { at: Date.now(), by: String(actor || '').slice(0, 40) },
  };
}

/** 教育增强的简短文案（列表 / 审卡中心 / 详情页共用）：历史记录 / 手动录入 / 检定 N 次 */
export function eduGrowthLabel(growth) {
  const g = normalizeEduGrowth(growth);
  if (!g.settled) return '未结算';
  if (g.count > 0) return `检定 ${g.count} 次`;
  const last = g.attempts[g.attempts.length - 1];
  if (last && last.count > 0) return `检定 ${last.count} 次`;
  return g.manual || last?.manual ? '手动录入' : '历史记录';
}

/** KP 重置教育增强：清空数值与流水，只留下「谁在什么时候重置的」痕迹 */
export function resetEduGrowth(actor = '') {
  return {
    ...blankEduGrowth(),
    lastReset: { at: Date.now(), by: String(actor || '').slice(0, 40) },
  };
}

/** 移动力年龄减值：40 岁起每 10 岁 −1 */
export function ageMovPenalty(age) {  const a = Number(age);
  if (!Number.isFinite(a) || a < 40) return 0;
  return Math.min(5, Math.max(0, Math.floor(a / 10) - 3));
}

/** 应用年龄补正后的有效属性（外貌固定减值；力量/体型/体质/敏捷按玩家分配扣点） */
export function effectiveChars(chars, age, opts = {}) {
  const apply = opts.apply !== false;
  // KP 可以「豁免年龄减益、只保留教育成长」：属性不再因年龄下降，但 eduBonus 照常加
  const waive = opts.waivePenalty === true;
  const eduBonus = clampInt(opts.eduBonus, -99, 99, 0);
  const adj = apply ? ageAdjust(age) : ageAdjust(0);
  const alloc = apply && !waive ? resolveAgeAlloc(adj, opts.ageAlloc) : {};
  const legend = opts.legendary || {};
  const out = {};
  for (const k of ALL_CHARS) {
    let v = clampInt(chars?.[k], CHAR_MIN, CHAR_MAX, 0);
    if (apply) {
      if (!waive) {
        if (k === 'APP') v += adj.app;
        if (k === 'EDU') v += adj.edu;
        v -= alloc[k] || 0;
      }
      if (k === 'EDU') v += eduBonus;
    } else if (k === 'EDU') {
      v += eduBonus;
    }
    // 「传奇」额外调整值单独一栏累加，不与掷骰属性混用
    v += clampInt(legend[k], 0, 999, 0);
    out[k] = Math.max(0, Math.min(999, v));
  }
  return out;
}

// ------------------------------------------------------- 伤害加值 / 体格

/** STR+SIZ -> 伤害加值与体格（COC 7e 表） */
export function damageBonusBuild(str, siz) {
  const total = clampInt(str, 0, 2000, 0) + clampInt(siz, 0, 2000, 0);
  const build = total <= 64 ? -2
    : total <= 84 ? -1
      : total <= 124 ? 0
        : total <= 164 ? 1
          : total <= 204 ? 2
            : total <= 284 ? 3
              : 4 + Math.floor((total - 285) / 80);
  let db;
  if (build <= -2) db = '−2';
  else if (build === -1) db = '−1';
  else if (build === 0) db = '0';
  else if (build === 1) db = '+1D4';
  else db = `+${build - 1}D6`;
  return { total, build, db };
}

/**
 * 移动力：基础 8，力量与敏捷均大于体型 +1，均小于体型 −1，再减年龄与护甲减值。
 * @param {boolean} waiveAgePenalty KP 豁免了年龄减益时，移动力不再因年龄下降
 */
export function movement(str, dex, siz, age, armorPenalty = 0, waiveAgePenalty = false) {
  const s = clampInt(str, 0, 2000, 0), d = clampInt(dex, 0, 2000, 0), z = clampInt(siz, 0, 2000, 0);
  let mov = 8;
  if (s > z && d > z) mov += 1;
  else if (s < z && d < z) mov -= 1;
  const agePenalty = waiveAgePenalty ? 0 : ageMovPenalty(age);
  mov -= agePenalty;
  mov -= Math.max(0, clampInt(armorPenalty, 0, 10, 0));
  return { mov: Math.max(1, mov), agePenalty };
}

// ------------------------------------------------------------------ 技能
/** 专攻槽位 id：非专攻技能就是 key 本身 */
export function slotId(key, index = 0) {
  return isSpec(key) ? `${key}#${index}` : key;
}
export function isSpec(key) {
  return Boolean(SKILL_BY_KEY[key]?.spec);
}
export function specSlots(key) {
  const s = SKILL_BY_KEY[key];
  if (!s?.spec) return 1;
  return SPEC_SLOTS[s.spec] || 1;
}
/** 某个专攻组的下拉可选项（官方常见方向优先） */
export function specOptions(key) {
  const def = SKILL_BY_KEY[key];
  if (!def?.spec) return [];
  const preset = Object.keys(SPEC_PRESETS[def.spec] || {});
  const curated = SPEC_OPTIONS[def.spec] || [];
  return [...new Set([...curated, ...preset])];
}
/** 技能基础值（含专攻预设与 DEX/EDU 公式） */
export function skillBase(key, custom, eff) {
  const def = SKILL_BY_KEY[key];
  if (!def) return 0;
  if (def.flags?.includes('dexHalf')) return Math.floor((eff.DEX || 0) / 2);
  if (def.flags?.includes('edu')) return eff.EDU || 0;
  const preset = custom && def.spec ? SPEC_PRESETS[def.spec]?.[custom] : undefined;
  if (typeof preset === 'number') return preset;
  return typeof def.base === 'number' ? def.base : 0;
}
/** 技能显示名 */
export function skillName(key, custom) {
  const def = SKILL_BY_KEY[key];
  if (!def) return String(custom || key);
  if (def.spec || isNamedSkill(key)) return custom ? `${def.name}（${custom}）` : def.name;
  return def.name;
}

/** 生成一张空白技能槽位表（非专攻技能全覆盖 + 专攻组按官方槽位数展开） */
export function blankSkills() {
  const out = [];
  for (const def of SKILLS) {
    if (def.spec) {
      const n = SPEC_SLOTS[def.spec] || 1;
      for (let i = 0; i < n; i++) {
        const id = `${def.key}#${i}`;
        out.push({ id, key: def.key, custom: DEFAULT_SPECS[id] || '', occ: 0, interest: 0, growth: 0 });
      }
    } else {
      out.push({ id: def.key, key: def.key, custom: '', occ: 0, interest: 0, growth: 0 });
    }
  }
  return out;
}

/** 新建角色卡的初始武器表：只有一条常驻的「徒手」 */
export function blankWeapons() {
  const bare = WEAPON_BY_NAME[BUILTIN_WEAPON];
  return [{
    name: bare.name, skill: bare.skill, damage: bare.damage, range: bare.range,
    attacks: bare.attacks, ammo: bare.ammo, malfunction: bare.malfunction, builtin: true,
  }];
}

/** 新建一条自定义技能的空白结构 */
export function blankCustomSkill(id) {
  return {
    id: id || `cs_${Math.random().toString(36).slice(2, 10)}`,
    name: '', base: 0, occ: 0, interest: 0, growth: 0, isOccupation: false,
  };
}

// -------------------------------------------------------------- 职业与点数
/** 解析职业：支持内置数字 id 与 KP 自定义职业的字符串 id */
export function resolveOccupation(occupationId, ctx = {}) {
  if (occupationId === undefined || occupationId === null || occupationId === '') return null;
  const custom = (ctx.customOccupations || []).find((o) => String(o.id) === String(occupationId));
  if (custom) return custom;
  return OCCUPATION_BY_ID[occupationId] || OCCUPATION_BY_ID[String(occupationId)] || null;
}

/** 全部职业（内置 + KP 自定义），供选择器使用 */
export function allOccupations(ctx = {}) {
  return [...OCCUPATIONS, ...(ctx.customOccupations || [])];
}

/** 职业点预算：按职业公式（教育×4 / 教育×2＋敏捷×2 / MAX(...)）计算 */
export function occupationBudget(occ, eff) {
  if (!occ?.pts) return 0;
  let sum = 0;
  for (const t of occ.pts.terms || []) sum += (eff[t.stat] || 0) * t.mult;
  let best = 0;
  for (const t of occ.pts.max || []) best = Math.max(best, (eff[t.stat] || 0) * t.mult);
  return sum + best;
}

/** 该职业允许投入职业点的技能键集合（固定本职 + 玩家在弹性槽位里的选择） */
export function occupationAllowed(occ, picks = {}) {
  const allowed = new Set(occ?.keys || []);
  // 信用评级是规则中所有职业通用的「职业技能」，必定可用职业点提升
  if (occ) allowed.add('credit');
  const groups = occ?.choices || [];
  (picks.choices || []).forEach((pick, i) => {
    if (pick && groups[i] && groups[i].includes(pick)) allowed.add(pick);
  });
  for (const k of picks.free || []) if (SKILL_BY_KEY[k] && !isSpec(k)) allowed.add(k);
  for (const k of picks.social || []) if (SOCIAL_SKILLS.includes(k)) allowed.add(k);
  // KP 自定义职业可以直接勾选「任意自定义技能名」
  for (const n of occ?.customKeys || []) allowed.add(`custom:${n}`);
  return allowed;
}

/** 职业模板还差多少个待指定槽位 */
export function occupationNeeds(occ, picks = {}) {
  if (!occ) return { social: 0, free: 0, choices: 0 };
  return {
    social: Math.max(0, (occ.social || 0) - (picks.social || []).length),
    free: Math.max(0, (occ.free || 0) - (picks.free || []).length),
    choices: (occ.choices || []).filter((_, i) => !(picks.choices || [])[i]).length,
  };
}

/**
 * 职业模板里「官方指定的专攻方向」清单。
 * 来源：官方 Excel「职业列表」本职技能原文里的括号与具体分支
 * （例：神职人员(天主教牧师) → 外语（拉丁文）= 拉丁语；医生 → 拉丁语；警察 → 格斗（斗殴））。
 * 只做**提示与软校验**，不阻塞玩家自选方向（KP 常有房规）。
 * @returns {Array<{key:string,name:string,options:string[],required:boolean}>}
 */
export function occupationBranchHints(occ) {
  const out = [];
  const presets = occ?.presets;
  if (!presets || typeof presets !== 'object') return out;
  for (const [key, options] of Object.entries(presets)) {
    const def = SKILL_BY_KEY[key];
    if (!def) continue;
    const opts = (Array.isArray(options) ? options : [])
      .filter((x) => typeof x === 'string' && x.trim())
      .map((x) => x.trim());
    if (!opts.length) continue;
    out.push({ key, name: def.name, options: [...new Set(opts)], required: opts.length === 1 });
  }
  return out;
}

// ------------------------------------------------------------ 主计算入口
/**
 * 计算一张角色卡的全部派生数据。入参为**存档结构**，返回值可安全地直接下发给前端。
 * @param {object} sheet 角色卡存档数据
 * @param {{occupations?:object, customOccupations?:Array}} [ctx] 额外职业（KP 自定义模板）
 */
export function computeSheet(sheet, ctx = {}) {
  const s = sheet || {};
  const age = clampInt(s.age, 0, 200, 0);
  const applyAge = s.applyAgeAdjust !== false;
  const raw = {};
  for (const k of ALL_CHARS) raw[k] = clampInt(s.chars?.[k], 0, 999, 0);
  const waivePenalty = s.agePenaltyWaived === true;
  const legendary = normalizeLegendary(s.legendary);
  const legendaryBonus = normalizeLegendaryBonus(s.legendaryBonus);
  const eff = effectiveChars(raw, age, {
    apply: applyAge,
    waivePenalty,
    eduBonus: s.eduBonus,
    ageAlloc: s.ageAlloc,
    legendary: legendaryBonus,
  });

  const half = {}, fifth = {};
  for (const k of ALL_CHARS) {
    half[k] = Math.floor(eff[k] / 2);
    fifth[k] = Math.floor(eff[k] / 5);
  }

  const hp = Math.floor((eff.CON + eff.SIZ) / 10);
  const mp = Math.floor(eff.POW / 5);
  const san = eff.POW;
  const dbb = damageBonusBuild(eff.STR, eff.SIZ);
  const mv = movement(eff.STR, eff.DEX, eff.SIZ, age, s.armorPenalty, waivePenalty);
  const dodgeBase = Math.floor(eff.DEX / 2);

  const occ = resolveOccupation(s.occupationId, ctx);
  const picks = s.occPicks || { free: [], social: [], choices: [] };
  const allowed = occupationAllowed(occ, picks);
  const budget = { occupation: occupationBudget(occ, eff), interest: eff.INT * 2 };

  // 标准技能：以存档为准，但 id/key/基础值全部由本引擎重建，忽略存档里可能被篡改的重复项
  const incoming = new Map();
  for (const item of Array.isArray(s.skills) ? s.skills : []) {
    if (!item || typeof item.id !== 'string') continue;
    if (!SKILL_BY_KEY[item.key]) continue;
    if (incoming.has(item.id)) continue;                 // 重复 id 只取第一条
    incoming.set(item.id, item);
  }
  const skills = [];
  let occSpent = 0, interestSpent = 0;
  for (const slot of blankSkills()) {
    const src = incoming.get(slot.id);
    const custom = cleanCustom(slot.key, src?.custom);
    const base = skillBase(slot.key, custom, eff);
    const o = clampInt(src?.occ, 0, SKILL_CAP, 0);
    const i = clampInt(src?.interest, 0, SKILL_CAP, 0);
    const g = clampInt(src?.growth, 0, SKILL_CAP, 0);
    const def = SKILL_BY_KEY[slot.key];
    const capExempt = def.flags?.includes('nocap');
    const total = Math.min(capExempt ? 999 : SKILL_CAP, base + o + i + g);
    occSpent += o;
    interestSpent += i;
    skills.push({
      id: slot.id, key: slot.key, custom, name: skillName(slot.key, custom),
      base, occ: o, interest: i, growth: g, total,
      half: Math.floor(total / 2), fifth: Math.floor(total / 5),
      isOccupation: allowed.has(slot.key), capExempt, spec: def.spec || null,
      special: SPECIAL_SKILLS.includes(slot.key) ? slot.key : null,
      kind: 'standard',
      used: Boolean(src && (o > 0 || i > 0 || g > 0 || custom)),
    });
  }

  // 自定义技能：玩家自行命名、自填基础值；同样只信输入不信结果
  const customSeen = new Set();
  for (const item of Array.isArray(s.customSkills) ? s.customSkills : []) {
    const id = typeof item?.id === 'string' ? item.id.slice(0, 32) : '';
    const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 24) : '';
    if (!id || !name || customSeen.has(id)) continue;
    customSeen.add(id);
    const base = clampInt(item.base, 0, SKILL_CAP, 0);
    const o = clampInt(item.occ, 0, SKILL_CAP, 0);
    const i = clampInt(item.interest, 0, SKILL_CAP, 0);
    const g = clampInt(item.growth, 0, SKILL_CAP, 0);
    const total = Math.min(SKILL_CAP, base + o + i + g);
    occSpent += o;
    interestSpent += i;
    skills.push({
      id, key: `custom:${name}`, custom: '', name,
      base, occ: o, interest: i, growth: g, total,
      half: Math.floor(total / 2), fifth: Math.floor(total / 5),
      isOccupation: Boolean(item.isOccupation) || allowed.has(`custom:${name}`),
      capExempt: false, spec: null, special: null,
      kind: 'custom',
      used: true,
    });
  }

  const spent = { occupation: occSpent, interest: interestSpent };
  const remaining = {
    occupation: budget.occupation - occSpent,
    interest: budget.interest - interestSpent,
  };

  const credit = skills.find((x) => x.key === 'credit');
  const adj = ageAdjust(age);
  /** 年龄补正的实际分配（未填时用默认平均分配兜底） */
  const ageAlloc = applyAge && !waivePenalty ? resolveAgeAlloc(adj, s.ageAlloc) : {};
  const ageAllocSum = Object.values(ageAlloc).reduce((a, b) => a + b, 0);
  const agePool = waivePenalty ? 0 : agePoolPoints(adj);
  const eduGrowth = normalizeEduGrowth(s.eduGrowth);
  const eduBonus = clampInt(s.eduBonus, -99, 999, 0);
  // 只要已经有提升值（老数据 / 手动录入 / 只提交了 eduBonus），就视为「已结算」：
  // 「该年龄需要做 N 次教育增强检定」的提示不该因为没带记录而反复出现。
  if (!eduGrowth.settled && eduBonus > 0) { eduGrowth.settled = true; eduGrowth.gain = eduBonus; eduGrowth.manual = true; }
  // 结算过又没有 KP 授权 → 锁定：玩家不能再自助重掷或清零（服务端同样会拦）
  eduGrowth.locked = eduGrowth.settled && eduGrowth.granted <= 0;

  // 消费水平 / 现金 / 资产：由信用评级 + 时代 + 货币推导，玩家不可手改
  const creditRating = credit ? credit.total : 0;
  const wealth = wealthOf(creditRating, s.era || '1920s', s.currency);

  // 技能标记（官方卡上的小方块，用于标记"本局大成功过"）
  const markIn = s.skillMarks && typeof s.skillMarks === 'object' ? s.skillMarks : {};
  for (const sk of skills) sk.marked = Boolean(markIn[sk.id]);

  return {
    eff, raw, half, fifth, age,
    hp, mp, san, mov: mv.mov, movAgePenalty: mv.agePenalty,
    db: dbb.db, build: dbb.build, strSiz: dbb.total,
    dodgeBase, ownLanguageBase: eff.EDU,
    /** 传奇标记与额外调整值（只有 KP 能改） */
    legendary,
    legendaryBonus,
    /** KP 是否豁免了年龄减益（只保留教育成长） */
    waiveAgePenalty: waivePenalty,
    /** 教育增强结算记录（KP 可见） */
    eduGrowth,
    /** 玩家备注：只记录，不参与打印 */
    notes: typeof s.notes === 'string' ? s.notes.slice(0, 4000) : '',
    ageAdjust: {
      ...adj,
      apply: applyAge,
      waived: waivePenalty,
      settled: eduGrowth.settled,
      eduBonus,
      alloc: ageAlloc,
      allocSum: ageAllocSum,
      poolPoints: agePool,
      poolKeys: agePoolKeys(adj),
      allocComplete: agePool === 0 || ageAllocSum === agePool,
    },
    occupation: occ ? {
      id: occ.id, name: occ.name, cr: occ.cr, attr: occ.attr, desc: occ.desc,
      presets: occ.presets || {}, skillText: occ.skillText || '', note: occ.note || '',
      custom: occ.isCustom === true,
    } : null,
    /** 当前职业要求的信用评级区间，供界面高亮显示 */
    creditRange: occ?.cr || null,
    creditInRange: occ ? (() => {
      const [lo, hi] = occ.cr || [0, 99];
      const v = credit ? credit.total : 0;
      return v >= lo && v <= hi;
    })() : null,
    allowedSkills: [...allowed],
    needs: occupationNeeds(occ, picks),
    budget, spent, remaining,
    creditRating,
    wealth,
    skills,
    customSkillCount: skills.filter((x) => x.kind === 'custom').length,
    markedCount: skills.filter((x) => x.marked).length,
  };
}

/** 规则校验：返回人性化提示数组（不阻塞保存） */
export function validateSheet(sheet, ctx = {}) {
  const c = computeSheet(sheet, ctx);
  const w = [];
  const occ = c.occupation;
  const lbl = (k) => CHAR_LABEL[k] || k;

  for (const k of ALL_CHARS) {
    const v = sheet?.chars?.[k];
    if (v === '' || v === null || v === undefined) continue;
    if (!Number.isFinite(Number(v))) { w.push(`${lbl(k)} 不是有效数字`); continue; }
    const n = Number(v);
    if (n < CHAR_MIN || n > CHAR_MAX) w.push(`${lbl(k)} ${n} 超出常规范围 ${CHAR_MIN}-${CHAR_MAX}（人类调查员）`);
  }
  if (CHARS.every((k) => !c.raw[k])) w.push('还有属性未填写（为 0）');
  // 教育增强：只要「还没结算过」就提示 —— 结算过（哪怕这次没提升）就不再打扰
  if (c.ageAdjust.eduChecks > 0 && c.ageAdjust.apply && !c.ageAdjust.settled) {
    w.push(`该年龄需要做 ${c.ageAdjust.eduChecks} 次教育增强检定，请在「教育增强」中填入提升总值`);
  }
  if (c.ageAdjust.waived) w.push('KP 已豁免这张卡的年龄减益（属性不因年龄下降，教育成长照常保留）');
  if (c.legendary.enabled) {
    const bonusTotal = CHARS.reduce((a, k) => a + (c.legendaryBonus[k] || 0), 0);
    if (bonusTotal <= 0) w.push('已开启传奇标记，但还没有填写任何额外属性调整值');
  } else {
    const any = ALL_CHARS.some((k) => (c.legendaryBonus[k] || 0) > 0);
    if (any) w.push('填写了传奇额外调整值，但传奇标记未开启（该调整值暂不生效）');
  }
  if ((sheet?.age || 0) > 0 && (sheet?.age || 0) < 15) w.push('年龄小于 15 岁，超出常规调查员范围');
  if ((sheet?.age || 0) > 90) w.push('年龄超过 90 岁，超出常规调查员范围，请先与 KP 商议');

  // 年龄补正：除外貌固定减值外，其余属性是「合计减少 N 点，自行分配」
  if (c.ageAdjust.apply && c.ageAdjust.poolPoints > 0) {
    const need = c.ageAdjust.poolPoints;
    const names = c.ageAdjust.poolKeys.map(lbl).join('/');
    if (!c.ageAdjust.allocComplete) {
      const diff = need - c.ageAdjust.allocSum;
      w.push(diff > 0
        ? `年龄补正未分配完：${names} 合计需减少 ${need} 点，当前只分配了 ${c.ageAdjust.allocSum} 点`
        : `年龄补正分配超出：${names} 合计只需减少 ${need} 点，当前分配了 ${c.ageAdjust.allocSum} 点`);
    }
    for (const k of c.ageAdjust.poolKeys) {
      const cut = c.ageAdjust.alloc[k] || 0;
      if (cut > c.raw[k]) w.push(`${lbl(k)} 只掷出 ${c.raw[k]} 点，却分配了 ${cut} 点年龄减值`);
    }
  }

  if (!occ) {
    w.push('尚未选择职业：请从职业列表中选择一个职业（不再支持自定义职业）');
    if (c.spent.occupation > 0) w.push('尚未选择职业，却已投入职业点');
  } else {
    if (c.spent.occupation > c.budget.occupation) {
      w.push(`职业点超支：已用 ${c.spent.occupation} / 上限 ${c.budget.occupation}`);
    }
    const illegal = c.skills.filter((s) => s.occ > 0 && !s.isOccupation);
    if (illegal.length) {
      w.push(`以下技能不是本职技能，不能投入职业点：${illegal.map((s) => s.name).join('、')}`);
    }
    const bothPoints = c.skills.filter((s) => s.occ > 0 && s.interest > 0);
    if (bothPoints.length) {
      w.push(`同一个技能不能同时吃职业点与兴趣点：${bothPoints.map((s) => `${s.name}(职业${s.occ}+兴趣${s.interest})`).join('、')}`);
    }
    const creditInt = c.skills.find((s) => s.key === 'credit' && s.interest > 0);
    if (creditInt) w.push('信用评级只能用职业点提升，不能投入兴趣点');
    const cr = occ.cr || [0, 99];
    if (c.creditRating < cr[0] || c.creditRating > cr[1]) {
      w.push(`信用评级 ${c.creditRating} 不在【${occ.name}】要求的 ${cr[0]}-${cr[1]} 区间内`);
    }
    if (c.needs.social > 0) w.push(`还需指定 ${c.needs.social} 项社交技能作为本职技能`);
    if (c.needs.free > 0) w.push(`还需指定 ${c.needs.free} 项任意特长作为本职技能`);
    if (c.needs.choices > 0) w.push(`还有 ${c.needs.choices} 组「任选其一」的本职技能未选择`);
    // 官方指定/建议的专攻方向（如 牧师 → 拉丁语）：只提示，方便 KP 审核
    for (const h of occupationBranchHints(occ)) {
      const slots = c.skills.filter((s) => s.key === h.key);
      const filled = slots.filter((s) => s.custom);
      if (filled.some((s) => h.options.includes(s.custom))) continue;
      const want = h.required ? `指定：${h.options.join(' / ')}` : `建议从中选择：${h.options.join(' / ')}`;
      if (!filled.length) w.push(`【${occ.name}】的「${h.name}」尚未选择方向（官方${want}）`);
      else w.push(`【${occ.name}】的「${h.name}」官方${want}，当前填写的是「${filled.map((s) => s.custom).join('、')}」`);
    }
  }

  if (c.spent.interest > c.budget.interest) {
    w.push(`兴趣点超支：已用 ${c.spent.interest} / 上限 ${c.budget.interest}（智力 ×2）`);
  }
  const overCap = c.skills.filter((s) => !s.capExempt && s.base + s.occ + s.interest + s.growth > SKILL_CAP);
  if (overCap.length) w.push(`以下技能超过 ${SKILL_CAP}%：${overCap.map((s) => s.name).join('、')}`);

  const unnamedSpec = c.skills.filter((s) => s.spec && !s.custom
    && (s.occ > 0 || s.interest > 0 || s.growth > 0));
  if (unnamedSpec.length) w.push(`有 ${unnamedSpec.length} 个专攻技能投入了点数但未选择方向`);

  // 母语没写语种：只提示，不阻塞保存
  const ownLang = c.skills.find((x) => x.key === 'ownLanguage');
  if (ownLang && !ownLang.custom) w.push(NAMED_SKILL_HINT.ownLanguage.warn);

  return w;
}

// --------------------------------------------------------- KP 辅助审卡规则
/**
 * 全部规则均为**可选**：值为 0 / false 表示不启用该条检查。
 * 由 KP 通过界面保存，对全站生效。
 */
export const DEFAULT_AUDIT_RULES = {
  enabled: false,
  charMax: 0,              // 任意属性「有效值」上限（0=不检查）
  charMin: 0,              // 任意属性有效值下限
  charTotalMax: 0,         // 八项属性有效值之和上限
  occSkillMax: 0,          // 投入过职业点的技能：成功率上限
  interestSkillMax: 0,     // 投入过兴趣点的技能：成功率上限
  requireCreditInRange: true,   // 信用评级必须落在职业区间
  forbidMixedPoints: true,      // 禁止混点：职业点限本职 + 同技能禁双点 + 信用评级仅职业点
  requireOccupation: false,     // 必须选择职业
  backgroundMinFields: 0,       // 背景故事至少填写的栏数
  minPointUsage: 0,             // 职业点至少用掉的比例（0~1）
  flagCustomSkills: true,       // 使用了自定义技能 → 提示 KP 重点核查
  checkOccBranches: true,       // 职业技能的官方指定专攻方向（外语（拉丁语）等）核对
};

export const AUDIT_RULE_META = [
  { key: 'charMax', label: '属性有效值上限', type: 'number', hint: '任意一项属性超过该值即不合规；0 = 不检查' },
  { key: 'charMin', label: '属性有效值下限', type: 'number', hint: '防止刻意压低属性；0 = 不检查' },
  { key: 'charTotalMax', label: '属性总和上限', type: 'number', hint: '八项属性（不含幸运）有效值之和；0 = 不检查' },
  { key: 'occSkillMax', label: '职业技能成功率上限', type: 'number', hint: '投入过职业点的技能，其成功率不得超过该值；0 = 不检查' },
  { key: 'interestSkillMax', label: '兴趣技能成功率上限', type: 'number', hint: '投入过兴趣点的技能，其成功率不得超过该值；0 = 不检查' },
  { key: 'backgroundMinFields', label: '背景故事最少填写栏数', type: 'number', hint: '共 10 栏；0 = 不检查' },
  { key: 'minPointUsage', label: '职业技能点最低使用率', type: 'number', hint: '0~1，例如 0.8 表示至少用掉 80% 的职业点；0 = 不检查' },
  { key: 'requireCreditInRange', label: '信用评级须符合职业区间', type: 'boolean' },
  { key: 'forbidMixedPoints', label: '禁止混点（职业点限本职 · 同技能禁双点 · 信用评级仅职业点）', type: 'boolean' },
  { key: 'requireOccupation', label: '必须选择职业', type: 'boolean' },
  { key: 'flagCustomSkills', label: '使用自定义技能时提示 KP 重点核查', type: 'boolean' },
  { key: 'checkOccBranches', label: '核对职业的官方指定专攻方向（如 外语（拉丁语））', type: 'boolean' },
];

/**
 * 依据 KP 设定的规则审核一张角色卡。
 * @returns {{passed:boolean, findings:Array<{id,label,level,detail}>, stats:object}}
 *          level: 'error' 不合规 / 'warn' 需留意 / 'info' 仅供参考
 */
export function auditSheet(sheet, rulesInput = {}, ctx = {}) {
  const r = { ...DEFAULT_AUDIT_RULES, ...(rulesInput || {}) };
  const c = computeSheet(sheet, ctx);
  const findings = [];
  const add = (id, label, level, detail) => findings.push({ id, label, level, detail });

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const charTotal = CHARS.reduce((a, k) => a + c.eff[k], 0);
  const legendaryOn = c.legendary.enabled === true;

  // KP 给这张卡开了「传奇标记」：属性与总和上限规则不再适用（这正是它存在的意义）
  if (legendaryOn) {
    const bonusTotal = CHARS.reduce((a, k) => a + (c.legendaryBonus[k] || 0), 0);
    add('legendary', '传奇标记已开启', 'info',
      `KP 已允许该角色突破属性 99 上限；额外调整值合计 +${bonusTotal}（单独一栏，不与原始属性混用）`);
  }

  const max = num(r.charMax);
  if (max > 0 && !legendaryOn) {
    for (const k of ALL_CHARS) {
      if (c.eff[k] > max) add(`charMax.${k}`, '属性上限', 'error', `${CHAR_LABEL[k]} ${c.eff[k]} 超过上限 ${max}`);
    }
  }
  const min = num(r.charMin);
  if (min > 0) {
    for (const k of ALL_CHARS) {
      if (c.eff[k] < min) add(`charMin.${k}`, '属性下限', 'warn', `${CHAR_LABEL[k]} ${c.eff[k]} 低于下限 ${min}`);
    }
  }
  if (num(r.charTotalMax) > 0 && !legendaryOn && charTotal > num(r.charTotalMax)) {
    add('charTotalMax', '属性总和上限', 'error', `八项属性合计 ${charTotal}，超过上限 ${num(r.charTotalMax)}`);
  }
  if (r.requireOccupation && !c.occupation) {
    add('requireOccupation', '必须选择职业', 'error', '尚未选择职业');
  }

  if (num(r.minPointUsage) > 0 && c.budget.occupation > 0) {
    const usage = c.spent.occupation / c.budget.occupation;
    if (usage < num(r.minPointUsage)) {
      add('minPointUsage', '职业点使用率过低', 'warn',
        `仅用掉 ${(usage * 100).toFixed(0)}% 的职业点（要求 ≥ ${(num(r.minPointUsage) * 100).toFixed(0)}%）`);
    }
  }

  if (r.forbidMixedPoints) {
    // ① 职业点只能投在本职技能上
    const notOcc = c.skills.filter((s) => s.occ > 0 && !s.isOccupation);
    if (notOcc.length) {
      add('forbidMixedPoints', '职业点只能投本职技能', 'error',
        `以下技能不是本职，不能使用职业点：${notOcc.map((s) => `${s.name}(${s.occ})`).join('、')}`);
    }
    // ② 同一个技能不能被职业点和兴趣点同时分配（例：侦查 职业15 + 兴趣15 ✗）
    const both = c.skills.filter((s) => s.occ > 0 && s.interest > 0);
    if (both.length) {
      add('forbidMixedPoints.sameSkill', '同一技能不能混用职业点与兴趣点', 'error',
        `以下技能同时吃了职业点与兴趣点：${both.map((s) => `${s.name}(职业${s.occ}+兴趣${s.interest})`).join('、')}`
        + '；请只保留其中一种（本职技能可以改投兴趣点，上限按兴趣技能计算）');
    }
    // ③ 信用评级始终只能用职业点
    const creditInterest = c.skills.filter((s) => s.key === 'credit' && s.interest > 0);
    if (creditInterest.length) {
      add('forbidMixedPoints.credit', '信用评级只能用职业点', 'error',
        `信用评级投入了 ${creditInterest[0].interest} 点兴趣点；规则要求信用评级始终使用职业技能点提升`);
    }
  }

  if (r.requireCreditInRange && c.occupation) {
    const [lo, hi] = c.occupation.cr || [0, 99];
    if (c.creditRating < lo || c.creditRating > hi) {
      add('requireCreditInRange', '信用评级不符合职业区间', 'error',
        `信用评级 ${c.creditRating}%，职业【${c.occupation.name}】要求 ${lo}-${hi}%`);
    }
  }

  const occSkillMax = num(r.occSkillMax);
  if (occSkillMax > 0) {
    const over = c.skills.filter((s) => s.occ > 0 && !s.capExempt && s.total > occSkillMax);
    if (over.length) {
      add('occSkillMax', '职业技能成功率上限', 'error',
        `以下技能用职业点提升后超过 ${occSkillMax}%：${over.map((s) => `${s.name}(${s.total})`).join('、')}`);
    }
  }
  const intSkillMax = num(r.interestSkillMax);
  if (intSkillMax > 0) {
    const over = c.skills.filter((s) => s.interest > 0 && !s.capExempt && s.total > intSkillMax);
    if (over.length) {
      add('interestSkillMax', '兴趣技能成功率上限', 'error',
        `以下技能用兴趣点提升后超过 ${intSkillMax}%：${over.map((s) => `${s.name}(${s.total})`).join('、')}`);
    }
  }

  if (num(r.backgroundMinFields) > 0) {
    const filled = Object.values(sheet?.background || {}).filter((v) => String(v || '').trim()).length;
    if (filled < num(r.backgroundMinFields)) {
      add('backgroundMinFields', '背景故事不完整', 'warn',
        `仅填写 ${filled} / 10 栏，要求至少 ${num(r.backgroundMinFields)} 栏`);
    }
  }

  // 教育增强（年龄成长）：KP 要能一眼看出「还没结算」和「重掷过几次」
  if (c.ageAdjust.apply && c.ageAdjust.eduChecks > 0 && !c.eduGrowth.settled) {
    add('eduUnsettled', '教育增强未结算', 'warn',
      `该年龄需要 ${c.ageAdjust.eduChecks} 次教育增强检定，玩家还没有结算`);
  }
  if (c.eduGrowth.attempts.length > 1) {
    const g = c.eduGrowth.lastGrant;
    add('eduReroll', '教育增强重掷过', 'warn',
      `共结算 ${c.eduGrowth.attempts.length} 次（重掷 ${c.eduGrowth.rerolls} 次），当前 +${c.eduGrowth.gain}`
      + (g?.by ? `；最近一次授权：${g.by}` : '；没有 KP 授权记录，请核实'));
  }

  if (r.flagCustomSkills) {
    const custom = c.skills.filter((s) => s.kind === 'custom');
    if (custom.length) {
      add('flagCustomSkills', '使用了自定义技能', 'info',
        `共 ${custom.length} 项：${custom.map((s) => s.name).join('、')}，建议逐项确认基础值与点数`);
    }
  }

  // 官方指定的专攻方向（如 神职人员/牧师 → 外语（拉丁语））：软提示，供 KP 审核
  if (r.checkOccBranches && c.occupation) {
    for (const h of occupationBranchHints(c.occupation)) {
      const slots = c.skills.filter((s) => s.key === h.key);
      const filled = slots.filter((s) => s.custom);
      if (filled.some((s) => h.options.includes(s.custom))) continue;
      const want = h.required ? `指定 ${h.options.join(' / ')}` : `建议 ${h.options.join(' / ')}`;
      add(`occBranch.${h.key}`, '职业指定专攻方向', 'warn',
        `【${c.occupation.name}】的「${h.name}」官方${want}；当前${filled.length ? `填写为「${filled.map((s) => s.custom).join('、')}」` : '未选择方向'}`);
    }
  }
  return {
    passed: !findings.some((f) => f.level === 'error'),
    findings,
    stats: {
      charTotal,
      occupationPoints: c.spent.occupation,
      occupationBudget: c.budget.occupation,
      interestPoints: c.spent.interest,
      interestBudget: c.budget.interest,
      markedCount: c.markedCount,
      creditRating: c.creditRating,
      creditRange: c.occupation?.cr || null,
      skillCount: c.skills.filter((s) => s.used).length,
      customSkillCount: c.skills.filter((s) => s.kind === 'custom').length,
      // KP 审核时要能一眼看到「成长过没有」与「是不是传奇卡」
      legendary: c.legendary.enabled === true,
      legendaryBonusTotal: CHARS.reduce((a, k) => a + (c.legendaryBonus[k] || 0), 0),
      agePenaltyWaived: c.waiveAgePenalty === true,
      eduBonus: c.ageAdjust.eduBonus,
      eduSettled: c.eduGrowth.settled,
      eduCount: c.eduGrowth.count,
      eduManual: c.eduGrowth.manual,
    },
  };
}

// ------------------------------------------------------------------ 工具
export function clampInt(v, min, max, dflt = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function cleanCustom(key, v) {
  const def = SKILL_BY_KEY[key];
  if (!def?.spec && !isNamedSkill(key)) return '';
  const s = typeof v === 'string' ? v.trim().slice(0, 24) : '';
  return s;
}

/** 空角色卡模板（前端新建时使用） */
export function blankSheet(ownerId = '') {
  const chars = {};
  for (const k of ALL_CHARS) chars[k] = 0;
  return {
    name: '', playerName: '', occupationId: '', age: 25, gender: '', residence: '', birthplace: '', era: '1920s',
    chars, eduBonus: 0, applyAgeAdjust: true, armorPenalty: 0, ageAlloc: {},
    eduGrowth: blankEduGrowth(),          // 教育增强结算记录（KP 可见）
    legendary: blankLegendary(),          // 传奇标记（KP 单独开启，允许突破 99）
    legendaryBonus: blankLegendaryBonus(),// 传奇额外调整值（单独一栏）
    agePenaltyWaived: false,              // KP 是否豁免年龄减益（只保留成长）
    notes: '',                            // 玩家备注：只记录，不打印
    occPicks: { free: [], social: [], choices: [] },
    skills: blankSkills(),
    customSkills: [],
    skillMarks: {},
    weapons: blankWeapons(),
    equipment: '',
    currency: DEFAULT_CURRENCY['1920s'],
    extraAssets: '',
    assets: { spending: '', cash: '', assets: '' },
    background: {
      appearance: '', traits: '', ideology: '', injuries: '', people: '',
      phobias: '', locations: '', tomes: '', possessions: '', encounters: '',
    },
    moduleLinks: [],
    experience: '',
    status: 'draft',
    isPublic: false,
    ownerId,
  };
}

/** 角色卡背景故事字段的中文标签（官方纸质卡版面顺序） */
export const BACKGROUND_FIELDS = [
  ['appearance', '形象描述'],
  ['traits', '特质'],
  ['ideology', '思想与信念'],
  ['injuries', '伤口和疤痕'],
  ['people', '重要之人'],
  ['phobias', '恐惧症和躁狂症'],
  ['locations', '意义非凡之地'],
  ['tomes', '神话典籍、法术和魔法物品'],
  ['possessions', '宝贵之物'],
  ['encounters', '第三类接触'],
];
