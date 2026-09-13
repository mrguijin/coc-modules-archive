/**
 * 个人中心
 * 从 App.jsx 抽出的视图组件；只通过 props 接收数据与回调，不直接发请求。
 */
import React from 'react';
import {
  AlertCircle, CheckSquare, Crown, FileText, Settings, User, Users,
} from 'lucide-react';
import { Button } from '../components/ui.jsx';
import PasswordChangeForm from '../components/PasswordChangeForm.jsx';
import AccountRenameCard from '../components/AccountRenameCard.jsx';

export default function ProfileView({ currentUser, isAdmin, modules, playedModules, onTogglePlayed, onPreviewCertificate, onGo, showToast, onLogout, getTitleStyles , onRenamed }) {
  return (
  <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in">
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 shadow-xl">
      <div className="flex items-center space-x-6">
        <div className="h-20 w-20 bg-emerald-900/30 text-emerald-400 rounded-2xl flex items-center justify-center border border-emerald-500/20 shrink-0">
          {isAdmin ? <Crown className="h-10 w-10 text-amber-500" /> : <User className="h-10 w-10" />}
        </div>
        <div>
          <h2 className="text-3xl font-black text-white">{currentUser.username}</h2>
          <div className="mt-2">
            <span className={getTitleStyles(currentUser?.title || '见习调查员', currentUser?.role)}>
              『 {isAdmin ? '首席守秘人' : (currentUser?.title || '见习调查员')} 』
            </span>
          </div>
          {currentUser.mustChangePassword && (
            <p className="mt-2 text-xs text-amber-400 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />当前密码强度不足，请尽快修改
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 w-full md:w-auto">
        <Button variant="ghost" onClick={() => onGo('characters')}><Users className="w-4 h-4" />我的角色卡</Button>
        <Button variant="ghost" onClick={onPreviewCertificate}><FileText className="w-4 h-4" />预览并下载证书</Button>
        {isAdmin && <Button variant="ghost" onClick={() => onGo('adminUsers')}><Settings className="w-4 h-4" />账号管理</Button>}
      </div>
    </div>

    <div className="flex flex-col gap-8">
      <AccountRenameCard currentUser={currentUser} showToast={showToast} onRenamed={onRenamed} />

      <PasswordChangeForm showToast={showToast} onChanged={onLogout} />

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
        <h3 className="text-xl font-bold text-slate-200 mb-6 flex items-center">
          <CheckSquare className="mr-2 text-emerald-500" /> 已调查案件 ({playedModules.length})
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {modules.filter((m) => playedModules.includes(m.id)).map((m) => (
            <div key={m.id} className="flex justify-between items-center p-4 bg-slate-950 rounded-xl border border-slate-800">
              <div className="flex items-center space-x-4 overflow-hidden">
                <div className={`w-3 h-12 rounded bg-gradient-to-b ${m.themeColor}`} />
                <div className="truncate">
                  <span className="text-slate-200 font-bold block truncate">{m.title}</span>
                  <span className="text-slate-500 text-sm">{m.region} <span className="text-emerald-400">{m.era}</span></span>
                </div>
              </div>
              <button type="button" onClick={(e) => onTogglePlayed(m.id, e)} className="text-red-400 text-sm px-3 py-2 bg-red-500/10 rounded-lg ml-2">撤销</button>
            </div>
          ))}
          {playedModules.length === 0 && <p className="text-slate-500 text-sm">还没有归档任何案件。</p>}
        </div>
      </div>
    </div>
  </div>
  );
}
