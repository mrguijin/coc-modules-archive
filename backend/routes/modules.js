/**
 * 模组档案 / 已跑标记 / KP 带团记录路由。
 *
 * 与旧实现的关键差异：
 *  - POST/PUT 使用显式白名单（parseModule），彻底修掉「客户端可覆盖 id」的写入漏洞。
 *  - 删除模组时级联清理 played_records、sessions，并**解除角色卡上的模组经历关联**。
 *  - 带团记录的玩家名单与人数在服务端做了长度与区间约束。
 */

import { Router } from 'express';
import {
  db, save, findModuleById, newId,
} from '../lib/db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { parseModule, parseSession, vId } from '../lib/validate.js';
import { audit } from '../lib/audit.js';

const router = Router();

const THEME_COLORS = [
  'from-gray-900 to-slate-700', 'from-green-900 to-emerald-900',
  'from-purple-900 to-indigo-900', 'from-red-950 to-orange-900',
  'from-blue-950 to-cyan-900', 'from-amber-900 to-stone-900',
];

// ------------------------------------------------------------------ 模组
router.get('/modules', (req, res) => {
  const modules = [...db().modules].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  res.json(modules);
});

router.post('/modules', requireAdmin, (req, res) => {
  const data = parseModule(req.body);
  const now = Date.now();
  // id / themeColor / createdAt 由服务端生成，客户端无从干预
  const mod = {
    id: newId('m'),
    ...data,
    themeColor: THEME_COLORS[Math.floor(Math.random() * THEME_COLORS.length)],
    createdAt: now,
    updatedAt: now,
    createdBy: req.user.id,
  };
  db().modules.push(mod);
  save();
  audit(req, 'module.create', { moduleId: mod.id, title: mod.title });
  res.json(mod);
});

router.put('/modules/:id', requireAdmin, (req, res) => {
  const id = vId(req.params.id, '模组');
  const mod = findModuleById(id);
  if (!mod) throw notFound('找不到该模组');
  const data = parseModule(req.body, { partial: true });
  Object.assign(mod, data, { updatedAt: Date.now() });
  save();
  audit(req, 'module.update', { moduleId: id, fields: Object.keys(data) });
  res.json(mod);
});

router.delete('/modules/:id', requireAdmin, (req, res) => {
  const id = vId(req.params.id, '模组');
  const database = db();
  if (!findModuleById(id)) throw notFound('找不到该模组');
  database.modules = database.modules.filter((m) => m.id !== id);
  const played = database.played_records.filter((r) => r.moduleId === id).length;
  database.played_records = database.played_records.filter((r) => r.moduleId !== id);
  const sessions = database.sessions.filter((s) => s.moduleId === id).length;
  database.sessions = database.sessions.filter((s) => s.moduleId !== id);
  // 角色卡上的「经历」关联也要一并摘除，避免出现指向已删模组的死链
  let unlinked = 0;
  for (const c of database.characters) {
    const before = c.moduleLinks?.length || 0;
    c.moduleLinks = (c.moduleLinks || []).filter((l) => l.moduleId !== id);
    if (c.moduleLinks.length !== before) { c.updatedAt = Date.now(); unlinked += 1; }
  }
  save();
  audit(req, 'module.delete', { moduleId: id, played, sessions, unlinkedCharacters: unlinked });
  res.json({ success: true, playedRemoved: played, sessionsRemoved: sessions, charactersUnlinked: unlinked });
});

// ------------------------------------------------------------------ 已跑标记
router.get('/played', requireAuth, (req, res) => {
  res.json(db().played_records.filter((r) => r.userId === req.user.id));
});

router.post('/played', requireAuth, (req, res) => {
  const moduleId = vId(req.body?.moduleId, '模组');
  const database = db();
  if (!findModuleById(moduleId)) throw notFound('找不到该模组');
  const idx = database.played_records.findIndex(
    (r) => r.userId === req.user.id && r.moduleId === moduleId,
  );
  let played;
  if (idx >= 0) {
    database.played_records.splice(idx, 1);
    played = false;
  } else {
    database.played_records.push({ userId: req.user.id, moduleId, at: Date.now() });
    played = true;
  }
  save();
  audit(req, 'played.toggle', { moduleId, played });
  res.json({ success: true, played });
});

// ------------------------------------------------------------------ 带团记录
router.get('/sessions', requireAdmin, (req, res) => {
  const list = [...db().sessions].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json(list);
});

router.post('/sessions', requireAdmin, (req, res) => {
  const data = parseSession(req.body);
  if (!findModuleById(data.moduleId)) throw badRequest('模组不存在，请先收录该模组');
  const session = { id: newId('s'), ...data, createdAt: Date.now(), createdBy: req.user.id };
  db().sessions.push(session);
  save();
  audit(req, 'session.create', { sessionId: session.id, moduleId: data.moduleId });
  res.json(session);
});

router.delete('/sessions/:id', requireAdmin, (req, res) => {
  const id = vId(req.params.id, '记录');
  const database = db();
  const before = database.sessions.length;
  database.sessions = database.sessions.filter((s) => s.id !== id);
  if (database.sessions.length === before) throw notFound('找不到该记录');
  save();
  audit(req, 'session.delete', { sessionId: id });
  res.json({ success: true });
});

export default router;
