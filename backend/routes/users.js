/**
 * 管理员路由（仅管理员）：
 *   GET    /api/admin/users
 *   POST   /api/admin/users             发放账号
 *   PUT    /api/admin/users/:id/password 重置口令（随机强口令，不再固定 123456）
 *   PUT    /api/admin/users/:id/title    授予荣誉头衔
 *   DELETE /api/admin/users/:id          删除账号（级联清理其角色卡与已跑记录）
 *   GET    /api/admin/audit              查看审计日志（可选 ?date=YYYY-MM-DD）
 *
 * 最小权限说明：管理员可以管理账号，但**无法读取任何人的口令**（只存哈希），
 * 重置口令时服务端生成随机口令并只回显一次。
 */

import crypto from 'node:crypto';
import { Router } from 'express';
import {
  db, save, publicUser, findUserById, newId, findCustomOccupationById,
  syncPlayerName, usernameTaken,
} from '../lib/db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { checkPasswordStrength, hashPassword } from '../lib/security.js';
import { requireAdmin } from '../lib/auth.js';
import {
  parseNewUser, parseTitle, parseOccupationTemplate, parseAuditRules, parseUsernameChange, vId,
} from '../lib/validate.js';
import { audit, readAudit } from '../lib/audit.js';
import { DEFAULT_AUDIT_RULES, AUDIT_RULE_META } from '../../shared/coc7e.js';

const router = Router();
router.use(requireAdmin);

router.get('/users', (req, res) => {
  res.json(db().users.map((u) => ({
    ...publicUser(u),
    characterCount: db().characters.filter((c) => c.ownerId === u.id).length,
    lastLoginAt: u.lastLoginAt || null,
    createdAt: u.createdAt || null,
  })));
});

router.post('/users', (req, res) => {
  const { username, password, role } = parseNewUser(req.body);
  const database = db();
  if (database.users.some((u) => u.username === username)) throw badRequest('该用户名已存在');
  const problem = checkPasswordStrength(password);
  if (problem) throw badRequest(problem);

  const rec = hashPassword(password);
  const now = Date.now();
  const user = {
    id: `u_${now.toString(36)}${crypto.randomBytes(2).toString('hex')}`,
    username,
    passwordHash: rec.hash,
    passwordSalt: rec.salt,
    passwordAlgo: 'scrypt',
    passwordParams: { N: rec.N, r: rec.r, p: rec.p },
    role,
    title: role === 'admin' ? '首席守秘人' : '见习调查员',
    tokenHash: null,
    tokenExpiresAt: 0,
    createdAt: now,
    updatedAt: now,
  };
  database.users.push(user);
  save();
  audit(req, 'admin.user_create', { userId: user.id, username, role });
  res.json({ success: true, user: publicUser(user) });
});

router.put('/users/:id/password', (req, res) => {
  const id = vId(req.params.id, '用户');
  const user = findUserById(id);
  if (!user) throw notFound('找不到该用户');
  // 服务端生成随机口令：不再使用 123456 这类固定弱口令
  const plain = `coc-${crypto.randomBytes(6).toString('base64url')}`;
  const rec = hashPassword(plain);
  user.passwordHash = rec.hash;
  user.passwordSalt = rec.salt;
  user.passwordAlgo = 'scrypt';
  user.passwordParams = { N: rec.N, r: rec.r, p: rec.p };
  user.tokenHash = null;
  user.tokenExpiresAt = 0;
  user.updatedAt = Date.now();
  save();
  audit(req, 'admin.user_reset_password', { userId: id, username: user.username });
  res.json({ success: true, password: plain, note: '请立即转告本人并提醒其登录后自行修改' });
});

/** KP 代改用户名（发错账号名、玩家改名请求等场景） */
router.put('/users/:id/username', (req, res) => {
  const id = vId(req.params.id, '用户');
  const { username } = parseUsernameChange(req.body);
  const user = findUserById(id);
  if (!user) throw notFound('找不到该用户');
  if (user.username === username) throw badRequest('新用户名与该用户当前用户名相同');
  if (usernameTaken(username, id)) throw badRequest('该用户名已被占用');

  const oldName = user.username;
  user.username = username;
  user.updatedAt = Date.now();
  const synced = syncPlayerName(id, oldName, username);
  save();
  audit(req, 'admin.user_rename', { userId: id, from: oldName, to: username, syncedCharacters: synced });
  res.json({ success: true, user: publicUser(user), syncedCharacters: synced });
});

router.put('/users/:id/title', (req, res) => {
  const id = vId(req.params.id, '用户');
  const { title } = parseTitle(req.body);
  const user = findUserById(id);
  if (!user) throw notFound('找不到该用户');
  if (user.role === 'admin') throw badRequest('管理员的头衔固定为首席守秘人');
  user.title = title;
  user.updatedAt = Date.now();
  save();
  audit(req, 'admin.user_grant_title', { userId: id, username: user.username, title });
  res.json({ success: true, title });
});

router.delete('/users/:id', (req, res) => {
  const id = vId(req.params.id, '用户');
  if (req.user.id === id) throw badRequest('不能删除自己');
  const database = db();
  const user = findUserById(id);
  if (!user) throw notFound('找不到该用户');
  if (user.role === 'admin' && database.users.filter((u) => u.role === 'admin').length <= 1) {
    throw badRequest('至少需要保留一名管理员');
  }
  database.users = database.users.filter((u) => u.id !== id);
  // 级联清理：该用户的已跑记录与角色卡（旧实现会留下孤儿数据）
  const playedRemoved = database.played_records.filter((r) => r.userId === id).length;
  database.played_records = database.played_records.filter((r) => r.userId !== id);
  const charsRemoved = database.characters.filter((c) => c.ownerId === id).length;
  database.characters = database.characters.filter((c) => c.ownerId !== id);
  save();
  audit(req, 'admin.user_delete', { userId: id, username: user.username, playedRemoved, charsRemoved });
  res.json({ success: true, playedRemoved, charsRemoved });
});

router.get('/audit', (req, res) => {
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : new Date().toISOString().slice(0, 10);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  res.json({ date, entries: readAudit(date, limit) });
});


// ============================================================ 职业模板
/**
 * KP 自定义职业模板：给「规则书没写、但本桌需要」的职业用。
 * 模板只保存**点法与本职技能清单**，不保存任何玩家数据，因此对其他玩家是只读的。
 */
router.get('/occupations', (req, res) => {
  res.json({ items: db().customOccupations });
});

router.post('/occupations', (req, res) => {
  const data = parseOccupationTemplate(req.body);
  const database = db();
  if (database.customOccupations.some((o) => o.name === data.name)) {
    throw badRequest('已存在同名职业模板');
  }
  if (database.customOccupations.length >= 100) throw badRequest('自定义职业模板最多 100 个');
  const now = Date.now();
  const occ = {
    id: newId('cocc'),
    ...data,
    isCustom: true,
    createdBy: req.user.id,
    createdByName: req.user.username,
    createdAt: now,
    updatedAt: now,
  };
  database.customOccupations.push(occ);
  save();
  audit(req, 'admin.occupation_create', { id: occ.id, name: occ.name });
  res.json(occ);
});

router.put('/occupations/:id', (req, res) => {
  const id = vId(req.params.id, '职业模板');
  const occ = findCustomOccupationById(id);
  if (!occ) throw notFound('找不到该职业模板');
  const data = parseOccupationTemplate(req.body);
  const database = db();
  if (database.customOccupations.some((o) => o.name === data.name && o.id !== occ.id)) {
    throw badRequest('已存在同名职业模板');
  }
  Object.assign(occ, data, { updatedAt: Date.now() });
  save();
  audit(req, 'admin.occupation_update', { id: occ.id, name: occ.name });
  res.json(occ);
});

router.delete('/occupations/:id', (req, res) => {
  const id = vId(req.params.id, '职业模板');
  const occ = findCustomOccupationById(id);
  if (!occ) throw notFound('找不到该职业模板');
  const database = db();
  database.customOccupations = database.customOccupations.filter((o) => o.id !== occ.id);
  // 已使用该模板的角色卡保留 occupationId，但解析不到职业 → 前端显示「职业模板已删除」，提示 KP 处理
  const affected = database.characters.filter((c) => String(c.occupationId) === String(occ.id)).length;
  save();
  audit(req, 'admin.occupation_delete', { id: occ.id, name: occ.name, affected });
  res.json({ success: true, affectedCharacters: affected });
});

// ============================================================ 辅助审卡规则
router.get('/audit-rules', (req, res) => {
  res.json({
    rules: { ...DEFAULT_AUDIT_RULES, ...(db().settings?.auditRules || {}) },
    meta: AUDIT_RULE_META,
  });
});

router.put('/audit-rules', (req, res) => {
  const rules = parseAuditRules(req.body);
  const database = db();
  database.settings = database.settings || {};
  database.settings.auditRules = rules;
  save();
  audit(req, 'admin.audit_rules_update', { enabled: rules.enabled, keys: Object.keys(rules).length });
  res.json({ success: true, rules });
});

export default router;
