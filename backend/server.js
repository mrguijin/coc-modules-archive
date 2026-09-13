/**
 * COC「秘密调查档案馆」后端入口。
 *
 * 架构：
 *   server.js            启动、中间件编排、路由挂载、优雅退出
 *   lib/db.js            JSON 数据层（原子写 + 备份 + 迁移）
 *   lib/security.js      scrypt 口令、令牌摘要、限流、安全响应头
 *   lib/auth.js          鉴权中间件（requireAuth / requireAdmin）
 *   lib/validate.js      输入白名单与校验
 *   lib/audit.js         审计日志
 *   routes/*.js          业务路由
 *   ../shared/coc7e.js   COC 7e 规则引擎（与前端共用，保证前后端算法一致）
 *
 * 环境变量：
 *   PORT                 监听端口（默认 3000）
 *   COCOC_HOST           监听地址（默认 0.0.0.0；生产建议 127.0.0.1，由 Nginx 反代）
 *   COCOC_DATA_DIR       数据目录（默认 backend/data）
 *   COCOC_DB_FILE        数据文件路径
 *   COCOC_TRUST_PROXY    1=信任反向代理传来的 X-Forwarded-For 末位（默认 1）
 *   COCOC_ORIGIN_ALLOW   允许的跨域来源（默认空=不开启 CORS，仅同源）
 */

import express from 'express';
import { load, save } from './lib/db.js';
import { RateLimiter, securityHeaders } from './lib/security.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { sweepExpiredTokens } from './lib/auth.js';
import { pruneAudit } from './lib/audit.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/users.js';
import contentRoutes from './routes/modules.js';
import characterRoutes from './routes/characters.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.COCOC_HOST || '0.0.0.0';
const START = Date.now();

load();
const swept = sweepExpiredTokens();
if (swept) { save(); console.log(`[auth] 已清理 ${swept} 个过期会话`); }
pruneAudit();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.COCOC_TRUST_PROXY === '0' ? false : 'loopback');

// --- 基础中间件 ---------------------------------------------------------
app.use(securityHeaders);
app.use(express.json({ limit: '256kb' }));          // 原实现无上限，可被大包打满内存
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

const globalLimiter = new RateLimiter({ windowMs: 60_000, max: 600, name: 'global' });
app.use((req, res, next) => {
  const key = req.ip || req.socket?.remoteAddress || 'unknown';
  const r = globalLimiter.check(key);
  if (!r.ok) {
    res.setHeader('Retry-After', String(r.retryAfter));
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
  next();
});

app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    if (req.originalUrl !== '/api/health') {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms ${req.ip || ''}`);
    }
  });
  next();
});

// --- 可选跨域（默认关闭：站点与接口同源，无需 CORS，减少攻击面） ----------
const ORIGIN_ALLOW = (process.env.COCOC_ORIGIN_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean);
if (ORIGIN_ALLOW.length) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ORIGIN_ALLOW.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

// --- 路由 ---------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptimeSec: Math.floor((Date.now() - START) / 1000), version: 2 });
});
app.use('/api', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', contentRoutes);
app.use('/api', characterRoutes);

app.use('/api', notFoundHandler);
app.use(errorHandler);

const server = app.listen(PORT, HOST, () => {
  console.log(`[server] COC 档案馆后端已启动 http://${HOST}:${PORT}  (${new Date().toISOString()})`);
});

function shutdown(signal) {
  console.log(`[server] 收到 ${signal}，正在关闭…`);
  server.close(() => {
    try { save(); } catch (err) { console.error('[server] 关闭前落盘失败:', err.message); }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('[server] 未处理的 Promise 拒绝:', err));
