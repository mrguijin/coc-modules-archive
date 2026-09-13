/**
 * 骰娘机器人导入指令 —— 与官方车卡 Excel「简化卡 骰娘导入」同格式。
 *
 * 生成形如：
 *   .st 力量50str50敏捷60dex60意志55pow55体质50con50外貌65app65教育70edu70体型60siz60
 *      智力60灵感60int60san55san值55理智55理智值55幸运45运气45mp11魔法11hp12体力12
 *      会计5侦查25... &DB=0 体格:0 闪避:30 护甲:无 &点38左轮=1D10
 *
 * 四种骰娘的前缀不同（见 DICEBOT_FORMATS），技能别名表取自 Excel 的「技能名的改变」一栏。
 * 纯函数，前端与测试共用。
 */

import { ALL_CHARS, SKILL_BY_KEY } from './coc7e.js';

/** 属性输出顺序与别名（对齐 Excel：中文名 + 英文缩写，智力额外给「灵感」） */
const CHAR_TOKENS = [
  ['STR', ['力量', 'str']],
  ['DEX', ['敏捷', 'dex']],
  ['POW', ['意志', 'pow']],
  ['CON', ['体质', 'con']],
  ['APP', ['外貌', 'app']],
  ['EDU', ['教育', 'edu']],
  ['SIZ', ['体型', 'siz']],
  ['INT', ['智力', '灵感', 'int']],
];

/** 技能别名（Excel「技能名的改变」+ 规则书常见叫法），键为我们的技能中文名 */
export const SKILL_ALIASES = {
  汽车驾驶: ['汽车', '驾驶'],
  电子学: [],
  步枪霰弹枪: ['步枪', '霰弹枪', '步霰'],
  图书馆使用: ['图书馆'],
  锁匠: ['开锁', '撬锁'],
  博物学: ['自然学'],
  计算机使用: ['计算机', '电脑'],
  导航: ['领航'],
  信用评级: ['信用', '信誉'],
  操作重型机械: ['重型操作', '重型机械', '重型', '重型机械操作'],
  克苏鲁神话: ['克苏鲁', 'cm'],
  取悦: ['魅惑'],
  格斗: [],
  射击: [],
  外语: [],
  技艺: [],
  科学: [],
  驾驶: [],
  生存: [],
  学识: [],
  母语: [],
};

/** 可选的骰娘格式 */
export const DICEBOT_FORMATS = [
  { id: 'dice', label: '通用（DICE / shiki / 溯洄）', hint: '.st 属性技能…' },
  { id: 'tower', label: '塔系骰娘', hint: '.st 角色名-属性技能…' },
  { id: 'mdice', label: 'MDice（惠惠）', hint: '.st 角色名？属性技能…' },
  { id: 'shiki', label: 'shiki Exp10（带状态/派生/武器）', hint: '.st … 时代/性别 &DB 体格 闪避 护甲 &武器' },
];

function namePrefix(bot, name) {
  const n = String(name || '').trim();
  if (bot === 'tower') return `${n}-`;
  if (bot === 'mdice') return `${n}？`;
  return '';
}

/** 需要导出的技能（普通技能全给基础值；专攻技能只给已选方向/投过点的） */
function skillsForExport(derived) {
  const out = [];
  for (const s of derived.skills || []) {
    if (s.kind === 'custom') {
      if (s.name && s.total > 0) out.push({ name: s.name, total: s.total, aliases: [] });
      continue;
    }
    if (s.spec) {
      if (!s.custom && !(s.occ > 0 || s.interest > 0 || s.growth > 0)) continue;
      const base = SKILL_BY_KEY[s.key]?.name || s.key;
      out.push({ name: s.custom ? `${base}${s.custom}` : base, total: s.total, aliases: [] });
      continue;
    }
    const nm = SKILL_BY_KEY[s.key]?.name || s.name;
    out.push({ name: nm, total: s.total, aliases: SKILL_ALIASES[nm] || [] });
  }
  return out;
}

/**
 * 生成骰娘导入指令。
 * @param {object} sheet   角色卡存档（用 name/era/gender/weapons）
 * @param {object} derived computeSheet() 的结果
 * @param {{bot?:string, dot?:string, includeExtra?:boolean}} [opts]
 *        bot: dice | tower | mdice | shiki ｜ dot: '.' 或 '。' ｜ includeExtra: 附加时代/性别/派生值/武器
 */
export function buildDiceBotCommand(sheet, derived, opts = {}) {
  const bot = DICEBOT_FORMATS.some((f) => f.id === opts.bot) ? opts.bot : 'dice';
  const dot = opts.dot === '。' ? '。' : '.';
  const includeExtra = opts.includeExtra === true || bot === 'shiki';
  const s = sheet || {};
  const d = derived || {};

  const parts = [];
  for (const [k, names] of CHAR_TOKENS) {
    const v = Number(d.eff?.[k] ?? 0);
    for (const n of names) parts.push(`${n}${v}`);
  }
  const luck = Number(d.eff?.Luck ?? 0);
  parts.push(`幸运${luck}`, `运气${luck}`);
  const san = Number(d.san ?? 0);
  parts.push(`san${san}`, `san值${san}`, `理智${san}`, `理智值${san}`);
  parts.push(`mp${Number(d.mp ?? 0)}`, `魔法${Number(d.mp ?? 0)}`);
  parts.push(`hp${Number(d.hp ?? 0)}`, `体力${Number(d.hp ?? 0)}`);

  for (const sk of skillsForExport(d)) {
    parts.push(`${sk.name}${sk.total}`);
    for (const a of sk.aliases) parts.push(`${a}${sk.total}`);
  }

  let text = `${dot}st ${namePrefix(bot, s.name)}${parts.join('')}`;

  if (includeExtra) {
    text += ` 时代:${s.era || '1920s'}\t性别:${s.gender || '保密'}\t`;
    const armor = Number(s.armorPenalty) > 0 ? String(s.armorPenalty) : '无';
    text += ` &DB=${d.db ?? 0} 体格:${d.build ?? 0} 闪避:${d.dodgeBase ?? 0} 护甲:${armor}`;
    for (const w of (Array.isArray(s.weapons) ? s.weapons : [])) {
      if (!w?.name) continue;
      text += ` &${w.name}=${w.damage || '—'}`;
    }
  }
  return text.replace(/\s+$/, '');
}

/** 生成全部四种格式，供界面一次性展示/切换 */
export function buildAllDiceBotCommands(sheet, derived, dot = '.') {
  return DICEBOT_FORMATS.map((f) => ({
    ...f,
    text: buildDiceBotCommand(sheet, derived, { bot: f.id, dot }),
  }));
}

/** 属性/技能的中文名清单（导入解析用：把「力量50str50」切开） */
export const DICEBOT_NAME_TO_CHAR = (() => {
  const map = {};
  for (const [k, names] of CHAR_TOKENS) for (const n of names) map[n.toLowerCase()] = k;
  map['幸运'] = 'Luck'; map['运气'] = 'Luck';
  return map;
})();

export { ALL_CHARS };
