/**
 * 账号资料卡片：修改用户名。
 *
 * 说明：
 *  - 用户名是**登录标识**，改名后下次登录要用新名字；当前会话令牌不受影响。
 *  - 系统会把「玩家名正好等于旧用户名」的角色卡一并改名，避免卡上留着旧称呼。
 *  - 手填过的其它玩家名不会被改动。
 */

import React, { useState } from 'react';
import { AtSign, Info, UserCog } from 'lucide-react';
import { apiPut } from '../lib/api.js';
import { Button, Field, Input, Panel } from './ui.jsx';

/** 与服务端保持一致的用户名规则 */
const USERNAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_.-]{2,24}$/;

export function usernameHint(name) {
  if (name.length < 2) return '用户名至少 2 位';
  if (name.length > 24) return '用户名最多 24 位';
  if (!USERNAME_RE.test(name)) return '只能包含中文、字母、数字、下划线、点或连字符';
  return null;
}

export default function AccountRenameCard({ currentUser, showToast, onRenamed }) {
  const [name, setName] = useState(currentUser?.username || '');
  const [busy, setBusy] = useState(false);

  const changed = name.trim() !== (currentUser?.username || '');

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    const problem = usernameHint(trimmed);
    if (problem) return showToast(problem, 'error');
    if (!changed) return showToast('用户名没有变化', 'error');
    setBusy(true);
    try {
      const res = await apiPut('/api/user/username', { username: trimmed });
      showToast(res.syncedCharacters
        ? `用户名已改为「${trimmed}」，同步更新了 ${res.syncedCharacters} 张角色卡的玩家名`
        : `用户名已改为「${trimmed}」`);
      onRenamed?.(res.user);
      setName(res.user.username);
    } catch (err) {
      showToast(err.message, 'error');
    } finally { setBusy(false); }
  };

  return (
    <Panel className="p-6">
      <h4 className="text-lg font-bold text-white mb-4 flex items-center">
        <UserCog className="w-4 h-4 mr-2 text-emerald-500" /> 账号资料
      </h4>
      <form onSubmit={submit} className="space-y-4">
        <Field label="用户名" hint="登录时使用，2-24 位">
          <div className="relative">
            <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              className="!pl-9"
              placeholder="中文、字母、数字、_ . -"
            />
          </div>
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || !changed}>
            {busy ? '提交中…' : '保存用户名'}
          </Button>
          {changed ? (
            <button type="button" onClick={() => setName(currentUser?.username || '')} className="text-sm text-slate-400 hover:text-slate-200">
              还原
            </button>
          ) : null}
        </div>
        <ul className="text-xs text-slate-500 space-y-1 leading-relaxed">
          <li className="flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            当前用户名：<b className="text-slate-300">{currentUser?.username}</b>。改名后<b className="text-slate-300">请用新名字登录</b>，当前登录状态不受影响。
          </li>
          <li className="flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            如果 KP 用你的用户名在证书上签名、或带团记录里写的是你的名字，那些是历史记录，不会跟着改。
          </li>
        </ul>
      </form>
    </Panel>
  );
}
