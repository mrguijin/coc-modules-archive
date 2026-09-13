/**
 * 认证与账号路由：
 *   POST   /api/register                 首次初始化（仅当系统内无任何账号）
 *   POST   /api/login                    登录
 *   POST   /api/logout                   登出（吊销当前令牌）
 *   GET    /api/user/me                  当前用户信息
 *   PUT    /api/user/password            修改自己的口令
 *   GET    /api/kp-name                  公开的 KP 署名
 *
 * 安全要点：
 *  - 登出不再"只删前端 localStorage"，而是在服务端吊销令牌。
 *  - 口令强度服务端强制校验，前端提示只是辅助。
 *  - 登录失败按 IP + 用户名双维度限流，成功后清零。
 */

import { Router } from 'express';
import {
  db, findUserById, publicUser, save, syncPlayerName, usernameTaken,
} from '../lib/db.js';
import {
  checkPasswordStrength, clientIp, FailLimiter, hashPassword, verifyPassword,
} from '../lib/security.js';
import { badRequest, tooMany, unauthorized } from '../lib/errors.js';
import { issueToken, loginResponse, requireAuth, revokeToken } from '../lib/auth.js';
import { parseLogin, parsePasswordChange, parseRegister, parseUsernameChange } from '../lib/validate.js';
import { audit } from '../lib/audit.js';

const router = Router();

/** 登录失败限流：同一 IP 15 分钟 10 次；同一用户名 15 分钟 8 次 */
const ipFail = new FailLimiter({ windowMs: 15 * 60_000, max: 10 });
const userFail = new FailLimiter({ windowMs: 15 * 60_000, max: 8 });

router.get('/kp-name', (req, res) => {
  const admin = db().users.find((u) => u.role === 'admin');
  res.json({ kpName: admin ? admin.username : '档案馆首席 KP' });
});

router.post('/register', (req, res) => {
  const { username, password } = parseRegister(req.body);
  const database = db();
  if (database.users.length > 0) {
    audit(req, 'auth.register_rejected', { username });
    throw badRequest('系统已初始化，新账号请联系 KP 获取！');
  }
  const problem = checkPasswordStrength(password);
  if (problem) throw badRequest(problem);

  const rec = hashPassword(password);
  const now = Date.now();
  const user = {
    id: `u_${now.toString(36)}`,
    username,
    passwordHash: rec.hash,
    passwordSalt: rec.salt,
    passwordAlgo: 'scrypt',
    passwordParams: { N: rec.N, r: rec.r, p: rec.p },
    role: 'admin',
    title: '首席守秘人',
    tokenHash: null,
    tokenExpiresAt: 0,
    createdAt: now,
    updatedAt: now,
  };
  const raw = issueToken(user);
  database.users.push(user);
  save();
  audit(req, 'auth.register_admin', { userId: user.id, username });
  res.json(loginResponse(user, raw));
});

router.post('/login', (req, res) => {
  const ip = clientIp(req);
  const { username, password } = parseLogin(req.body);

  const ipState = ipFail.blocked(ip);
  if (!ipState.ok) {
    audit(req, 'auth.login_rate_limited', { username, scope: 'ip' });
    throw tooMany(`登录尝试过于频繁，请 ${ipState.retryAfter} 秒后再试`);
  }
  const key = `${ip}|${username}`;
  const uState = userFail.blocked(key);
  if (!uState.ok) {
    audit(req, 'auth.login_rate_limited', { username, scope: 'user' });
    throw tooMany(`该账号登录失败次数过多，请 ${uState.retryAfter} 秒后再试`);
  }

  const database = db();
  const user = database.users.find((u) => u.username === username);
  // 无论用户是否存在都执行一次哈希校验，避免通过响应时间枚举用户名
  const dummy = { salt: 'x'.repeat(32), hash: 'y'.repeat(128), N: 16384, r: 8, p: 1 };
  const ok = user && user.passwordHash
    ? verifyPassword(password, {
      salt: user.passwordSalt, hash: user.passwordHash, ...(user.passwordParams || {}),
    })
    : verifyPassword(password, dummy);

  if (!user || !ok) {
    ipFail.fail(ip);
    userFail.fail(key);
    audit(req, 'auth.login_failed', { username });
    throw unauthorized('用户名或密码错误');
  }

  ipFail.reset(ip);
  userFail.reset(key);
  const raw = issueToken(user);
  save();
  audit(req, 'auth.login', { userId: user.id, username });
  res.json(loginResponse(user, raw));
});

router.post('/logout', requireAuth, (req, res) => {
  revokeToken(req.user);
  save();
  audit(req, 'auth.logout', { userId: req.user.id });
  res.json({ success: true });
});

router.get('/user/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

/**
 * 修改自己的用户名。
 * 用户名是登录标识，改名后**登录名立即变化**，当前会话（令牌）不受影响。
 * 会连带把「playerName 正好等于旧名」的角色卡一起改名，避免卡上留着旧称呼。
 */
router.put('/user/username', requireAuth, (req, res) => {
  const { username } = parseUsernameChange(req.body);
  const user = findUserById(req.user.id);
  if (!user) throw unauthorized('账号不存在');
  if (user.username === username) throw badRequest('新用户名与当前用户名相同');
  if (usernameTaken(username, user.id)) throw badRequest('该用户名已被占用');

  const oldName = user.username;
  user.username = username;
  user.updatedAt = Date.now();
  const synced = syncPlayerName(user.id, oldName, username);
  save();
  audit(req, 'user.rename', { userId: user.id, from: oldName, to: username, syncedCharacters: synced });
  res.json({ success: true, user: publicUser(user), syncedCharacters: synced });
});

router.put('/user/password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = parsePasswordChange(req.body);
  const user = findUserById(req.user.id);
  if (!user) throw unauthorized('账号不存在');
  const ok = verifyPassword(oldPassword, {
    salt: user.passwordSalt, hash: user.passwordHash, ...(user.passwordParams || {}),
  });
  if (!ok) {
    audit(req, 'user.password_change_failed', { userId: user.id });
    throw badRequest('原密码错误');
  }
  const problem = checkPasswordStrength(newPassword);
  if (problem) throw badRequest(problem);
  if (newPassword === oldPassword) throw badRequest('新密码不能与原密码相同');

  const rec = hashPassword(newPassword);
  user.passwordHash = rec.hash;
  user.passwordSalt = rec.salt;
  user.passwordAlgo = 'scrypt';
  user.passwordParams = { N: rec.N, r: rec.r, p: rec.p };
  user.mustChangePassword = false;
  revokeToken(user); // 改密后强制所有会话失效
  save();
  audit(req, 'user.password_changed', { userId: user.id });
  res.json({ success: true });
});

export default router;
