/**
 * 鉴权中间件与会话签发。
 *
 * 与旧实现的区别：
 *  - 令牌在库中只存 SHA-256 摘要并带过期时间（旧实现存明文且永不过期）。
 *  - 每个请求都做一次「摘要 → 用户」的哈希表查找，且过期即失效。
 *  - 提供 requireAdmin / requireSelfOrAdmin 两个最小权限闸门，业务路由不再各自手写 role 判断。
 */

import { db, findUserByToken, publicUser } from './db.js';
import { forbidden, unauthorized } from './errors.js';
import { hashToken, newToken, tokenExpiry } from './security.js';
import { audit } from './audit.js';

/** 解析 Authorization: Bearer <token> */
function readToken(req) {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+([A-Za-z0-9_-]{16,200})$/.exec(h.trim());
  return m ? m[1] : null;
}

/** 必须登录 */
export function requireAuth(req, res, next) {
  const raw = readToken(req);
  if (!raw) return next(unauthorized('未登录'));
  const user = findUserByToken(raw);
  if (!user) {
    audit(req, 'auth.invalid_token');
    return next(unauthorized('登录状态已失效，请重新登录'));
  }
  req.user = user;
  req.token = raw;
  next();
}

/** 必须管理员 */
export function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (req.user.role !== 'admin') {
      audit(req, 'auth.forbidden', { path: req.originalUrl });
      return next(forbidden('权限不足'));
    }
    next();
  });
}

/** 可选登录：已登录则挂 req.user，未登录放行 */
export function optionalAuth(req, res, next) {
  const raw = readToken(req);
  if (raw) {
    const user = findUserByToken(raw);
    if (user) {
      req.user = user;
      req.token = raw;
    }
  }
  next();
}

/** 资源级最小权限判定：本人或管理员 */
export function canAccess(actor, ownerId) {
  if (!actor) return false;
  return actor.role === 'admin' || actor.id === ownerId;
}

/** 同上，但越权时直接抛出 403（供路由层使用） */
export function assertCanAccess(actor, ownerId) {
  if (canAccess(actor, ownerId)) return;
  throw forbidden('你没有权限访问该资源');
}

/** 签发新令牌：轮换旧令牌（单点登录语义），返回原始令牌（只在此刻出现一次） */
export function issueToken(user) {
  const raw = newToken();
  user.tokenHash = hashToken(raw);
  user.tokenExpiresAt = tokenExpiry();
  user.lastLoginAt = Date.now();
  user.updatedAt = Date.now();
  return raw;
}

export function revokeToken(user) {
  user.tokenHash = null;
  user.tokenExpiresAt = 0;
  user.updatedAt = Date.now();
}

export function loginResponse(user, rawToken) {
  return { token: rawToken, user: publicUser(user) };
}

/** 会话自检：库里是否存在过期令牌，启动时顺手清理 */
export function sweepExpiredTokens() {
  const now = Date.now();
  let n = 0;
  for (const u of db().users) {
    if (u.tokenHash && u.tokenExpiresAt && u.tokenExpiresAt < now) {
      u.tokenHash = null;
      u.tokenExpiresAt = 0;
      n += 1;
    }
  }
  return n;
}
