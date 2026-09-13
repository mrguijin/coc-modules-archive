/**
 * 登录 / 首次初始化
 * 从 App.jsx 抽出的视图组件；只通过 props 接收数据与回调，不直接发请求。
 */
import React from 'react';
import { Lock, User } from 'lucide-react';

export default function AuthView({ isLoginMode, setIsLoginMode, username, setUsername, password, setPassword, authError, setAuthError, onSubmit }) {
  return (
  <div className="max-w-md mx-auto mt-12 bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
    <h2 className="text-3xl font-bold text-center text-white mb-8">{isLoginMode ? '调查员登录' : '系统初始化'}</h2>
    {authError && <div className="mb-4 p-3 bg-red-500/10 text-red-400 text-sm rounded border border-red-500/20">{authError}</div>}
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="relative">
        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
        <input
          type="text" required value={username} onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          className="w-full pl-10 pr-4 py-3 bg-slate-950 border border-slate-700 rounded-lg text-white"
          placeholder="用户名"
        />
      </div>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
        <input
          type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete={isLoginMode ? 'current-password' : 'new-password'}
          className="w-full pl-10 pr-4 py-3 bg-slate-950 border border-slate-700 rounded-lg text-white"
          placeholder="密码"
        />
      </div>
      <button type="submit" className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold transition">
        {isLoginMode ? '进入档案馆' : '创建管理员'}
      </button>
    </form>
    {!isLoginMode && (
      <p className="mt-4 text-xs text-slate-500 text-center leading-relaxed">
        首个账号将成为管理员（KP）。密码至少 6 位即可。
      </p>
    )}
    <div className="mt-6 text-center">
      <button type="button" onClick={() => { setIsLoginMode(!isLoginMode); setAuthError(''); }} className="text-emerald-400 text-sm">
        {isLoginMode ? '点击初始化首个账号' : '切换登录'}
      </button>
    </div>
  </div>
  );
}
