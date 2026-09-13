#!/usr/bin/env node
/**
 * 规则引擎 / 骰娘指令 / 角色卡编码的轻量自检（无框架，`node tools/check-shared.mjs`）。
 *
 * 这些是**纯函数**，不依赖服务端；放一个独立脚本是为了在不启动服务的情况下也能快速回归，
 * 尤其是骰娘指令格式与编码导入导出这类"看起来对、其实错一位"的东西。
 */

import {
  blankSheet, blankSkills, computeSheet, validateSheet, auditSheet,
  ageAdjust, effectiveChars, damageBonusBuild,
} from '../shared/coc7e.js';
import { buildDiceBotCommand, DICEBOT_FORMATS } from '../shared/dicebot.js';
import { exportCardCode, importCardCode, checksum } from '../shared/cardcode.js';

let pass = 0; const fails = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};
const section = (t) => console.log(`\n== ${t} ==`);

const base = {
  ...blankSheet(),
  name: '自检调查员', occupationId: 2, age: 45, era: '1920s', gender: '男',
  chars: { STR: 60, CON: 50, SIZ: 70, DEX: 55, APP: 65, INT: 60, POW: 50, EDU: 70, Luck: 45 },
};

section('年龄补正表（官方空白卡）');
ok('15-19：力量/体型合计 −5、教育 −5、幸运两次', (() => {
  const a = ageAdjust(17);
  return a.pools[0].points === 5 && a.pools[0].keys.join() === 'STR,SIZ' && a.edu === -5 && a.luckRolls === 2;
})());
ok('40-49：池 5、外貌 −5、检定 2、MOV −1', (() => {
  const a = ageAdjust(45);
  return a.pools[0].points === 5 && a.app === -5 && a.eduChecks === 2 && a.movPenalty === 1;
})());
ok('60-69：池 20、外貌 −15、检定 4', (() => {
  const a = ageAdjust(65);
  return a.pools[0].points === 20 && a.app === -15 && a.eduChecks === 4;
})());
ok('80-89：池 80、外貌 −25', ageAdjust(85).pools[0].points === 80 && ageAdjust(85).app === -25);
ok('分配式扣点：只扣玩家分配的那几项', (() => {
  const eff = effectiveChars(base.chars, 45, { ageAlloc: { STR: 5, CON: 0, DEX: 0 } });
  return eff.STR === 55 && eff.CON === 50 && eff.DEX === 55 && eff.APP === 60;
})());
ok('豁免年龄减益：属性不降、教育成长照常', (() => {
  const eff = effectiveChars(base.chars, 65, { waivePenalty: true, eduBonus: 15 });
  return eff.STR === 60 && eff.APP === 65 && eff.EDU === 85;
})());
ok('传奇额外调整值单独累加', (() => {
  const eff = effectiveChars(base.chars, 45, { legendary: { STR: 100 } });
  return eff.STR === base.chars.STR + 100 - 2;   // 默认分配给 STR 2 点年龄减值
})());

section('体格 / 伤害加值表（突破 99 之后）');
const tbl = [[64, -2], [65, -1], [85, 0], [125, 1], [165, 2], [205, 3], [285, 4], [365, 5], [445, 6]];
ok('表格每一档都对得上', tbl.every(([total, build]) => {
  const siz = 50;
  return damageBonusBuild(total - siz, siz).build === build;
}), JSON.stringify(tbl.map(([t]) => damageBonusBuild(t - 50, 50).build)));

section('混点规则（v1.7 严格版）');
const mixed = {
  ...base,
  skills: blankSkills().map((s) => (s.id === 'spotHidden' ? { ...s, occ: 15, interest: 15 }
    : s.id === 'credit' ? { ...s, occ: 30, interest: 10 } : s)),
};
const findings = auditSheet(mixed, {}).findings.map((f) => f.id);
ok('同技能双点 → error', findings.includes('forbidMixedPoints.sameSkill'));
ok('信用评级投兴趣点 → error', findings.includes('forbidMixedPoints.credit'));
ok('玩家端警告同步', (() => {
  const w = validateSheet(mixed);
  return w.some((x) => x.includes('同时吃职业点与兴趣点')) && w.some((x) => x.includes('信用评级只能用职业点'));
})());
const cleanMixed = {
  ...base,
  skills: blankSkills().map((s) => (s.id === 'spotHidden' ? { ...s, interest: 30 } : s)),
};
ok('本职技能只投兴趣点 → 合规', !auditSheet(cleanMixed, {}).findings.some((f) => f.id.startsWith('forbidMixedPoints')));

section('骰娘导入指令');
const d = computeSheet(base);
for (const f of DICEBOT_FORMATS) {
  const cmd = buildDiceBotCommand(base, d, { bot: f.id });
  ok(`${f.label}：.st 开头 + 属性别名 + 技能`,
    cmd.startsWith('.st ')
    && cmd.includes(`力量${d.eff.STR}str${d.eff.STR}`)
    && cmd.includes(`侦查${d.skills.find((s) => s.key === 'spotHidden').total}`),
    cmd.slice(0, 60));
}
ok('塔系前缀带角色名-', buildDiceBotCommand(base, d, { bot: 'tower' }).startsWith('.st 自检调查员-'));
ok('惠惠前缀带角色名？', buildDiceBotCommand(base, d, { bot: 'mdice' }).startsWith('.st 自检调查员？'));
ok('句号模式', buildDiceBotCommand(base, d, { bot: 'dice', dot: '。' }).startsWith('。st '));
ok('shiki 版带派生值与武器', (() => {
  const cmd = buildDiceBotCommand(base, d, { bot: 'shiki' });
  return cmd.includes('&DB=') && cmd.includes('闪避:') && cmd.includes('&徒手=');
})());

section('角色卡编码');
const code = await exportCardCode(base);
ok('编码以 COC7 开头且带校验码', /^COC7[GC]1:[A-Za-z0-9_-]+:[A-Za-z0-9]+$/.test(code), code.slice(0, 20));
const back = await importCardCode(code);
ok('往返导入成功', back.ok && back.sheet.name === base.name && back.sheet.chars.STR === 60);
ok('导入后是干净的新卡（无传奇/无模组经历/草稿）',
  back.sheet.legendary.enabled === false && back.sheet.moduleLinks.length === 0 && back.sheet.status === 'draft');
ok('篡改一个字符会被校验码拦下', !(await importCardCode(`${code.slice(0, -2)}zz`)).ok);
ok('乱粘贴会给出友好错误', (await importCardCode('随便一段文字')).ok === false);
ok('校验码稳定', checksum('abc') === checksum('abc') && checksum('abc') !== checksum('abd'));

console.log(`\n================ 自检：${pass} 通过 / ${fails.length} 失败 ================`);
if (fails.length) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exit(1); }
