/**
 * 修改个人密码。
 * 与服务端一致：只校验长度下限，不强制复杂度。
 */

import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { apiPut } from '../lib/api.js';
import { Button, Field, Input, Panel } from './ui.jsx';

/** 与服务端保持一致：只校验长度，不强制复杂度 */
export const PASSWORD_MIN = 6;

export function passwordHint(pwd) {
  if (pwd.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`;
  if (pwd.length > 128) return '密码过长（最多 128 位）';
  return null;
}

export default function PasswordChangeForm({ showToast, onChanged }) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const problem = passwordHint(newPwd);
    if (problem) return showToast(problem, 'error');
    if (newPwd !== confirmPwd) return showToast('两次输入的新密码不一致', 'error');
    setBusy(true);
    try {
      await apiPut('/api/user/password', { oldPassword: oldPwd, newPassword: newPwd });
      showToast('密码修改成功，请重新登录');
      onChanged?.();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="p-6">
      <h4 className="text-lg font-bold text-white mb-4 flex items-center">
        <KeyRound className="w-4 h-4 mr-2 text-emerald-500" /> 修改个人密码
      </h4>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="当前密码">
          <Input type="password" required value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="新密码" hint="至少 6 位">
          <Input type="password" required value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="确认新密码">
          <Input type="password" required value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} autoComplete="new-password" />
        </Field>
        <Button type="submit" disabled={busy} className="w-full">{busy ? '提交中…' : '确认修改'}</Button>
        <p className="text-xs text-slate-500">修改成功后当前登录状态会全部失效，需要用新密码重新登录。</p>
      </form>
    </Panel>
  );
}
