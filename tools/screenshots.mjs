#!/usr/bin/env node
/**
 * README 配图采集脚本 —— 用无头 Chrome 真实跑一遍站点，把关键功能页截成 PNG。
 *
 *   node tools/screenshots.mjs [站点地址] [接口地址] [输出目录]
 *     默认 http://127.0.0.1:4173  http://127.0.0.1:3000  docs/images
 *
 * 前置条件：
 *   1) 已用 `node tools/seed-demo.mjs` 造好演示库，并以 COCOC_DATA_DIR 指向它启动后端；
 *   2) `npm run build` 产物在跑（vite preview 或 Nginx）；
 *   3) 本机装有 Chrome / Edge。
 *
 * 脚本不做断言的「界面测试」，只负责把图拍清楚：每一步都等待渲染完成，
 * 遇到找不到的按钮会打印告警而不是中断，方便在不同版本上微调。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const API = process.argv[3] || 'http://127.0.0.1:3000';
const OUT = path.resolve(process.argv[4] || path.join(ROOT, 'docs', 'images'));
const PORT = 9411;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error('找不到 Chrome/Edge，无法截图。');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- CDP 客户端
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WebSocket 连接失败')); });
    const cdp = new Cdp(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
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
      }, 25000);
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '页面内脚本异常');
    return r.result.value;
  }
}

// ---------------------------------------------------------------- 小工具
let shotCount = 0;
async function shot(page, name, { full = false, maxHeight = 2600, selector = null, note = '' } = {}) {
  let clip = null;
  if (selector) {
    const box = await page.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return null;
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
    })()`);
    if (box) clip = { ...box, scale: 1 };
  }
  if (!clip && full) {
    const m = await page.send('Page.getLayoutMetrics');
    clip = {
      x: 0, y: 0, scale: 1,
      width: Math.min(m.cssContentSize.width, 1512),
      height: Math.min(m.cssContentSize.height, maxHeight),
    };
  }
  const args = { format: 'png', captureBeyondViewport: true };
  if (clip) args.clip = clip;
  const r = await page.send('Page.captureScreenshot', args);
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  shotCount += 1;
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`  📸 ${name}  (${kb} KB)${note ? '  ' + note : ''}`);
}

/** 点击第一个 innerText 含指定文字的按钮；找不到返回 false */
async function click(page, text, { tag = 'button', nth = 0, wait = 1200 } = {}) {
  const hit = await page.eval(`(() => {
    const list = [...document.querySelectorAll(${JSON.stringify(tag)})]
      .filter((el) => (el.innerText || '').includes(${JSON.stringify(text)}));
    const el = list[${nth}];
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  })()`);
  if (!hit) console.warn(`    ⚠️  找不到「${text}」`);
  await sleep(wait);
  return hit;
}

/** 在包含 containerText 的最近卡片里，点 innerText 含 buttonText 的按钮（最多向上找 6 层） */
async function clickIn(page, containerText, buttonText, { wait = 1600 } = {}) {
  const hit = await page.eval(`(() => {
    const want = ${JSON.stringify(buttonText)};
    const has = ${JSON.stringify(containerText)};
    for (const b of [...document.querySelectorAll('button')]) {
      if (!(b.innerText || '').includes(want)) continue;
      let p = b.parentElement, depth = 0;
      while (p && depth < 6) {
        if ((p.innerText || '').includes(has)) { b.scrollIntoView({ block: 'center' }); b.click(); return true; }
        p = p.parentElement; depth += 1;
      }
    }
    return false;
  })()`);
  if (!hit) console.warn(`    ⚠️  在「${containerText}」里找不到「${buttonText}」`);
  await sleep(wait);
  return hit;
}

async function goHome(page, token, user) {
  // 先落到站点源上，否则 about:blank 拒绝访问 localStorage
  await page.send('Page.navigate', { url: BASE });
  await sleep(1400);
  await page.eval(`(() => {
    if (${JSON.stringify(token)}) {
      localStorage.setItem('token', ${JSON.stringify(token)});
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
    } else {
      localStorage.removeItem('token'); localStorage.removeItem('user');
    }
    return 'ok';
  })()`);
  await page.send('Page.navigate', { url: BASE });
  await sleep(2200);
}

const text = (page) => page.eval('document.body.innerText');

// ---------------------------------------------------------------- 主流程
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-shots-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--force-device-scale-factor=1',
  '--window-size=1512,950',
  'about:blank',
], { stdio: 'ignore' });

function cleanup(code) {
  try { chrome.kill('SIGKILL'); } catch { /* ignore */ }
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(`\n共写出 ${shotCount} 张图片到 ${OUT}`);
  process.exit(code);
}

async function waitBrowser() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch { /* 未就绪 */ }
    await sleep(200);
  }
  throw new Error('无头浏览器启动超时');
}

try {
  const health = await fetch(`${API}/api/health`).catch(() => null);
  if (!health || !health.ok) throw new Error(`后端 ${API} 不可用，先启动演示环境`);

  const login = await (await fetch(`${API}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'keeper', password: 'Keeper-Demo-1920' }),
  })).json();
  if (!login.token) throw new Error('演示账号 keeper 登录失败，确认演示库已 seed');

  const browser = await Cdp.connect(await waitBrowser());
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = await Cdp.connect(list.find((t) => t.id === targetId).webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1512, height: 950, deviceScaleFactor: 1, mobile: false,
  });

  // ---------------------------------------------------------- 1. 访客视角
  console.log('\n== 访客：档案馆首页 / 模组详情 ==');
  await goHome(page, null, null);
  await sleep(600);
  await shot(page, '01-home.png', { full: true, maxHeight: 1700 });

  await page.eval(`(() => {
    const card = [...document.querySelectorAll('div.cursor-pointer')].find((d) => d.textContent.includes('查阅档案'));
    if (card) { card.scrollIntoView({ block: 'center' }); card.click(); }
    return Boolean(card);
  })()`);
  await sleep(1800);
  await shot(page, '02-module-detail.png', { full: true, maxHeight: 2200 });

  console.log('\n== 访客：免登录车卡 ==');
  await goHome(page, null, null);
  await click(page, '免费车卡', { wait: 1600 });
  await click(page, '新建角色卡', { wait: 1800 });
  await shot(page, '03-guest-editor.png', { full: true, maxHeight: 1500 });

  // ---------------------------------------------------------- 2. 玩家/KP 视角
  console.log('\n== 登录页 ==');
  await goHome(page, null, null);
  await click(page, '登录身份', { wait: 1500 });
  await shot(page, '04-login.png', { full: true, maxHeight: 1100 });

  console.log('\n== 角色卡管理 / 详情 ==');
  await goHome(page, login.token, login.user);
  await click(page, '角色卡管理', { wait: 2200 });
  await shot(page, '05-kp-characters.png', { full: true, maxHeight: 1700 });

  await clickIn(page, '伊莱亚斯', '查看', { wait: 2600 });
  await shot(page, '06-character-detail.png', { full: true, maxHeight: 2800 });

  console.log('\n== 车卡编辑器 ==');
  await click(page, '编辑', { wait: 2400 });
  await shot(page, '07-editor-attributes.png', { full: true, maxHeight: 1700 });
  await click(page, '技能分配', { wait: 1400 });
  await shot(page, '08-editor-skills.png', { full: true, maxHeight: 2000 });
  await click(page, '装备与经历', { wait: 1400 });
  await shot(page, '09-editor-equipment.png', { full: true, maxHeight: 1800 });

  console.log('\n== A4 打印版面 ==');
  // 打印入口在角色卡详情页头部，从列表重新进一次
  await goHome(page, login.token, login.user);
  await click(page, '角色卡管理', { wait: 2400 });
  await clickIn(page, '伊莱亚斯', '查看', { wait: 2600 });
  await click(page, 'PDF', { wait: 3000 });
  const printed = await page.eval(`document.body.innerText.includes('调查员') || document.body.innerText.includes('技能')`);
  if (printed) await shot(page, '10-character-print.png', { full: true, maxHeight: 2900 });
  else console.warn('    ⚠️  打印预览没打开');

  console.log('\n== 守秘人控制台 ==');
  await goHome(page, login.token, login.user);
  await click(page, 'KP 控制台', { wait: 2600 });
  await shot(page, '11-kp-dashboard.png', { full: true, maxHeight: 2000 });

  console.log('\n== 审卡中心 ==');
  await goHome(page, login.token, login.user);
  await click(page, '审卡中心', { wait: 2600 });
  await shot(page, '12-review-queue.png', { full: true, maxHeight: 1500 });
  await click(page, '打开核对', { wait: 2400 });
  await shot(page, '13-review-detail.png', { full: true, maxHeight: 2400 });

  await goHome(page, login.token, login.user);
  await click(page, '审卡中心', { wait: 2600 });
  await click(page, '审卡规则', { wait: 1600 });
  await shot(page, '14-audit-rules.png', { full: true, maxHeight: 1800 });
  await click(page, '职业模板', { wait: 1600 });
  await shot(page, '15-review-occupations.png', { full: true, maxHeight: 1500 });

  console.log('\n== 个人中心 / 账号管理 ==');
  await goHome(page, login.token, login.user);
  await click(page, 'keeper', { wait: 2400 });
  await shot(page, '16-profile.png', { full: true, maxHeight: 1800 });

  await click(page, '账号管理', { wait: 2600 });
  const adminText = await text(page);
  if (adminText.includes('发放账号') || adminText.includes('重置')) {
    await shot(page, '17-admin-users.png', { full: true, maxHeight: 1600 });
  } else {
    console.warn('    ⚠️  账号管理未打开');
  }

  await goHome(page, login.token, login.user);
  await click(page, 'keeper', { wait: 2400 });
  await click(page, '预览并下载证书', { wait: 3000 });
  await shot(page, '18-certificate.png', { full: true, maxHeight: 2400 });

  cleanup(0);
} catch (err) {
  console.error('截图流程异常：', err.message);
  cleanup(1);
}
