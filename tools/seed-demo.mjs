#!/usr/bin/env node
/**
 * 演示数据生成器 —— 造一份「看起来像真在跑团」的假数据，用于截图 / 本地试玩 / 演示环境。
 *
 *   node tools/seed-demo.mjs [目标]
 *     目标可以是数据目录，也可以是 database.json 的完整路径；
 *     默认 backend/data（与后端 COCOC_DATA_DIR 的默认值一致）。
 *
 * 三条安全约定：
 *   1) 目标库里只要已经有任何账号，就拒绝执行 —— 绝不会覆盖真实数据；
 *   2) 这里的口令全是公开的演示口令，只应出现在演示库里；
 *   3) 不写 audit 日志目录，演示数据与真实审计互不干扰。
 *
 * 演示库里的「剧情」是刻意安排的，用来覆盖审卡中心的三种状态：
 *   伊莱亚斯  approved（规则全过）  ｜  白鸦 / 周砚  pending（各带一条命中）
 *   林晚照    rejected（KP 已写批复）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankSkills, blankWeapons, computeSheet } from '../shared/coc7e.js';
import { OCCUPATION_BY_NAME, WEAPON_BY_NAME } from '../shared/coc7e-reference.js';
import { hashPassword } from '../backend/lib/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const arg = process.argv[2] || path.join(ROOT, 'backend', 'data');
const DATA_DIR = arg.endsWith('.json') ? path.dirname(arg) : arg;
const DB_FILE = arg.endsWith('.json') ? arg : path.join(arg, 'database.json');

// ------------------------------------------------------------------ 口令
export const DEMO_ACCOUNTS = [
  { username: 'keeper', password: 'Keeper-Demo-1920', role: 'admin', title: '首席守秘人' },
  { username: '林晚照', password: 'Player-Demo-1920', role: 'user', title: '传奇调查员' },
  { username: '白鸦', password: 'Player-Demo-1920', role: 'user', title: '精英调查员' },
  { username: '周砚', password: 'Player-Demo-1920', role: 'user', title: '资深调查员' },
];

const now = Date.now();
const DAY = 86400_000;
const daysAgo = (n) => now - n * DAY;
const dateStr = (n) => new Date(daysAgo(n)).toISOString().slice(0, 10);

function makeUser(spec, index, id) {
  const rec = hashPassword(spec.password);
  return {
    id,
    username: spec.username,
    passwordHash: rec.hash,
    passwordSalt: rec.salt,
    passwordAlgo: 'scrypt',
    passwordParams: { N: rec.N, r: rec.r, p: rec.p },
    role: spec.role,
    title: spec.title,
    mustChangePassword: false,
    lastLoginAt: daysAgo(index),
    createdAt: daysAgo(120 - index * 7),
    updatedAt: daysAgo(index),
  };
}

// ------------------------------------------------------------------ 模组
const MODULES = [
  {
    title: '雾港钟声',
    series: '潮汐三部曲',
    region: '英国',
    era: '1920s',
    players: '3-5',
    duration: '4-6',
    description:
      '十一月的雾港，灯塔已经连续三夜没有亮起。本地报纸说守塔人因病休假，可渔市上流传的版本是：最后一艘进港的拖网船，捞上来一口刻满陌生文字的铜钟。你们受雇把这口钟送进市立博物馆，手续齐全、报酬优厚——唯一的问题是，从钟进仓库那一晚起，全城的人开始做同一个梦。',
    charInfo: '标准 7 版车卡，460 购点不含幸运。属性上限 85，职业技能上限 80，禁止混点。建议至少一名成员有「侦察」或「聆听」60+。',
    occupations: '记者、私家侦探、古董商、教授、医生',
    skills: '图书馆使用、侦查、聆听、心理学、外语（拉丁语）',
    notes:
      '偏氛围与调查，战斗强度低，适合第一次跑 7 版的桌子。KP 需要提前准备好钟楼与潮汐时间表；第二幕的港口戏建议配环境音。结局存在「全员存活但代价惨重」的分支。',
    isPinned: true,
  },
  {
    title: '冬至档案',
    series: '',
    region: '中国',
    era: '现代',
    players: '3-4',
    duration: '3-5',
    description:
      '市档案馆的旧楼在冬至那天贴出了封楼通知，理由写的是「结构安全评估」。你们当中有人是受委托的测绘师，有人只是想找回祖父留在里面的那份人事档案。封条贴上的第二十四个小时，值班室接到了一通来自楼内的电话——号码属于三年前就已经注销的内线。',
    charInfo: '现代背景，技能点按标准 7 版。允许使用枪械，但本模组内不会提供弹药。属性上限 90。',
    occupations: '记者、警探、历史学家、建筑师、计算机工程师',
    skills: '图书馆使用、计算机使用、侦查、母语、历史',
    notes:
      '单场景封闭型模组，四幕结构，适合 3-5 小时一晚上跑完。恐怖来源于「档案本身会改写」，请 KP 在幕间反复强调复印件的差异。含一处可跳过的 Jump Scare。',
    isPinned: true,
  },
  {
    title: '沉入浅滩的信',
    series: '潮汐三部曲',
    region: '英国',
    era: '1920s',
    players: '2-4',
    duration: '3-4',
    description:
      '一位年迈的船长委托你们去他故乡的小渔村，取回二十年前寄出、却从未被拆开的七封信。收信人大多已经不在了，只剩一位住在潮线之上的老妇人还愿意开门。她说那些信是她的丈夫写的，而她的丈夫，在信寄出的前一年就溺死在了浅滩。',
    charInfo: '低战斗模组，鼓励高 EDU / POW 配置。属性上限 85，职业技能上限 75。',
    occupations: '记者、古董商、作家、牧师、医生',
    skills: '心理学、侦查、母语、说服、聆听',
    notes: '适合 2-4 人的小桌。调查线以对话为主，KP 需要扮演四位村民，建议提前写好各人的口头禅与忌讳。',
  },
  {
    title: '三十六号病房',
    series: '',
    region: '日本',
    era: '现代',
    players: '3-5',
    duration: '4-6',
    description:
      '你们以「志愿者」的身份进入这家民营疗养院，任务很简单：陪三十六号病房的病人聊三个晚上。院方给的注意事项只有一条——无论他说什么，都不要回应他关于「走廊尽头那扇门」的问题。',
    charInfo: '标准 7 版，允许一名成员为医护人员。理智损失偏重，建议每人预留 15 点理智余量。',
    occupations: '医生、护士、心理学研究者、记者、宗教人士',
    skills: '心理学、医学、精神分析、聆听、侦查',
    notes: '本模组有明确的「不要回答」机制，KP 需要在第一晚就建立起规则感，后面才有效果。含中等强度描写，开团前请确认玩家接受度。',
  },
  {
    title: '盐与灰',
    series: '',
    region: '美国',
    era: '1920s',
    players: '4-6',
    duration: '6-8',
    description:
      '新墨西哥州的一场沙暴之后，铁路公司在勘测线上发现了一处不属于任何登记村落的聚落。你们是随行的测绘队与记者，任务是把路线上的障碍标注清楚。但当你们抵达时，聚落里的人正在举行一场葬礼——而棺材里的东西，是昨天才到过你们营地的向导。',
    charInfo: '中高战斗强度，建议至少两名成员有战斗技能与枪械。属性上限 85，允许混点但需在备注说明。',
    occupations: '士兵、探险家、记者、地质学家、牛仔',
    skills: '射击、格斗、生存、侦查、急救',
    notes: '长团，建议分两次跑。第三幕的沙暴追逐战是全场高潮，KP 需准备地形图与载具规则。含死亡分支，请开团前说明。',
  },
  {
    title: '长夜列车',
    series: '',
    region: '欧洲',
    era: '现代',
    players: '3-5',
    duration: '4-5',
    description:
      '一趟从布达佩斯开往基辅的夜车，全程十四小时，途中不停靠任何站点。你们分散在不同的包厢里，第二天清晨发现：车票上的终点站变了，而乘务员坚持说这趟车二十年来一直开往那个地方。',
    charInfo: '现代背景，标准 7 版车卡。通讯设备在模组开始后会失效，请勿依赖手机。',
    occupations: '记者、翻译、工程师、医生、商人',
    skills: '侦查、聆听、说服、母语、机械维修',
    notes: '群像型模组，五名乘客各有秘密，适合喜欢扮演与互相试探的桌子。KP 需要为每名乘客准备一页私密背景。',
  },
  {
    title: '无声图书馆',
    series: '',
    region: '法国',
    era: '1920s',
    players: '2-3',
    duration: '3',
    description:
      '巴黎的一间私人图书馆，藏书两万册，唯一的规矩是：馆内不许发出任何声音。管理员说这是为了尊重读者，可你们注意到，阅览室里所有人都戴着同一款耳塞——而他们的嘴唇，一直在无声地重复同一句话。',
    charInfo: '短团，2-3 人。属性上限 80，技能上限 70，禁止混点。',
    occupations: '作家、翻译、教授、书商',
    skills: '图书馆使用、外语、母语、心理学、侦查',
    notes: '一晚跑完的实验性短团。全程禁止玩家之间说话（只能传纸条），请提前告知并征得同意。',
  },
  {
    title: '潮汐之下',
    series: '潮汐三部曲',
    region: '中国',
    era: '现代',
    players: '3-5',
    duration: '5-7',
    description:
      '一座即将被水库淹没的旧县城，搬迁工作只剩最后两周。你们是负责清点文物的工作组，在县中学的地基下挖出了一间不该存在的房间——它的门朝着水下开。',
    charInfo: '三部曲终章，建议先跑过《雾港钟声》。标准 7 版，属性上限 90，允许使用前作角色并保留成长。',
    occupations: '考古学家、地质学家、记者、工程师、潜水员',
    skills: '考古学、潜水、侦查、历史、游泳',
    notes: '终章会回收前作埋下的全部伏笔。KP 需准备前作角色卡的结局分支表。含大规模场景毁灭描写。',
  },
];

// ------------------------------------------------------------------ 角色卡
/** 按技能槽位 id 写点数，例如 { library: { occ: 45 }, 'language#0': { occ: 34, custom: '拉丁语' } } */
function buildSkills(assign) {
  const skills = blankSkills();
  for (const [id, patch] of Object.entries(assign)) {
    const slot = skills.find((s) => s.id === id);
    if (!slot) throw new Error(`未知技能槽位：${id}`);
    if (patch.custom !== undefined) slot.custom = patch.custom;
    if (patch.occ) slot.occ = patch.occ;
    if (patch.interest) slot.interest = patch.interest;
    if (patch.growth) slot.growth = patch.growth;
  }
  return skills;
}

function weapon(name) {
  const w = WEAPON_BY_NAME[name];
  if (!w) throw new Error(`未知武器：${name}`);
  return {
    name: w.name, skill: w.skill, damage: w.damage, range: w.range,
    attacks: w.attacks, ammo: w.ammo, malfunction: w.malfunction,
  };
}

const bg = (o) => ({
  appearance: o.appearance || '',
  traits: o.traits || '',
  ideology: o.ideology || '',
  injuries: o.injuries || '',
  people: o.people || '',
  phobias: o.phobias || '',
  locations: o.locations || '',
  tomes: o.tomes || '',
  possessions: o.possessions || '',
  encounters: o.encounters || '',
});

const CHARACTERS = [
  {
    key: 'elias',
    name: '伊莱亚斯·凡·德·梅尔',
    occupation: '记者',
    age: 34,
    gender: '男',
    residence: '美国 · 波士顿',
    birthplace: '荷兰 · 鹿特丹',
    era: '1920s',
    chars: { STR: 50, CON: 55, SIZ: 60, DEX: 65, APP: 60, INT: 70, POW: 55, EDU: 75, Luck: 60 },
    eduBonus: 3,
    status: 'active',
    isPublic: true,
    reviewStatus: 'approved',
    occPicks: { free: [], social: ['fastTalk', 'charm'], choices: [] },
    skills: buildSkills({
      // 职业点（预算 280）—— 全部投入记者本职技能
      library: { occ: 45 },
      spotHidden: { occ: 35 },
      listen: { occ: 30 },
      'language#0': { occ: 34, custom: '拉丁语' },
      ownLanguage: { custom: '荷兰语' },
      'art#0': { occ: 35, custom: '摄影' },
      psychology: { occ: 35 },
      ownLanguage: { custom: '中文' },
      dodge: { occ: 10 },
      appraise: { occ: 20 },
      credit: { occ: 25 },
      // 兴趣点（预算 140）
      fastTalk: { interest: 45 },
      charm: { interest: 20 },
      stealth: { interest: 10 },
      firstAid: { interest: 10 },
      history: { interest: 20 },
      'drive#0': { interest: 15, custom: '汽车' },
      'firearms#0': { interest: 15, custom: '手枪' },
    }),
    weapons: [weapon('.38(9mm)左轮手枪')],
    equipment: '记者证与《波士顿环球报》外勤徽章；柯达折叠式相机（含 6 张底片）；防水笔记本与两支钢笔；黄铜手电筒；羊毛大衣；返程船票一张。',
    extraAssets: '叔父留下的鹿特丹联排屋一层（出租中，月租 40 美元）。',
    currency: 'USD',
    background: bg({
      appearance: '高瘦，金发总是被风吹乱，右手因早年的印刷机事故少了一节小指。',
      traits: '对任何官方说法都先怀疑三分；谈判时习惯先递烟。',
      ideology: '真相属于公众，哪怕它很难看。',
      people: '导师：老编辑阿尔文，唯一还愿意为他担保的人。',
      locations: '波士顿公共图书馆的旧报刊室——他在这里查到了第一篇让自己惹上麻烦的报道。',
      possessions: '一枚不属于他的铜制怀表，表盖内侧刻着「潮水会记得」。',
      encounters: '在雾港的仓库里，第一次听见那口钟在没有风的情况下自己响了一声。',
    }),
    moduleLinks: [
      { module: 0, role: 'PC', date: dateStr(48), note: '从博物馆仓库一路查到灯塔，最后把钟沉回了航道。理智掉了 9 点。' },
      { module: 2, role: 'PC', date: dateStr(21), note: '替船长取回了七封信中的五封，剩下两封被潮水带走了。' },
    ],
    experience: '两年前开始为报社跑「不适合登报」的选题。目前手上有三个未结案的采访本。',
    skillMarks: { library: true, spotHidden: true },
  },
  {
    key: 'baiya',
    name: '白鸦',
    occupation: '私家侦探',
    age: 41,
    gender: '男',
    residence: '中国 · 重庆',
    birthplace: '中国 · 万州',
    era: '现代',
    chars: { STR: 55, CON: 60, SIZ: 65, DEX: 60, APP: 45, INT: 75, POW: 65, EDU: 70, Luck: 45 },
    eduBonus: 4,
    status: 'active',
    isPublic: false,
    reviewStatus: 'pending',
    // 私家侦探的本职：会计/法律/图书馆/聆听/开锁/技艺/侦查 + 2 交涉 + 1 自由
    occPicks: { free: ['psychology'], social: ['intimidate', 'persuade'], choices: [] },
    skills: buildSkills({
      // 职业点（预算 260）—— 侦查故意堆到 90，用来演示「职业技能成功率上限」规则命中
      spotHidden: { occ: 65 },
      listen: { occ: 40 },
      library: { occ: 10 },
      'art#0': { occ: 20, custom: '摄影' },
      law: { occ: 25 },
      psychology: { occ: 35 },
      intimidate: { occ: 25 },
      persuade: { occ: 10 },
      ownLanguage: { custom: '中文' },
      credit: { occ: 20 },
      // 兴趣点（预算 150）
      stealth: { interest: 10 },
      firstAid: { interest: 10 },
      'drive#0': { interest: 15, custom: '汽车' },
      'firearms#0': { interest: 25, custom: '手枪' },
      occult: { interest: 20 },
      history: { interest: 20 },
    }),
    weapons: [weapon('.45(11.43mm) 自动手枪')],
    equipment: '私家侦探执业证；手机（含 3 张未实名 SIM 卡）；微型录音笔；开锁工具一套；折叠伞。',
    extraAssets: '解放碑附近一间 32 平米的办公室，按揭还差九年。',
    currency: 'CNY',
    background: bg({
      appearance: '四十出头，习惯穿深色夹克，左眉有一道旧疤。',
      traits: '话少，问问题时会先沉默三秒。',
      ideology: '钱要收，但案子得查清楚。',
      people: '前妻：还在替他保管一份不该留在家里的证据。',
      locations: '南山上的旧防空洞入口——他第一次见到「不在地图上」的东西。',
      possessions: '一本记满车牌号与日期的黑色笔记本。',
    }),
    moduleLinks: [
      { module: 1, role: 'PC', date: dateStr(12), note: '封楼当晚在值班室待到凌晨三点，录音笔里多出一段不是他录的声音。' },
      { module: 3, role: 'PC', date: dateStr(5), note: '三十六号病房的第三个晚上，他回答了那个问题。' },
    ],
    experience: '从刑警队出来单干第六年。接过的案子里有九件至今没写结案报告。',
    skillMarks: {},
    submittedAt: daysAgo(2),
  },
  {
    key: 'zhouyan',
    name: '周砚',
    occupation: '医生',
    age: 29,
    gender: '女',
    residence: '中国 · 上海',
    birthplace: '中国 · 苏州',
    era: '现代',
    chars: { STR: 45, CON: 55, SIZ: 50, DEX: 70, APP: 65, INT: 80, POW: 60, EDU: 85, Luck: 55 },
    eduBonus: 2,
    status: 'active',
    isPublic: true,
    reviewStatus: 'pending',
    // 医生的本职：科学×2 / 急救 / 外语 / 图书馆 / 医学 / 心理学 + 2 自由
    occPicks: { free: ['listen', 'spotHidden'], social: [], choices: [] },
    skills: buildSkills({
      // 职业点（预算 340）
      medicine: { occ: 55 },
      firstAid: { occ: 40 },
      psychology: { occ: 30 },
      library: { occ: 20 },
      'science#0': { occ: 25, custom: '生物学' },
      'language#0': { occ: 20, custom: '德语' },
      ownLanguage: { custom: '中文' },
      credit: { occ: 35 },
      // 兴趣点（预算 160）
      listen: { interest: 30 },
      spotHidden: { interest: 20 },
      persuade: { interest: 30 },
      charm: { interest: 15 },
      occult: { interest: 5 },
      history: { interest: 20 },
    }),
    weapons: [],
    equipment: '市一院胸外科工牌；听诊器；便携急救包（止血带、吗啡各一）；被翻烂的《格雷氏解剖学》；一副黑框眼镜。',
    extraAssets: '母亲留下的苏州老宅三分之一产权（与两位表亲共有）。',
    currency: 'CNY',
    // 只填 4 栏：用来演示「背景故事最少填写栏数」的 warn
    background: bg({
      appearance: '短发，白大褂口袋里永远插着三支笔。',
      traits: '对病人极其耐心，对同事极其不耐烦。',
      ideology: '能救的先救，解释的事以后再补。',
      people: '带教老师：已经退休的胸外科主任，唯一相信她那份病历的人。',
    }),
    moduleLinks: [
      { module: 3, role: 'PC', date: dateStr(5), note: '以志愿者身份进入疗养院，负责记录三十六号病房的用药。' },
    ],
    experience: '胸外科住院总第三年。值夜班时开始出现「记不清自己有没有查房」的情况。',
    skillMarks: { medicine: true },
    submittedAt: daysAgo(1),
  },
  {
    key: 'linwanzhao',
    name: '林晚照',
    occupation: '古董商',
    age: 38,
    gender: '女',
    residence: '中国 · 香港',
    birthplace: '中国 · 广州',
    era: '1920s',
    chars: { STR: 45, CON: 50, SIZ: 45, DEX: 60, APP: 70, INT: 75, POW: 65, EDU: 80, Luck: 50 },
    eduBonus: 3,
    status: 'retired',
    isPublic: false,
    reviewStatus: 'rejected',
    // 古董商的本职：会计/估价/驾驶/历史/图书馆/领航 + 2 交涉
    occPicks: { free: [], social: ['persuade', 'charm'], choices: [] },
    skills: buildSkills({
      // 职业点（预算 320）
      appraise: { occ: 50 },
      library: { occ: 35 },
      credit: { occ: 45 },
      ownLanguage: { custom: '中文' },
      history: { occ: 30 },
      // 下面两条是刻意的「混点」：侦探与神秘学都不在古董商本职里，却被投了职业点
      spotHidden: { occ: 45 },
      occult: { occ: 40 },
      // 兴趣点
      'language#0': { interest: 30, custom: '法语' },
      persuade: { interest: 15 },
      psychology: { interest: 10 },
    }),
    weapons: [],
    equipment: '估价用的放大镜与黄铜卡尺；上环的一间铺面钥匙；三张待鉴定的旧照片；名片盒。',
    extraAssets: '中环商铺一层（已抵押）。',
    currency: 'USD',
    background: bg({
      appearance: '总穿旗袍配西式外套，手指上戴两枚不同年代的戒指。',
      traits: '谈价钱时从不先开口。',
      ideology: '东西比人诚实。',
      people: '合伙人：在 1928 年的一次收货途中失踪，至今没有下落。',
      locations: '广州十三行旧址——她父亲铺子的原址现在是一家洋行。',
      possessions: '一只缺了盖的宣德炉，底款是她自己刻的。',
    }),
    moduleLinks: [],
    experience: '',
    skillMarks: {},
    submittedAt: daysAgo(9),
    reviewedAt: daysAgo(8),
  },
];

const REVIEWS = [
  { characterKey: 'elias', verdict: 'approved', comment: '', daysAgo: 30 },
  {
    characterKey: 'linwanzhao',
    verdict: 'rejected',
    comment: '两处问题：① 职业技能「估价」已达 55%，请附上成长记录或说明来源；'
      + '② 侦查与神秘学不在古董商本职技能内，却投入了职业点（混点）。'
      + '把这两项的职业点改投本职技能后重新提交即可。',
    daysAgo: 8,
  },
];

const SESSIONS = [
  { module: 0, date: dateStr(96), duration: 5, players: 4, investigators: '林晚照, 白鸦, 周砚, 老周' },
  { module: 0, date: dateStr(91), duration: 4, players: 4, investigators: '林晚照, 白鸦, 周砚, 老周' },
  { module: 4, date: dateStr(74), duration: 7, players: 5, investigators: '白鸦, 周砚, 阿吉, 小满, 老周' },
  { module: 1, date: dateStr(58), duration: 4, players: 3, investigators: '白鸦, 小满, 阿吉' },
  { module: 2, date: dateStr(47), duration: 3, players: 3, investigators: '林晚照, 周砚, 小满' },
  { module: 6, date: dateStr(33), duration: 3, players: 2, investigators: '林晚照, 阿吉' },
  { module: 5, date: dateStr(26), duration: 5, players: 4, investigators: '白鸦, 周砚, 小满, 老周' },
  { module: 1, date: dateStr(19), duration: 4, players: 3, investigators: '周砚, 阿吉, 小满' },
  { module: 3, date: dateStr(12), duration: 5, players: 4, investigators: '白鸦, 周砚, 小满, 老周' },
  { module: 7, date: dateStr(4), duration: 6, players: 5, investigators: '林晚照, 白鸦, 周砚, 阿吉, 小满' },
];

const CUSTOM_OCCUPATION = {
  name: '民俗学者',
  cr: [20, 50],
  attr: '教育×4',
  pts: { terms: [{ stat: 'EDU', mult: 4 }], max: [] },
  keys: ['anthropology', 'history', 'library', 'occult', 'language', 'ownLanguage', 'spotHidden', 'listen'],
  customKeys: ['田野记录'],
  choices: [],
  social: 1,
  free: 0,
  desc: '本房规职业：长期在乡野做田野调查的研究者，允许以「田野记录」作为自定义本职技能。',
};

// ------------------------------------------------------------------ 组装
function build() {
  const users = DEMO_ACCOUNTS.map((spec, i) => makeUser(spec, i, `u_demo_${i + 1}`));
  const ownerOf = { elias: users[1].id, baiya: users[2].id, zhouyan: users[3].id, linwanzhao: users[1].id };

  const themes = ['from-emerald-900 to-slate-900', 'from-amber-900 to-stone-900', 'from-cyan-900 to-slate-900',
    'from-indigo-900 to-slate-900', 'from-rose-900 to-stone-900', 'from-teal-900 to-slate-900',
    'from-violet-900 to-slate-900', 'from-blue-900 to-slate-900'];

  const modules = MODULES.map((m, i) => ({
    id: `m_demo_${i + 1}`,
    ...m,
    themeColor: themes[i % themes.length],
    createdAt: daysAgo(110 - i * 9),
    updatedAt: daysAgo(110 - i * 9),
    createdBy: users[0].id,
  }));

  const characters = CHARACTERS.map((c, i) => {
    const occ = OCCUPATION_BY_NAME[c.occupation];
    if (!occ) throw new Error(`未知职业：${c.occupation}`);
    const owner = users.find((u) => u.id === ownerOf[c.key]);
    const rec = {
      id: `c_demo_${i + 1}`,
      ownerId: owner.id,
      name: c.name,
      playerName: owner.username,
      occupationId: String(occ.id),
      age: c.age,
      gender: c.gender,
      residence: c.residence,
      birthplace: c.birthplace,
      era: c.era,
      chars: c.chars,
      eduBonus: c.eduBonus || 0,
      applyAgeAdjust: true,
      armorPenalty: 0,
      occPicks: c.occPicks,
      skills: c.skills,
      weapons: c.weapons.length ? [blankWeapons()[0], ...c.weapons] : blankWeapons(),
      equipment: c.equipment,
      extraAssets: c.extraAssets || '',
      currency: c.currency,
      background: c.background,
      moduleLinks: c.moduleLinks.map((l) => ({
        moduleId: modules[l.module].id, role: l.role, date: l.date, note: l.note,
      })),
      experience: c.experience,
      status: c.status,
      isPublic: c.isPublic,
      customSkills: [],
      skillMarks: c.skillMarks || {},
      reviewStatus: c.reviewStatus,
      createdAt: daysAgo(40 - i * 3),
      updatedAt: daysAgo(3 + i),
    };
    if (c.submittedAt) rec.submittedAt = c.submittedAt;
    if (c.reviewedAt) { rec.reviewedAt = c.reviewedAt; rec.reviewedBy = users[0].id; }
    return rec;
  });

  const customOccupations = [{
    id: 'cocc_demo_1',
    ...CUSTOM_OCCUPATION,
    isCustom: true,
    createdBy: users[0].id,
    createdByName: users[0].username,
    createdAt: daysAgo(60),
    updatedAt: daysAgo(60),
  }];

  const reviews = REVIEWS.map((r, i) => {
    const spec = CHARACTERS.find((y) => y.key === r.characterKey);
    const card = characters.find((x) => x.name === spec.name);
    const occ = OCCUPATION_BY_NAME[spec.occupation];
    const d = computeSheet(card, { customOccupations });
    const credit = d.skills.find((s) => s.key === 'credit');
    return {
      id: `rv_demo_${i + 1}`,
      characterId: card.id,
      kpId: users[0].id,
      kpName: users[0].username,
      verdict: r.verdict,
      comment: r.verdict === 'approved' ? '' : r.comment,
      stats: {
        charTotal: ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU'].reduce((a, k) => a + d.eff[k], 0),
        occupationPoints: d.spent.occupation,
        occupationBudget: d.budget.occupation,
        interestPoints: d.spent.interest,
        interestBudget: d.budget.interest,
        creditRating: credit ? credit.total : 0,
        creditRange: occ.cr,
        skillCount: d.skills.filter((s) => s.total > s.base).length,
        customSkillCount: 0,
      },
      findings: r.verdict === 'approved' ? [] : [
        { id: 'forbidMixedPoints', label: '禁止混点', level: 'error', detail: '职业点投入了非本职技能：侦查、神秘学' },
      ],
      createdAt: daysAgo(r.daysAgo),
    };
  });

  const played = [];
  for (const [ui, user] of users.entries()) {
    const picks = ui === 0 ? [0, 1, 2, 4, 5, 7] : [0, 1, 2, 3, 4, 6, 7].slice(0, 4 + ui);
    for (const mi of picks) played.push({ userId: user.id, moduleId: modules[mi].id, at: daysAgo(100 - mi * 8 - ui) });
  }

  const sessions = SESSIONS.map((s, i) => ({
    id: `s_demo_${i + 1}`,
    moduleId: modules[s.module].id,
    date: s.date,
    duration: s.duration,
    playerCount: s.players,
    investigators: s.investigators,
    createdAt: daysAgo(100 - i * 9),
    createdBy: users[0].id,
  }));

  return {
    schemaVersion: 4,
    users,
    modules,
    played_records: played,
    sessions,
    characters,
    customOccupations,
    reviews,
    settings: {
      auditRules: {
        enabled: true,
        charMax: 90,
        charMin: 0,
        charTotalMax: 0,
        occSkillMax: 80,
        interestSkillMax: 70,
        backgroundMinFields: 6,
        minPointUsage: 0,
        requireCreditInRange: true,
        forbidMixedPoints: true,
        requireOccupation: true,
        flagCustomSkills: true,
      },
    },
  };
}

// ------------------------------------------------------------------ 主流程
if (fs.existsSync(DB_FILE)) {
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch { /* 坏文件同样拦住 */ }
  if (existing && Array.isArray(existing.users) && existing.users.length) {
    console.error(`✗ 拒绝执行：${DB_FILE} 里已经有 ${existing.users.length} 个账号。`);
    console.error('  演示数据只能写进空库。请换一个 COCOC_DATA_DIR，或先备份并移走现有数据文件。');
    process.exit(1);
  }
}

const demo = build();
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(DB_FILE, JSON.stringify(demo, null, 2), 'utf-8');

console.log(`✓ 演示数据已写入 ${DB_FILE}`);
for (const [k, v] of [
  ['账号', demo.users.length], ['模组', demo.modules.length], ['角色卡', demo.characters.length],
  ['带团记录', demo.sessions.length], ['已调查标记', demo.played_records.length],
  ['审核记录', demo.reviews.length], ['自定义职业', demo.customOccupations.length],
]) console.log(`    ${k}：${v}`);
console.log('\n  演示账号（用户名 / 口令）：');
for (const a of DEMO_ACCOUNTS) {
  console.log(`    ${a.username.padEnd(10)} ${a.password}${a.role === 'admin' ? '   ← 守秘人（KP）' : ''}`);
}
console.log('\n  启动演示环境：');
console.log(`    COCOC_DATA_DIR="${DATA_DIR}" npm --prefix backend start`);
