/**
 * 审计日志：把"谁在什么时候对什么做了什么"追加写入按天切分的 JSONL 文件。
 *
 * 用途：
 *  - KP 管理角色卡时的可追溯性（谁改过谁的卡）。
 *  - 安全事件排查（登录失败、越权尝试、数据删除）。
 * 只追加、不修改；保留最近 30 天，启动时清理过期文件。
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';
import { clientIp } from './security.js';

const AUDIT_DIR = path.join(DATA_DIR, 'audit');
const KEEP_DAYS = 30;

function fileFor(day) {
  return path.join(AUDIT_DIR, `audit-${day}.jsonl`);
}

export function pruneAudit(now = Date.now()) {
  try {
    if (!fs.existsSync(AUDIT_DIR)) return;
    const cutoff = new Date(now - KEEP_DAYS * 86400_000).toISOString().slice(0, 10);
    for (const f of fs.readdirSync(AUDIT_DIR)) {
      const m = /^audit-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && m[1] < cutoff) fs.unlinkSync(path.join(AUDIT_DIR, f));
    }
  } catch (err) {
    console.error('[audit] 清理失败:', err.message);
  }
}

/**
 * 记录一条审计事件（失败不抛错，绝不因为日志问题影响业务）。
 * @param {object} req express 请求（可为 null，如启动事件）
 * @param {string} action 动作，如 'character.update'
 * @param {object} detail 结构化细节（不要放口令等敏感值）
 */
export function audit(req, action, detail = {}) {
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    const entry = {
      at: new Date().toISOString(),
      action,
      actor: req?.user ? { id: req.user.id, username: req.user.username, role: req.user.role } : null,
      ip: req ? clientIp(req) : null,
      ua: req ? String(req.headers['user-agent'] || '').slice(0, 160) : null,
      ...detail,
    };
    fs.appendFileSync(fileFor(entry.at.slice(0, 10)), `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch (err) {
    console.error('[audit] 写入失败:', err.message);
  }
}

/** 读取指定日期的审计日志（仅管理员接口使用） */
export function readAudit(day, limit = 200) {
  const file = fileFor(day);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  return lines.slice(-limit).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}
