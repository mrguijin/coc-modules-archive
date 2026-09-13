/**
 * 统一的接口客户端。
 *
 * 职责：
 *  - 统一附加 Authorization 头、统一解析后端 { error } 结构。
 *  - 统一超时（AbortController），避免请求悬挂。
 *  - 401 时自动清理本地登录态并广播事件，由 App 统一跳转登录页。
 *  - 所有写操作使用 JSON，并显式声明 Content-Type。
 */

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const session = {
  get token() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  },
  save(token, user) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch { /* 隐私模式下可能不可用 */ }
  },
  saveUser(user) {
    try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* ignore */ }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch { /* ignore */ }
  },
};

/** 登录态失效时广播，App 监听后统一回到登录页 */
function broadcastLogout(reason) {
  try { window.dispatchEvent(new CustomEvent('coc:unauthorized', { detail: { reason } })); } catch { /* ignore */ }
}

/**
 * @param {string} path 以 /api 开头的路径
 * @param {{method?:string, body?:any, timeout?:number, auth?:boolean}} [opts]
 */
export async function api(path, opts = {}) {
  const { method = 'GET', body, timeout = 20000, auth = true } = opts;
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && session.token) headers.Authorization = `Bearer ${session.token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new ApiError('请求超时，请检查网络后重试', 0, 'timeout');
    throw new ApiError('网络错误，无法连接服务器', 0, 'network');
  }
  clearTimeout(timer);

  if (res.status === 204) return null;

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }

  if (!res.ok) {
    if (res.status === 401 && auth) {
      session.clear();
      broadcastLogout(data?.error || '登录状态已失效');
    }
    throw new ApiError(data?.error || `请求失败（${res.status}）`, res.status, data?.code);
  }
  return data;
}

export const apiGet = (path, opts) => api(path, { ...opts, method: 'GET' });
export const apiPost = (path, body, opts) => api(path, { ...opts, method: 'POST', body });
export const apiPut = (path, body, opts) => api(path, { ...opts, method: 'PUT', body });
export const apiPatch = (path, body, opts) => api(path, { ...opts, method: 'PATCH', body });
export const apiDelete = (path, opts) => api(path, { ...opts, method: 'DELETE' });
