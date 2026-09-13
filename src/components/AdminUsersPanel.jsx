/**
 * 账号管理（仅 KP）。
 *
 * 与旧实现的差异：
 *  - 「重置密码」不再把口令固定成 123456，而是由服务端生成随机强口令并只显示一次。
 *  - 新建账号只要求密码长度 ≥6 位（不强制复杂度）。
 *  - 删除账号会同时清理该玩家的角色卡与已跑记录，界面明确提示影响范围。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Crown, RefreshCw, Shield, User as UserIcon, UserPlus, Users } from 'lucide-react';
import { apiDelete, apiGet, apiPost, apiPut } from '../lib/api.js';
import { Badge, Button, Field, Input, Modal, Panel, Select, SectionTitle, cx } from './ui.jsx';
import { usernameHint } from './AccountRenameCard.jsx';

const TITLES = ['见习调查员', '资深调查员', '精英调查员', '传奇调查员', '神话调查员'];

export default function AdminUsersPanel({ setView, showToast, showConfirm }) {
  const [users, setUsers] = useState([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(null);
  const [renaming, setRenaming] = useState(null);   // { id, username, chars }
  const [renameTo, setRenameTo] = useState('');

  const loadUsers = useCallback(async () => {
    try {
      setUsers(await apiGet('/api/admin/users'));
    } catch (err) { showToast(err.message, 'error'); }
  }, [showToast]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiPost('/api/admin/users', { username: newUsername, password: newPwd });
      showToast('用户创建成功');
      setNewUsername(''); setNewPwd('');
      loadUsers();
    } catch (err) {
      showToast(err.message, 'error');
    } finally { setBusy(false); }
  };

  const handleResetPwd = (userId, username) => showConfirm(
    `要重置用户【${username}】的密码吗？`,
    async () => {
      try {
        const res = await apiPut(`/api/admin/users/${userId}/password`, {});
        setIssued({ username, password: res.password });
        showToast('已生成新的随机密码，请立即转告本人');
        loadUsers();
      } catch (err) { showToast(err.message, 'error'); }
    },
    { detail: '系统会生成一个随机强口令，旧密码立即失效；请把它安全地转告本人。', danger: false },
  );

  const handleDeleteUser = (userId, username, charCount) => showConfirm(
    `确定要永久删除用户【${username}】吗？`,
    async () => {
      try {
        const res = await apiDelete(`/api/admin/users/${userId}`);
        showToast(`用户已删除（同时清理角色卡 ${res.charsRemoved} 张）`);
        loadUsers();
      } catch (err) { showToast(err.message, 'error'); }
    },
    { detail: `该用户名下有 ${charCount} 张角色卡，删除后一并清除且不可恢复。` },
  );

  /** KP 代改用户名 */
  const handleRename = async () => {
    const target = renaming;
    if (!target) return;
    const next = renameTo.trim();
    const problem = usernameHint(next);
    if (problem) return showToast(problem, 'error');
    if (next === target.username) return showToast('新用户名没有变化', 'error');
    try {
      const res = await apiPut(`/api/admin/users/${target.id}/username`, { username: next });
      showToast(res.syncedCharacters
        ? `已改名为「${next}」，同步更新了 ${res.syncedCharacters} 张角色卡的玩家名`
        : `已改名为「${next}」`);
      setRenaming(null);
      setRenameTo('');
      loadUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleUpdateTitle = async (userId, newTitle) => {
    try {
      await apiPut(`/api/admin/users/${userId}/title`, { title: newTitle });
      showToast(`已授予头衔：${newTitle}`);
      loadUsers();
    } catch (err) { showToast(err.message, 'error'); }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in">
      <button type="button" onClick={() => setView('profile')} className="text-slate-400 hover:text-emerald-400 flex items-center">
        ← 返回个人中心
      </button>

      <Panel className="p-8">
        <SectionTitle
          icon={Users}
          title="用户账号管理与成就授予"
          desc="新账号一律由 KP 发放；口令以哈希形式保存，管理员也无法查看原文。"
          right={<Button variant="ghost" onClick={loadUsers}><RefreshCw className="w-4 h-4" />刷新</Button>}
        />

        <form onSubmit={handleCreateUser} className="grid sm:grid-cols-[1fr_1fr_auto] gap-4 my-8 p-6 bg-slate-950/50 rounded-xl border border-slate-800/50">
          <Field label="新用户名">
            <Input required value={newUsername} onChange={(e) => setNewUsername(e.target.value)} maxLength={24} />
          </Field>
          <Field label="初始密码" hint="≥6 位">
            <Input required type="text" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} maxLength={128} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={busy}><UserPlus className="w-4 h-4" />发放新账号</Button>
          </div>
        </form>

        {issued && (
          <div className="mb-6 p-4 rounded-xl border border-amber-500/40 bg-amber-500/5">
            <p className="text-amber-400 font-bold text-sm mb-2">新口令（只显示这一次，请立即抄送本人）</p>
            <div className="flex items-center gap-3">
              <code className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-emerald-400 font-mono">
                {issued.username} / {issued.password}
              </code>
              <Button
                variant="ghost"
                onClick={() => {
                  navigator.clipboard?.writeText(`${issued.username} / ${issued.password}`)
                    .then(() => showToast('已复制到剪贴板'))
                    .catch(() => showToast('复制失败，请手动选择复制', 'error'));
                }}
              >
                <Copy className="w-4 h-4" />复制
              </Button>
              <Button variant="ghost" onClick={() => setIssued(null)}>知道了</Button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-slate-950 text-slate-400 text-sm border-b border-slate-800">
                <th className="p-4">用户名</th>
                <th className="p-4">权限角色</th>
                <th className="p-4">荣誉头衔（显示在证书）</th>
                <th className="p-4 text-center">角色卡</th>
                <th className="p-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-800/50 hover:bg-slate-800/40 transition">
                  <td className="p-4 text-white font-medium">
                    <span className="flex items-center gap-2">
                      {u.role === 'admin' ? <Crown className="w-4 h-4 text-amber-500" /> : <UserIcon className="w-4 h-4 text-slate-500" />}
                      {u.username}
                      {u.mustChangePassword ? <Badge tone="red">弱口令待改</Badge> : null}
                    </span>
                  </td>
                  <td className="p-4 text-slate-400 text-sm">{u.role === 'admin' ? '管理员 (KP)' : '调查员'}</td>
                  <td className="p-4">
                    {u.role === 'admin' ? (
                      <span className="text-amber-500 text-sm font-bold tracking-widest drop-shadow-[0_0_5px_rgba(245,158,11,0.8)]">【 首席守秘人 】</span>
                    ) : (
                      <Select
                        value={u.title || '见习调查员'}
                        onChange={(e) => handleUpdateTitle(u.id, e.target.value)}
                        className="!py-1.5 !w-auto text-sm"
                      >
                        {TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </Select>
                    )}
                  </td>
                  <td className="p-4 text-center">
                    <Badge tone={u.characterCount ? 'emerald' : 'slate'}>{u.characterCount || 0}</Badge>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setRenaming({ id: u.id, username: u.username }); setRenameTo(u.username); }}
                        className="text-sm px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
                      >
                        改名
                      </button>
                      <button type="button" onClick={() => handleResetPwd(u.id, u.username)} className="text-sm px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg transition">
                        重置密码
                      </button>
                      {u.role !== 'admin' && (
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(u.id, u.username, u.characterCount || 0)}
                          className="text-sm px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Modal open={Boolean(renaming)} onClose={() => setRenaming(null)} title="修改用户名">
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              把 <b className="text-white">{renaming?.username}</b> 改成：
            </p>
            <Field label="新用户名" hint="2-24 位，支持中文、字母、数字、_ . -">
              <Input value={renameTo} maxLength={24} onChange={(e) => setRenameTo(e.target.value)} autoFocus />
            </Field>
            <p className="text-xs text-slate-500 leading-relaxed">
              改名后该用户下次登录要用新名字；系统会把「玩家名正好等于旧用户名」的角色卡一并改名。
              带团记录、证书签名等历史文本不会被追溯修改。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRenaming(null)}>取消</Button>
              <Button onClick={handleRename} disabled={!renameTo.trim()}>确认改名</Button>
            </div>
          </div>
        </Modal>

        <div className={cx('mt-4 text-xs text-slate-500 flex items-center gap-2')}>
          <Shield className="w-3.5 h-3.5" />
          管理员可以管理账号，但无法读取任何人的原始密码（数据库中只保存 scrypt 哈希）。
        </div>
      </Panel>
    </div>
  );
}
