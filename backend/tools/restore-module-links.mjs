/**
 * 一次性修复工具：找回「编辑角色卡保存后被清空」的模组经历。
 *
 * 背景：v1.6.1 之前，车卡编辑器保存（全量 PUT）会漏掉 moduleLinks，导致角色卡的
 *       「模组经历」被清空（v1.6.1 已修）。本工具从每日备份里把丢失的关联读回来。
 *
 * ⚠️ 必须在**停掉后端服务**之后运行 —— 后端把整库常驻内存，边跑边改文件会被它覆盖回去。
 *    脚本在 --apply 前会探测 127.0.0.1:<PORT>/api/health，服务还活着就直接拒绝执行。
 *
 * 用法（在站点根目录，即 backend/ 的上一级）：
 *   node backend/tools/restore-module-links.mjs                 # 只列出能恢复什么，不改任何数据
 *   node backend/tools/restore-module-links.mjs --apply         # 写入（先自动备份当前库）
 *   node backend/tools/restore-module-links.mjs --backup backend/data/backups/database-2026-09-12.json --apply
 *
 * 可选参数：
 *   --db <path>      指定当前数据库文件（默认 backend/data/database.json）
 *   --port <n>       健康检查端口（默认 3000，可用环境变量 PORT 覆盖）
 *
 * 只会补「当前为空、备份里非空」的角色卡；备份里指向已删除模组的条目会被丢弃。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const APPLY = flag('--apply');
const PORT = opt('--port', process.env.PORT || '3000');

const DATA_DIR = process.env.COCOC_DATA_DIR
  ? path.resolve(process.env.COCOC_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_FILE = path.resolve(opt('--db', process.env.COCOC_DB_FILE || path.join(DATA_DIR, 'database.json')));

function newestBackup() {
  const dir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith('database-') && f.endsWith('.json'))
    .map((f) => ({ f, p: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files.length ? files[0].p : null;
}

const BACKUP = path.resolve(opt('--backup', newestBackup() || ''));

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

async function serviceAlive() {
  try {
    const ctl = AbortSignal.timeout(1200);
    const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: ctl });
    return r.ok;
  } catch {
    return false;
  }
}

if (!fs.existsSync(DB_FILE)) die(`找不到当前数据库：${DB_FILE}`);
if (!BACKUP || !fs.existsSync(BACKUP)) die(`找不到备份文件：${BACKUP || '(未指定且 backups/ 里没有快照)'}`);

const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
const backup = JSON.parse(fs.readFileSync(BACKUP, 'utf-8'));
const liveModules = new Set((db.modules || []).map((m) => m.id));
const backupCards = new Map((backup.characters || []).map((c) => [c.id, c]));

const plan = [];
for (const c of db.characters || []) {
  const old = backupCards.get(c.id);
  if (!old) continue;
  const kept = Array.isArray(c.moduleLinks) ? c.moduleLinks : [];
  const lost = (Array.isArray(old.moduleLinks) ? old.moduleLinks : [])
    .filter((l) => l && l.moduleId && liveModules.has(l.moduleId))
    .filter((l) => !kept.some((k) => k.moduleId === l.moduleId));
  if (lost.length) plan.push({ card: c, lost });
}

console.log(`\n当前库：${DB_FILE}`);
console.log(`备份：  ${BACKUP}`);
console.log(`可恢复的角色卡：${plan.length} 张\n`);
for (const { card, lost } of plan) {
  console.log(`  · ${card.name || '(未命名)'}  [${card.id}]  补回 ${lost.length} 条：`
    + lost.map((l) => l.moduleId).join('、'));
}
if (!plan.length) {
  console.log('没有需要恢复的关联（要么没丢，要么备份里也没有）。');
  process.exit(0);
}
if (!APPLY) {
  console.log('\n以上为**预演**，未改动任何数据。确认无误后加 --apply 执行。');
  process.exit(0);
}
if (await serviceAlive()) {
  die(`检测到 127.0.0.1:${PORT} 上的后端仍在运行。请先停掉服务（例如 docker compose stop / 面板里停止运行环境）再执行 --apply。`);
}

// 写入前先留一份现场快照
const stamp = `pre-linkrestore-${Date.now()}`;
const safetyDir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(safetyDir, { recursive: true });
const safety = path.join(safetyDir, `database-${stamp}.json`);
fs.copyFileSync(DB_FILE, safety);

for (const { card, lost } of plan) card.moduleLinks = [...(card.moduleLinks || []), ...lost];
const tmp = `${DB_FILE}.tmp-${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
fs.renameSync(tmp, DB_FILE);

console.log(`\n✅ 已补回 ${plan.length} 张角色卡的模组经历。`);
console.log(`   执行前的现场快照：${safety}`);
console.log('   现在可以重新启动后端服务。');
