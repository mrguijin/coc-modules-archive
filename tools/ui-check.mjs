/**
 * 可选的界面冒烟测试：用无头 Chrome 真实加载站点，验证关键页面能渲染出来。
 *
 * 需要环境已安装 Chrome（或 Edge）。用法：
 *   1) 先启动后端（默认 3000）与前端 dev/preview 服务（默认 5173）
 *   2) node tools/ui-check.mjs [baseUrl]
 *
 * 它会：登录 → 打开首页 → 打开「我的角色卡」→ 新建一张角色卡 → 打开详情 → 截图。
 * 产物截图写入 tools/_shots/。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankSheet } from '../shared/coc7e.js';
import { exportCardCode } from '../shared/cardcode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BASE = process.argv[2] || 'http://127.0.0.1:5173';
const API = process.argv[3] || 'http://127.0.0.1:3000';
const SHOTS = path.join(__dirname, '_shots');
const PORT = 9333;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error('找不到 Chrome/Edge，跳过界面测试');
  process.exit(0);
}
fs.mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------- CDP 客户端
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error('WebSocket 连接失败'));
    });
    const cdp = new Cdp(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} 超时`)); }
      }, 20000);
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '页面内脚本异常');
    return r.result.value;
  }
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-ui-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1440,1000',
  'about:blank',
], { stdio: 'ignore' });

function cleanup(code) {
  try { chrome.kill('SIGKILL'); } catch { /* ignore */ }
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(`\n================ 界面测试：${pass} 通过 / ${fail} 失败 ================`);
  if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
  process.exit(code);
}

async function waitBrowser() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('无头浏览器启动超时');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let seedUser = null;
  try {
    const dbFile = process.env.COCOC_DB_FILE || path.join(ROOT, '..', 'backend', 'data', 'database.json');
    void dbFile;
  } catch { /* ignore */ }

  // 用后端接口自己拿一个可用账号：优先用环境变量，其次用首个管理员（仅本地测试库）
  const login = await fetch(`${API}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.UI_USER || 'uicheck',
      password: process.env.UI_PASS || 'UiCheck-Pass1',
    }),
  }).catch(() => null);
  if (login && login.ok) seedUser = await login.json();

  const browserWs = await waitBrowser();
  const browser = await Cdp.connect(browserWs);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pageInfo = list.find((t) => t.id === targetId);
  const page = await Cdp.connect(pageInfo.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');

  console.log('\n== 加载站点 ==');
  await page.send('Page.navigate', { url: BASE });
  await sleep(2500);
  const bootstrapped = await page.eval('document.querySelector("#root")?.children.length > 0');
  ok('React 应用挂载成功', bootstrapped === true);

  const title = await page.eval('document.title');
  ok('页面标题正确', title === 'coc模组列表', `实际 ${title}`);

  const homeText = await page.eval('document.body.innerText');
  ok('首页渲染出档案馆标题', homeText.includes('收录世界上不可名状的超自然案件'));
  ok('未登录时显示登录入口', homeText.includes('登录身份'));

  console.log('\n== 登录 ==');
  if (seedUser) {
    const logged = await page.eval(`(async () => {
      localStorage.setItem('token', ${JSON.stringify(seedUser.token)});
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify(seedUser.user))});
      return true;
    })()`);
    void logged;
    await page.send('Page.navigate', { url: BASE });
    await sleep(2200);
    const afterLogin = await page.eval('document.body.innerText');
    ok('登录后显示用户名', afterLogin.includes(seedUser.user.username), afterLogin.slice(0, 120));
    ok('登录后出现「我的角色卡」入口', afterLogin.includes('我的角色卡'));

    console.log('\n== 角色卡页面 ==');
    await page.eval(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('我的角色卡'));
      if (btn) btn.click();
      return Boolean(btn);
    })()`);
    await sleep(1600);
    const charText = await page.eval('document.body.innerText');
    ok('角色卡列表页渲染', charText.includes('角色卡') && (charText.includes('新建角色卡') || charText.includes('还没有')));
    ok('角色卡页无错误边界/异常', !charText.includes('Something went wrong'));

    console.log('\n== 新建角色卡编辑器 ==');
    await page.eval(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('新建角色卡'));
      if (btn) btn.click();
      return Boolean(btn);
    })()`);
    await sleep(1600);
    const editorText = await page.eval('document.body.innerText');
    ok('编辑器渲染属性面板', editorText.includes('属性明细与年龄补正'));
    ok('编辑器渲染派生值', editorText.includes('生命值 HP') && editorText.includes('移动力 MOV'));
    ok('编辑器渲染技能点预算', editorText.includes('职业技能点') && editorText.includes('兴趣技能点'));
    ok('KP 登录时看到「KP 专属设置」（传奇标记 / 豁免年龄减益）',
      editorText.includes('KP 专属设置') && editorText.includes('传奇标记：允许突破属性 99 上限')
      && editorText.includes('豁免年龄减益（只享受教育成长）'));

    await page.eval(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('选择职业'));
      if (btn) btn.click();
      return Boolean(btn);
    })()`);
    await sleep(900);
    const pickerText = await page.eval('document.body.innerText');
    ok('职业选择弹窗可打开', pickerText.includes('选择职业') && pickerText.includes('会计师'));

    // 回到首页，验证重构后拆分出去的模组视图仍正常
    await page.eval(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('秘密调查档案馆'));
      if (btn) btn.click();
      return Boolean(btn);
    })()`);
    await sleep(1500);
    const home2 = await page.eval('document.body.innerText');
    ok('返回首页正常', home2.includes('收录世界上不可名状的超自然案件'));

    await page.eval(`(() => {
      // 卡片本身带 cursor-pointer；点标题所在的卡片即可进入详情
      const card = [...document.querySelectorAll('div.cursor-pointer')]
        .find(d => d.textContent.includes('查阅档案'));
      if (card) card.click();
      return Boolean(card);
    })()`);
    await sleep(1500);
    const detail = await page.eval('document.body.innerText');
    ok('模组详情页渲染', detail.includes('案件背景') && detail.includes('基础参数'), detail.slice(0, 120));
    ok('详情页显示归档按钮', detail.includes('已调查') || detail.includes('标记为已调查') || detail.includes('已归档'));

    if (seedUser.user.role === 'admin') {
      await page.eval(`(() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('发布模组'));
        if (btn) btn.click();
        return Boolean(btn);
      })()`);
      await sleep(1400);
      const formText = await page.eval('document.body.innerText');
      ok('模组录入表单渲染', formText.includes('录入档案') && formText.includes('附加档案'));
    }

    console.log('\n== KP 列表页快捷传奇（v1.7.1） ==');
    await page.send('Page.navigate', { url: BASE });
    await sleep(2200);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('角色卡管理'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(1800);
    const kpListText = await page.eval('document.body.innerText');
    ok('KP 角色卡管理列表渲染', kpListText.includes('角色卡管理') || kpListText.includes('全站调查员'), kpListText.slice(0, 80));
    const hasLegendBtn = await page.eval(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '传奇')`);
    ok('列表卡片上有「传奇」快捷按钮（无需进入编辑）', hasLegendBtn === true);
    const hasEduBtn = await page.eval(`[...document.querySelectorAll('button')].some(b => b.textContent.startsWith('教育'))`);
    ok('列表卡片上有「教育」快捷按钮（授权重掷 / 重置）', hasEduBtn === true);
    const hasWaiveBtn = await page.eval(`[...document.querySelectorAll('button')].some(b => /豁免年龄|恢复年龄/.test(b.textContent))`);
    ok('列表卡片上有「豁免年龄」快捷开关', hasWaiveBtn === true);
    const hasExportBtn = await page.eval(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '导出')`);
    ok('列表卡片上有「导出」（角色卡编码 / 骰娘指令）', hasExportBtn === true);
    const waiveToggled = await page.eval(`(async () => {
      const before = document.body.innerText.includes('免年龄减益');
      const b = [...document.querySelectorAll('button')].find(x => /豁免年龄|恢复年龄/.test(x.textContent));
      if (!b) return null;
      b.click();
      await new Promise((r) => setTimeout(r, 1400));
      return { before, after: document.body.innerText.includes('免年龄减益') };
    })()`);
    ok('豁免年龄是一键开关（点击后徽标状态改变）',
      waiveToggled && waiveToggled.before !== waiveToggled.after, JSON.stringify(waiveToggled));
    // 复原，避免影响后续断言
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => /豁免年龄|恢复年龄/.test(x.textContent));
      if (b) b.click();
      return true;
    })()`);
    await sleep(1400);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.startsWith('教育'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(800);
    const eduModal = await page.eval('document.body.innerText');
    ok('教育弹窗含流水与授权/重置按钮',
      eduModal.includes('结算流水') && eduModal.includes('授权重掷一次') && eduModal.includes('重置教育增强'));
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '关闭');
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(500);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '传奇');
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(800);
    const legendModal = await page.eval('document.body.innerText');
    ok('传奇弹窗含开关与额外调整值',
      legendModal.includes('允许这张卡突破属性 99 上限') && legendModal.includes('额外调整值（单独一栏）'));
    // 打开开关并给第一个属性 +40，保存
    await page.eval(`(() => {
      const label = [...document.querySelectorAll('label')].find(l => l.textContent.includes('允许这张卡突破属性 99 上限'));
      const t = label ? label.querySelector('input[type=checkbox],button') : null;
      if (t) t.click();
      return Boolean(t);
    })()`);
    await sleep(400);
    await page.eval(`(() => {
      const first = document.querySelector('input[type=number]');
      if (!first) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(first, '40');
      first.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(400);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '保存');
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(1800);
    const afterLegend = await page.eval('document.body.innerText');
    ok('保存后列表直接显示「传奇 +」徽标', /传奇 \+\d+/.test(afterLegend), afterLegend.slice(0, 120));

    console.log('\n== 打印版面：技能必须单行（v1.7.4） ==');
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '打印');
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(2200);
    const printCheck = await page.eval(`(() => {
      const mm = document.createElement('div');
      mm.style.height = '297mm'; mm.style.position = 'absolute'; mm.style.visibility = 'hidden';
      document.body.appendChild(mm);
      const a4 = mm.getBoundingClientRect().height;
      mm.remove();
      // 技能表是 table-fixed；只统计这些表的行高
      const skillTables = [...document.querySelectorAll('.print-page table.table-fixed')];
      const rows = skillTables.flatMap((t) => [...t.querySelectorAll('tbody tr')]);
      const heights = rows.map((r) => Math.round(r.getBoundingClientRect().height));
      const minH = Math.min(...heights);
      const wrapped = rows.filter((r) => r.getBoundingClientRect().height > minH + 1).length;
      const clipped = [...document.querySelectorAll('.print-page table.table-fixed tbody tr td:nth-child(3)')]
        .filter((td) => td.scrollWidth > td.clientWidth + 1)
        .map((td) => td.innerText.slice(0, 20));
      const lineBlocks = [...document.querySelectorAll('.print-page span[title]')]
        .filter((el) => el.getBoundingClientRect().height > 22).length;
      const first = document.querySelector('.print-page');
      const cs = getComputedStyle(first);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const contentH = Math.round((first.firstElementChild?.getBoundingClientRect().height || 0) + pad);
      return { a4: Math.round(a4), rows: rows.length, wrapped, clipped, lineBlocks, contentH };
    })()`);
    ok('打印技能行数正常（三列铺满一页）', printCheck.rows >= 40 && printCheck.rows <= 60, JSON.stringify(printCheck));
    ok('每个技能都只占一行（无折行）', printCheck.wrapped === 0, `折行 ${printCheck.wrapped} 行`);
    ok('技能名没有被裁切', printCheck.clipped.length === 0, JSON.stringify(printCheck.clipped));
    ok('基础信息格子全部单行', printCheck.lineBlocks === 0, `折行 ${printCheck.lineBlocks} 个`);
    ok('第一页仍在 A4 以内', printCheck.contentH <= printCheck.a4,
      `内容 ${printCheck.contentH}px / A4 ${printCheck.a4}px`);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('返回'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(900);

    console.log('\n== 审卡中心不再黑屏（回归：图标漏 import） ==');
    await page.send('Page.navigate', { url: BASE });
    await sleep(2200);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('审卡中心'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(2000);
    const reviewText = await page.eval('document.body.innerText');
    const rootKids = await page.eval('document.querySelector("#root")?.children.length');
    ok('审卡中心能正常渲染（页面非空）', Number(rootKids) > 0 && reviewText.includes('待审核队列'),
      `root=${rootKids} len=${reviewText.length}`);
    ok('审卡队列显示教育增强状态', /教育 \+\d+（|教育未结算/.test(reviewText), reviewText.slice(0, 120));

    console.log('\n== 访客模式 ==');
    await page.eval(`localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('coc.guest.sheets.v1'); 'ok'`);
    await page.send('Page.navigate', { url: BASE });
    await sleep(2200);
    const guestHome = await page.eval('document.body.innerText');
    ok('未登录也提供「免费车卡」入口', guestHome.includes('免费车卡'));
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('免费车卡') || x.textContent.includes('新建角色卡'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(1600);
    const guestList = await page.eval('document.body.innerText');
    ok('访客可进入角色卡页', guestList.includes('访客模式'));
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('新建角色卡'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(1600);
    const guestEditor = await page.eval('document.body.innerText');
    ok('访客可打开车卡编辑器', guestEditor.includes('属性明细与年龄补正'));
    ok('访客编辑器提示仅存本机', guestEditor.includes('本机浏览器'));
    ok('访客保存按钮为「保存到本机」', guestEditor.includes('保存到本机'));

    console.log('\n== 技能页（默认全部技能 / 高亮 / 自定义技能） ==');
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('技能分配'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(900);
    const skillText = await page.eval('document.body.innerText');
    ok('默认显示全部技能', skillText.includes('显示全部技能'));
    ok('信用评级高亮提示职业区间', skillText.includes('职业要求') || skillText.includes('选择职业后可校验区间'));
    ok('克苏鲁神话有专门提示', skillText.includes('不可用点数提升'));
    ok('提供自定义技能区块', skillText.includes('自定义技能'));
    const specSelects = await page.eval('document.querySelectorAll("select").length');
    ok('专攻技能使用下拉菜单', specSelects > 3, `select 数量 ${specSelects}`);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('添加技能'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(600);
    const afterAdd = await page.eval('document.body.innerText');
    ok('可以添加自定义技能', afterAdd.includes('技能名称'));


    console.log('\n== 属性不被清零（回归：年龄补正 bug） ==');
    await page.send('Page.navigate', { url: BASE });
    await sleep(300);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('免费车卡'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(900);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('新建角色卡'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(900);
    // 选职业（现在职业是必选）
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('选择职业'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(700);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('会计师'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(700);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('一键掷骰生成属性'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(700);
    const before = await page.eval(`[...document.querySelectorAll('input[type=number]')].slice(0,9).map(i=>i.value).join(',')`);
    const attrTotal = await page.eval(`[...document.querySelectorAll('input[type=number]')].slice(0,9).reduce((a,i)=>a+(Number(i.value)||0),0)`);
    ok('掷骰后属性有值', attrTotal > 100, `合计 ${attrTotal}`);
    const occChosen = await page.eval(`document.body.innerText.includes('职业要求') || document.body.innerText.includes('固定本职技能')`);
    ok('可以选择职业（必选）', occChosen === true);
    // 等所有挂起的请求与计时器落地 —— 旧版本这里会被重置成空白
    await sleep(6000);
    const after = await page.eval(`[...document.querySelectorAll('input[type=number]')].slice(0,9).map(i=>i.value).join(',')`);
    ok('等待 6 秒后属性未被清零', before === after && after !== '', `前 ${before} / 后 ${after}`);
    const stillOcc = await page.eval(`document.body.innerText.includes('固定本职技能')`);
    ok('等待后职业仍然保留', stillOcc === true);

    console.log('\n== 年龄可逐字输入（回归：被夹成 15 / 120） ==');
    const ageTyped = await page.eval(`(() => {
      const label = [...document.querySelectorAll('label')]
        .find(el => el.textContent.trim().startsWith('年龄') && el.querySelector('input[type=number]'));
      const input = label ? label.querySelector('input[type=number]') : null;
      if (!input) return { ok: false, reason: '找不到年龄输入框' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const type = (v) => { setter.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })); };
      input.focus();
      type('4');
      const afterOne = input.value;
      type('45');
      const afterTwo = input.value;
      input.blur();
      return { ok: true, afterOne, afterTwo };
    })()`);
    ok('年龄输入「4」时不会被立刻夹成 15', ageTyped.ok && ageTyped.afterOne === '4', JSON.stringify(ageTyped));
    ok('继续输入得到「45」', ageTyped.ok && ageTyped.afterTwo === '45', JSON.stringify(ageTyped));
    const ageApplied = await page.eval(`(() => {
      const label = [...document.querySelectorAll('label')]
        .find(el => el.textContent.trim().startsWith('年龄') && el.querySelector('input[type=number]'));
      return label ? label.querySelector('input[type=number]').value : '';
    })()`);
    ok('失焦后年龄保留为 45', ageApplied === '45', `实际 ${ageApplied}`);
    const allocUi = await page.eval(`document.body.innerText.includes('年龄补正分配') && document.body.innerText.includes('已分配')`);
    ok('40+ 岁出现「年龄补正分配」面板（合计减点由玩家分配）', allocUi === true);
    const freeSearch = await page.eval(`[...document.querySelectorAll('input')].some(i => i.placeholder === '搜索特长…')`);
    ok('自由特长点提供搜索框', freeSearch === true);

    console.log('\n== 资产 / 武器 / 技能方块 ==');
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('装备与经历'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(900);
    const assetText = await page.eval('document.body.innerText');
    ok('资产由信用评级自动计算并锁死', assetText.includes('由信用评级自动计算'));
    ok('展示消费水平/现金/资产', assetText.includes('消费水平') && assetText.includes('现金') && assetText.includes('资产'));
    ok('提供额外资产输入', assetText.includes('额外资产'));
    ok('提供时代与货币选择', assetText.includes('货币'));

    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('战斗'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(800);
    const weaponText = await page.eval('document.body.innerText');
    ok('武器表固定有徒手', weaponText.includes('徒手'));
    ok('徒手不可删除（显示常驻）', weaponText.includes('常驻'));
    const presetCount = await page.eval(`(() => { const s=[...document.querySelectorAll('select')].find(x=>x.textContent.includes('从武器表选择')); return s ? s.options.length : 0 })()`);
    ok('提供武器预设下拉', presetCount > 5, `选项 ${presetCount}`);

    console.log('\n== 武器可连续输入（回归：只输入第一个字母） ==');
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('自定义武器'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(700);
    const weaponTyped = await page.eval(`(() => {
      const rows = [...document.querySelectorAll('tbody tr')];
      const input = rows.length ? rows[rows.length - 1].querySelector('input') : null;
      if (!input) return { ok: false, reason: '找不到武器名称输入框' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const type = (v) => { setter.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })); };
      input.focus();
      type('A');
      const afterOne = input.value;
      type('AB');
      const afterTwo = input.value;
      return { ok: true, afterOne, afterTwo, connected: input.isConnected };
    })()`);
    ok('武器名可连续输入（A → AB）',
      weaponTyped.ok && weaponTyped.afterOne === 'A' && weaponTyped.afterTwo === 'AB',
      JSON.stringify(weaponTyped));
    ok('输入过程中该输入框没有被重建（保住焦点与输入法）',
      weaponTyped.ok && weaponTyped.connected === true, JSON.stringify(weaponTyped));

    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('技能分配'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(800);
    const markBoxes = await page.eval(`document.querySelectorAll('input[type=checkbox].accent-amber-500').length`);
    ok('每个技能前有大成功方块', markBoxes > 40, `方块 ${markBoxes} 个`);
    const specDefaults = await page.eval(`(() => {
      const sels=[...document.querySelectorAll('select')].filter(s=>s.value==='斗殴'||s.value==='手枪');
      return sels.map(s=>s.value).join(',');
    })()`);
    ok('格斗/射击默认斗殴与手枪', specDefaults.includes('斗殴') && specDefaults.includes('手枪'), specDefaults);


    console.log('\n== 教育增强面板 / 备注栏（v1.7） ==');
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('属性与职业'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(700);
    const eduUi = await page.eval(`document.body.innerText.includes('教育增强（年龄成长）')`);
    ok('编辑器有「教育增强（年龄成长）」面板', eduUi === true);
    const eduManual = await page.eval(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('清零教育补正'))`);
    ok('提供手动录入与「清零教育补正」', eduManual === true);
    // 首次结算 → 立即锁定（方案 C：玩家不能自助重掷）
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('自动检定并结算'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(900);
    const lockedText = await page.eval('document.body.innerText');
    ok('首次结算后出现「已结算 / 已锁定 / 结算流水」',
      lockedText.includes('已结算') && lockedText.includes('已锁定') && lockedText.includes('结算流水'));
    const rerollBtn = await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('重掷并结算') || x.textContent.includes('自动检定并结算'));
      return b ? { disabled: b.disabled, text: b.textContent.trim() } : null;
    })()`);
    ok('锁定后玩家端的结算按钮被禁用', rerollBtn?.disabled === true, JSON.stringify(rerollBtn));
    const lockedHint = await page.eval(`document.body.innerText.includes('服务端同样会拦') || document.body.innerText.includes('请让 KP')`);
    ok('锁定后给出「找 KP 授权重掷」的提示', lockedHint === true);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('装备与经历'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(700);
    const notesUi = await page.eval(`document.body.innerText.includes('只做记录，不会打印在角色卡上')`);
    ok('编辑器提供「备注」栏并标明不打印', notesUi === true);

    console.log('\n== 角色卡导入 / 导出（v1.7） ==');
    // Node 侧生成一段真实编码，再粘贴进页面，验证「编码 → 新卡」整条链路
    const demoCode = await exportCardCode({
      ...blankSheet(),
      name: '导入测试员', occupationId: 2, age: 30, gender: '女', era: '1920s',
      chars: { STR: 55, CON: 60, SIZ: 50, DEX: 65, APP: 70, INT: 65, POW: 55, EDU: 75, Luck: 40 },
      notes: '导入链路自检',
    });
    await page.send('Page.navigate', { url: BASE });
    await sleep(1400);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('免费车卡'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(1200);
    const hasImportBtn = await page.eval(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('导入角色卡'))`);
    ok('角色卡列表提供「导入角色卡」', hasImportBtn === true);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('导入角色卡'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(700);
    await page.eval(`(() => {
      const ta = [...document.querySelectorAll('textarea')].find(t => (t.placeholder || '').startsWith('COC7'));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(demoCode)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return Boolean(ta);
    })()`);
    await sleep(400);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '解析');
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(900);
    const parsedText = await page.eval('document.body.innerText');
    ok('粘贴编码后解析成功并显示预览', parsedText.includes('解析成功') && parsedText.includes('导入测试员'));
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('创建为新角色卡'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(1200);
    const afterImport = await page.eval('document.body.innerText');
    ok('导入后列表出现新卡', afterImport.includes('导入测试员'));

    // 打开这张卡 → 详情页 → 导出弹窗（卡片底部有「查看」按钮）
    await page.eval(`(() => {
      const title = [...document.querySelectorAll('h3')].find(h => h.textContent.includes('导入测试员'));
      let node = title;
      let btn = null;
      while (node && !btn) {
        btn = [...node.querySelectorAll('button')].find(b => b.textContent.trim() === '查看');
        node = node.parentElement;
      }
      if (btn) btn.click();
      return Boolean(btn);
    })()`);
    await sleep(1600);
    const detailText = await page.eval('document.body.innerText');
    ok('访客也能打开角色卡详情（含教育增强记录）',
      detailText.includes('导入测试员') && detailText.includes('教育增强记录'),
      detailText.split(String.fromCharCode(10)).join('|').slice(0, 160));
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('装备与经历'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(700);
    ok('详情页有「备注」栏（不打印）', (await page.eval('document.body.innerText')).includes('不会出现在骰娘指令与打印件上'));
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('导出编码'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(900);
    const exportText = await page.eval('document.body.innerText');
    ok('导出弹窗同时给出角色卡编码与骰娘指令',
      exportText.includes('角色卡编码') && exportText.includes('骰娘机器人导入指令'));
    const botCmd = await page.eval(`(() => {
      const ta = [...document.querySelectorAll('textarea')].find(t => (t.value || '').startsWith('.st '));
      return ta ? ta.value.slice(0, 40) : '';
    })()`);
    ok('骰娘指令以 .st 开头并含属性别名', botCmd.startsWith('.st ') && botCmd.includes('力量'), botCmd);
    const cardCode = await page.eval(`(() => {
      const ta = [...document.querySelectorAll('textarea')].find(t => (t.value || '').startsWith('COC7'));
      return ta ? ta.value.slice(0, 6) : '';
    })()`);
    ok('角色卡编码以 COC7 开头', cardCode.startsWith('COC7'), cardCode);
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('关闭'));
      if (b) b.click();
      return Boolean(b);
    })()`);
    await sleep(500);
    // 清掉自检导入的访客卡，避免影响后续断言
    await page.eval(`(() => { localStorage.removeItem('coc.guest.sheets.v1'); return true; })()`);


    console.log('\n== 原生控件暗色化 / 母语语种 ==');
    // 上面「访客模式」那一段清掉了登录态，这里先恢复，后续步骤需要 KP 权限
    await page.eval(`(() => {
      localStorage.setItem('token', ${JSON.stringify(seedUser.token)});
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify(seedUser.user))});
      return true;
    })()`);
    await page.send('Page.navigate', { url: BASE });
    await sleep(2400);
    const native = await page.eval('document.querySelectorAll("datalist").length');
    ok('页面内已无原生 datalist（白色弹层根因）', native === 0, `datalist ${native}`);
    const scheme = await page.eval('getComputedStyle(document.documentElement).colorScheme');
    ok('html color-scheme = dark（原生 select 弹层随系统暗色）', scheme === 'dark', scheme);
    const optBg = await page.eval(`(()=>{const o=document.querySelector('select option'); return o?getComputedStyle(o).backgroundColor:''})()`);
    ok("option 显式暗色背景", Boolean(optBg) && !optBg.startsWith("rgb(255"), optBg);

    // 合集选择器：自绘暗色下拉
    await page.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('发布模组'));b&&b.click();return 1})()`);
    await sleep(1800);
    await page.eval(`(()=>{const i=[...document.querySelectorAll('input')].find(x=>x.placeholder&&x.placeholder.includes('合集'));
      if(!i) return 0; i.dispatchEvent(new FocusEvent('focusin',{bubbles:true})); i.focus(); return 1})()`);
    await sleep(800);
    const darkPanel = await page.eval(`(()=>{
      const p=document.querySelector('[data-combobox-panel]');
      if(!p) return null;
      const bg=getComputedStyle(p).backgroundColor;
      const esc = String.fromCharCode(10);
      // Tailwind v4 用 oklch 表示颜色，这里只判断「不是透明、不是白色」
      const dark = bg !== "rgba(0, 0, 0, 0)" && !bg.startsWith("rgb(255");
      return { bg, dark, text: p.innerText.split(esc).join('/').slice(0,40) };
    })()`);
    ok('合集下拉是自绘暗色面板', darkPanel?.dark === true && (darkPanel.text || '').length > 0, JSON.stringify(darkPanel));

    // 母语语种
    await page.send('Page.navigate', { url: BASE }); await sleep(2000);
    await page.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('免费车卡')||x.textContent.includes('我的角色卡'));b&&b.click();return 1})()`);
    await sleep(1400);
    await page.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('新建角色卡'));b&&b.click();return 1})()`);
    await sleep(1600);
    await page.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('技能分配'));b&&b.click();return 1})()`);
    await sleep(1000);
    const langInput = await page.eval(`(()=>{const i=[...document.querySelectorAll('input')].find(x=>x.placeholder&&x.placeholder.includes('例：中文')); return i?i.placeholder:'无'})()`);
    ok('母语提供语种输入框', langInput !== '无', langInput);
    const langHint = await page.eval(`document.body.innerText.includes('未选择语种')`);
    ok('未填语种时给出提示', langHint === true);

    console.log('\n== 修改用户名 ==');
    await page.send('Page.navigate', { url: BASE });
    await sleep(2200);
    await page.eval(`(()=>{const u=${JSON.stringify(seedUser.user.username)};const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(u));b&&b.click();return 1})()`);
    await sleep(1600);
    const profileText = await page.eval('document.body.innerText');
    ok('个人中心有「账号资料」卡片', profileText.includes('账号资料'));
    const renameInput = await page.eval(`(()=>{const i=[...document.querySelectorAll('input')].find(x=>x.maxLength===24 && x.value); return i?i.value:'无'})()`);
    ok('用户名可编辑且预填当前值', renameInput !== '无', renameInput);
    const saveBtn = await page.eval(`Boolean([...document.querySelectorAll('button')].find(x=>x.textContent.includes('保存用户名')))`);
    ok('提供保存用户名按钮', saveBtn === true);

    console.log('\n== 模组封面（档案封印） ==');
    await page.send('Page.navigate', { url: BASE });
    await sleep(2400);
    const cover = await page.eval(`(()=>{
      const art=[...document.querySelectorAll('div[aria-hidden="true"]')].find(d=>d.textContent.includes('NO.'));
      if(!art) return null;
      const txt=art.textContent||'';
      const seal=art.querySelectorAll('.rounded-full').length;
      const brackets=[...art.querySelectorAll('span')].filter(s=>String(s.className).includes('border-amber-200/45')).length;
      return { hasFileNo: /NO\.[0-9A-Z]{4,8}/.test(txt), sealRings: seal, brackets, text: txt.slice(0,24) };
    })()`);
    ok('卡片封面出现档案编号', cover?.hasFileNo === true, JSON.stringify(cover));
    ok('卡片封面有四角装饰角标', (cover?.brackets || 0) >= 4, `角标 ${cover?.brackets}`);
    ok('卡片封面有蜡封印章', (cover?.sealRings || 0) >= 2, `圆环 ${cover?.sealRings}`);
    const goldDivider = await page.eval(`document.querySelectorAll('span.rotate-45').length`);
    ok('标题下有烫金分隔线', goldDivider > 0, `菱形 ${goldDivider}`);

    // 详情页头图用同一套装饰
    await page.eval(`(()=>{const c=[...document.querySelectorAll('div.cursor-pointer')].find(d=>d.textContent.includes('查阅档案'));c&&c.click();return 1})()`);
    await sleep(2000);
    const heroCover = await page.eval(`(()=>{
      const art=[...document.querySelectorAll('div[aria-hidden="true"]')].find(d=>d.textContent.includes('档案编号'));
      return art ? (art.textContent||'').slice(0,30) : null;
    })()`);
    ok('详情页头图也有档案封印', Boolean(heroCover) && heroCover.includes('档案编号'), String(heroCover));

    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, 'editor.png'), Buffer.from(shot.data, 'base64'));
    console.log(`  截图：${path.join(SHOTS, 'editor.png')}`);
  } else {
    console.log('  （未提供可用账号，跳过登录后的界面检查；可用 UI_USER/UI_PASS 环境变量指定）');
  }

  cleanup(fail ? 1 : 0);
} catch (err) {
  console.error('界面测试异常：', err.message);
  try {
    const shot = await Promise.resolve(null);
    void shot;
  } catch { /* ignore */ }
  cleanup(1);
}
