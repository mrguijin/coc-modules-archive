/**
 * 安全基础设施：口令哈希、令牌签发/校验、限流、安全响应头。
 *
 * 设计要点（信息网络安全准则 + 最小权限）：
 *  - 口令一律 scrypt 加盐哈希存储，任何人（含管理员）都无法读回明文。
 *  - 会话令牌只在签发瞬间返回给客户端，数据库里只保存 SHA-256 摘要 —— 即便数据库泄露也无法直接冒用。
 *  - 令牌带过期时间；登录即轮换，旧令牌立刻失效。
 *  - 登录/注册接口有独立的失败限流，避免暴力破解。
 */

import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

// ------------------------------------------------------------------ 口令
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024,
  }).toString('hex');
  return { algo: 'scrypt', salt, hash, N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p };
}

export function verifyPassword(password, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  try {
    const got = crypto.scryptSync(String(password), rec.salt, SCRYPT.keylen, {
      N: rec.N || SCRYPT.N, r: rec.r || SCRYPT.r, p: rec.p || SCRYPT.p, maxmem: 64 * 1024 * 1024,
    });
    const want = Buffer.from(rec.hash, 'hex');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

/**
 * 口令长度下限。
 * 按项目要求**不做强度强制**：只校验长度，不要求大小写/符号组合，也不做常见口令黑名单。
 * 真正兜底的是登录失败限流（见 routes/auth.js），而不是复杂度规则。
 */
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

export function checkPasswordStrength(password) {
  const s = String(password ?? '');
  if (s.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`;
  if (s.length > PASSWORD_MAX) return `密码过长（最多 ${PASSWORD_MAX} 位）`;
  return null;
}

/** 是否属于「需要提醒改密」的极弱口令（仅用于提示，不阻止登录） */
export function isVeryWeak(password) {
  const s = String(password ?? '');
  return s.length < PASSWORD_MIN;
}

// ------------------------------------------------------------------ 令牌
export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}
export function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}
export function tokenExpiry(from = Date.now()) {
  return from + TOKEN_TTL_MS;
}

// ------------------------------------------------------------------ 限流
/**
 * 进程内滑动窗口限流器。
 * 单实例部署足够；若将来横向扩展，应替换为 Redis 等共享存储。
 */
export class RateLimiter {
  constructor({ windowMs, max, name = 'limiter' }) {
    this.windowMs = windowMs;
    this.max = max;
    this.name = name;
    this.hits = new Map();
    this.timer = setInterval(() => this.sweep(), Math.min(windowMs, 60_000));
    if (this.timer.unref) this.timer.unref();
  }

  sweep(now = Date.now()) {
    for (const [key, arr] of this.hits) {
      const keep = arr.filter((t) => now - t < this.windowMs);
      if (keep.length) this.hits.set(key, keep);
      else this.hits.delete(key);
    }
  }

  /** @returns {{ok:boolean, remaining:number, retryAfter:number}} */
  check(key, now = Date.now()) {
    const arr = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      const retryAfter = Math.ceil((this.windowMs - (now - arr[0])) / 1000);
      this.hits.set(key, arr);
      return { ok: false, remaining: 0, retryAfter };
    }
    arr.push(now);
    this.hits.set(key, arr);
    return { ok: true, remaining: this.max - arr.length, retryAfter: 0 };
  }

  reset(key) {
    this.hits.delete(key);
  }
}

/** 只记失败次数的限流器（成功即清零，避免正常用户被误伤） */
export class FailLimiter extends RateLimiter {
  fail(key, now = Date.now()) {
    const arr = this.hits.get(key) || [];
    arr.push(now);
    this.hits.set(key, arr);
    return arr.filter((t) => now - t < this.windowMs).length;
  }
  blocked(key, now = Date.now()) {
    const arr = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (arr.length < this.max) return { ok: true, retryAfter: 0 };
    return { ok: false, retryAfter: Math.ceil((this.windowMs - (now - arr[0])) / 1000) };
  }
}

// ------------------------------------------------------------------ 请求工具
/** 取客户端 IP。
 *  优先使用 Express 依据 trust proxy 解析出的 req.ip（反向代理下取真实的直连对端，
 *  客户端自行伪造的 X-Forwarded-For 前缀不会被采信）；退化时取 socket 地址。 */
export function clientIp(req) {
  if (req?.ip) return String(req.ip).slice(0, 64);
  return (req?.socket?.remoteAddress || 'unknown').slice(0, 64);
}

/** 安全响应头（API 响应；页面本身的 CSP 见 index.html 与部署说明） */
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cache-Control', 'no-store');
  res.removeHeader('X-Powered-By');
  next();
}

/** 恒定时间字符串比较（用于令牌/摘要比对） */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
