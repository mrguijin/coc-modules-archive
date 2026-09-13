/**
 * 统一错误类型与错误处理中间件。
 * 原则：对外只暴露「可预期、已脱敏」的错误信息，绝不返回堆栈或内部结构。
 */

export class HttpError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

export const badRequest = (msg, code = 'bad_request') => new HttpError(400, msg, code);
export const unauthorized = (msg = '未登录', code = 'unauthorized') => new HttpError(401, msg, code);
export const forbidden = (msg = '权限不足', code = 'forbidden') => new HttpError(403, msg, code);
export const notFound = (msg = '资源不存在', code = 'not_found') => new HttpError(404, msg, code);
export const tooMany = (msg = '操作过于频繁，请稍后再试', code = 'rate_limited') => new HttpError(429, msg, code);

/** 404 兜底（仅 API 前缀会走到这里） */
export function notFoundHandler(req, res) {
  res.status(404).json({ error: '接口不存在' });
}

/** 统一错误出口 */
export function errorHandler(err, req, res, _next) {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof HttpError && err.expose ? err.message : '服务器内部错误';
  if (status >= 500) {
    // 仅服务端可见的详细日志；响应体不泄露细节
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }
  if (res.headersSent) return;
  res.status(status).json({ error: message });
}
