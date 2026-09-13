import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, BookOpen, BrainCircuit, Calendar, CheckCircle, CheckSquare, Copy, Crown,
  ClipboardCheck, Edit, FileText, Filter, FolderArchive, Info, Layers, LayoutDashboard, LayoutGrid,
  ListChecks, Lock, LogOut, Pin, Plus, Search, Settings, Share2, Shield, Trash2, User, Users, X,
} from 'lucide-react';

import { ApiError, apiDelete, apiGet, apiPost, apiPut, session } from './lib/api.js';
import {
  Badge, Button, ConfirmDialog, EmptyState, Field, Input, Panel, Select, Textarea, Toast, cx,
} from './components/ui.jsx';
import PasswordChangeForm from './components/PasswordChangeForm.jsx';
import AdminUsersPanel from './components/AdminUsersPanel.jsx';
import KpDashboardPanel from './components/KpDashboardPanel.jsx';
import CertificatePreview from './components/CertificatePreview.jsx';
import CharacterList from './components/characters/CharacterList.jsx';
import CharacterEditor from './components/characters/CharacterEditor.jsx';
import CharacterDetail from './components/characters/CharacterDetail.jsx';
import CharacterPrintView from './components/CharacterPrintView.jsx';
import KpReviewCenter from './components/characters/KpReviewCenter.jsx';
import { ExportCardModal } from './components/characters/CardTransferModal.jsx';
import { getGuestSheet, saveGuestSheet, deleteGuestSheet } from './lib/guestStore.js';
import { computeSheet } from '../shared/coc7e.js';
import AuthView from './views/AuthView.jsx';
import HomeView from './views/HomeView.jsx';
import ModuleDetailView from './views/ModuleDetailView.jsx';
import ModuleFormView from './views/ModuleFormView.jsx';
import ProfileView from './views/ProfileView.jsx';

const EMPTY_MODULE = {
  title: '', region: '', era: '1920s', players: '', duration: '', description: '',
  series: '', charInfo: '', occupations: '', skills: '', notes: '', isPinned: false,
};

/** 头衔特效（与证书导出版面保持一致） */
const getTitleStyles = (title, role) => {
  if (role === 'admin') {
    return 'text-transparent bg-clip-text bg-gradient-to-b from-yellow-200 via-amber-400 to-orange-600 font-black drop-shadow-[0_0_15px_rgba(245,158,11,1)] tracking-[0.4em] scale-105 inline-block';
  }
  switch (title) {
    case '资深调查员': return 'text-cyan-400 font-bold drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]';
    case '精英调查员': return 'text-amber-400 font-black drop-shadow-[0_0_8px_rgba(251,191,36,0.6)] tracking-widest';
    case '传奇调查员': return 'text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-yellow-500 to-purple-500 font-black drop-shadow-[0_0_10px_rgba(239,68,68,0.8)] tracking-[0.2em]';
    case '神话调查员': return 'text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-500 via-cyan-400 to-emerald-400 font-black drop-shadow-[0_0_12px_rgba(217,70,239,0.8)] tracking-[0.3em]';
    default: return 'text-slate-400 font-medium';
  }
};

export default function App() {
  // ------------------------------------------------------------ 全局状态
  const [modules, setModules] = useState([]);
  const [playedModules, setPlayedModules] = useState([]);
  const [currentUser, setCurrentUser] = useState(() => session.user);
  const [users, setUsers] = useState([]);
  const [view, setView] = useState('home');
  const [viewArg, setViewArg] = useState(null);
  const [selectedModule, setSelectedModule] = useState(null);

  const [homeTab, setHomeTab] = useState('grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRegion, setFilterRegion] = useState('');
  const [filterPlayers, setFilterPlayers] = useState('');
  const [filterDuration, setFilterDuration] = useState('');
  const [filterPlayed, setFilterPlayed] = useState('');
  const [selectedCollection, setSelectedCollection] = useState(null);

  const [isLoginMode, setIsLoginMode] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [formData, setFormData] = useState(EMPTY_MODULE);
  const [isEditing, setIsEditing] = useState(false);

  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const [kpName, setKpName] = useState('档案馆首席 KP');
  const [previewMode, setPreviewMode] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [characterRefresh, setCharacterRefresh] = useState(0);
  const [customOccupations, setCustomOccupations] = useState([]);
  const [guestSheet, setGuestSheet] = useState(null);
  const [viewFrom, setViewFrom] = useState(null);

  const isAdmin = currentUser?.role === 'admin';

  const showToast = useCallback((msg, type = 'success') => setToast({ msg, type, id: Date.now() }), []);
  const showConfirm = useCallback((msg, onConfirm, opts = {}) => setConfirmDialog({ msg, onConfirm, ...opts }), []);
  const go = useCallback((nextView, arg = null) => {
    setView((prev) => { setViewFrom(prev); return nextView; });
    setViewArg(arg);
    window.scrollTo(0, 0);
  }, []);

  // ------------------------------------------------------------ 数据获取
  const fetchModules = useCallback(async () => {
    try {
      setModules(await apiGet('/api/modules', { auth: false }));
    } catch (err) { showToast(err.message, 'error'); }
  }, [showToast]);

  const fetchPlayedRecords = useCallback(async () => {
    try {
      const list = await apiGet('/api/played');
      setPlayedModules(list.map((r) => r.moduleId));
    } catch { /* 未登录时静默 */ }
  }, []);

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return setUsers([]);
    try { setUsers(await apiGet('/api/admin/users')); } catch { /* ignore */ }
  }, [isAdmin]);

  const fetchCharacterMeta = useCallback(async () => {
    try {
      const m = await apiGet('/api/characters/meta', { auth: Boolean(session.token) });
      setCustomOccupations(m.customOccupations || []);
    } catch { /* 元数据失败不影响主流程 */ }
  }, []);

  const fetchKpName = useCallback(async () => {
    try {
      const data = await apiGet('/api/kp-name', { auth: false });
      if (data.kpName) setKpName(data.kpName);
    } catch { /* ignore */ }
  }, []);

  // 启动：校验收据 + 拉取最新用户信息（含头衔）
  useEffect(() => {
    const init = async () => {
      if (session.token) {
        try {
          const fresh = await apiGet('/api/user/me');
          setCurrentUser(fresh);
          session.saveUser(fresh);
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            session.clear();
            setCurrentUser(null);
          }
        }
      }
      fetchModules();
    };
    init();
  }, [fetchModules]);

  useEffect(() => {
    if (currentUser) fetchPlayedRecords();
    else setPlayedModules([]);
  }, [currentUser, fetchPlayedRecords]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { fetchCharacterMeta(); }, [fetchCharacterMeta]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [toast]);

  useEffect(() => {
    if (currentUser) {
      if (isAdmin) setKpName(currentUser.username);
      else fetchKpName();
    }
  }, [currentUser, isAdmin, fetchKpName]);

  // 令牌失效（过期/改密/被轮换）时统一回到登录页
  useEffect(() => {
    const onUnauthorized = (e) => {
      setCurrentUser(null);
      session.clear();
      showToast(e.detail?.reason || '登录状态已失效', 'error');
      go('auth');
    };
    window.addEventListener('coc:unauthorized', onUnauthorized);
    return () => window.removeEventListener('coc:unauthorized', onUnauthorized);
  }, [go, showToast]);

  // ------------------------------------------------------------ 认证
  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const data = await apiPost(
        isLoginMode ? '/api/login' : '/api/register',
        { username, password },
        { auth: false },
      );
      session.save(data.token, data.user);
      setCurrentUser(data.user);
      setUsername(''); setPassword('');
      showToast(isLoginMode ? '欢迎回来' : '注册成功');
      go('home');
      if (data.user?.mustChangePassword) {
        showToast('当前密码强度不足，建议尽快到个人中心修改', 'error');
      }
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleLogout = async () => {
    try { await apiPost('/api/logout', {}); } catch { /* 即便失败也清理本地 */ }
    session.clear();
    setCurrentUser(null);
    setFilterPlayed('');
    go('home');
    showToast('已登出');
  };

  // ------------------------------------------------------------ 模组
  const handleSubmitModule = async (e) => {
    e.preventDefault();
    if (!isAdmin) return;
    try {
      const saved = isEditing
        ? await apiPut(`/api/modules/${formData.id}`, formData)
        : await apiPost('/api/modules', formData);
      await fetchModules();
      showToast(isEditing ? '更新成功' : '发布成功');
      if (isEditing) { setSelectedModule(saved); go('moduleDetail'); } else { go('home'); }
      setFormData(EMPTY_MODULE);
      setIsEditing(false);
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleDeleteModule = (moduleId, e) => {
    e?.stopPropagation();
    if (!isAdmin) return;
    showConfirm('永久删除该模组？', async () => {
      try {
        await apiDelete(`/api/modules/${moduleId}`);
        await fetchModules();
        showToast('已删除');
        if (selectedModule?.id === moduleId) go('home');
      } catch (err) { showToast(err.message, 'error'); }
    }, { detail: '该模组下的带团记录、已跑标记与角色卡经历关联都会一并清除。' });
  };

  const togglePlayed = async (moduleId, e) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!currentUser) return go('auth');
    try {
      const res = await apiPost('/api/played', { moduleId });
      setPlayedModules((prev) => (res.played
        ? [...new Set([...prev, moduleId])]
        : prev.filter((id) => id !== moduleId)));
    } catch (err) { showToast(err.message, 'error'); }
  };

  const openEditMode = (module, e) => {
    e?.stopPropagation();
    setFormData({ ...EMPTY_MODULE, ...module });
    setIsEditing(true);
    go('moduleForm');
  };

  const handleCopy = async (mod) => {
    const text = `《${mod.title}》\n人数：${mod.players}人\n时长：${mod.duration}小时\n时代：${mod.region || ''} ${mod.era}\n背景：${mod.description}\n`
      + `${mod.charInfo ? `车卡要求：${mod.charInfo}\n` : ''}${mod.occupations ? `推荐职业：${mod.occupations}\n` : ''}`
      + `${mod.skills ? `推荐技能：${mod.skills}\n` : ''}${mod.notes ? `注意：${mod.notes}` : ''}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制到剪贴板！');
    } catch {
      // 退回到旧 API（部分浏览器非安全上下文不支持 clipboard）
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('已复制到剪贴板！');
      } catch { showToast('复制失败，请手动选择复制', 'error'); }
    }
  };

  // ------------------------------------------------------------ 派生数据
  const uniqueSeries = useMemo(() => [...new Set(modules.map((m) => m.series).filter(Boolean))], [modules]);
  const uniqueRegions = useMemo(() => [...new Set(modules.map((m) => m.region).filter(Boolean))], [modules]);
  const uniquePlayers = useMemo(() => [...new Set(modules.map((m) => m.players).filter(Boolean))], [modules]);
  const uniqueDurations = useMemo(() => [...new Set(modules.map((m) => m.duration).filter(Boolean))], [modules]);

  const filteredModules = useMemo(() => {
    let list = modules;
    if (selectedCollection) return list.filter((m) => m.series === selectedCollection);
    if (searchTerm) {
      const kw = searchTerm.toLowerCase();
      list = list.filter((m) => m.title.toLowerCase().includes(kw) || m.series?.toLowerCase().includes(kw));
    }
    if (filterRegion) list = list.filter((m) => m.region === filterRegion);
    if (filterPlayers) list = list.filter((m) => m.players === filterPlayers);
    if (filterDuration) list = list.filter((m) => m.duration === filterDuration);
    if (filterPlayed === 'played') list = list.filter((m) => playedModules.includes(m.id));
    if (filterPlayed === 'unplayed') list = list.filter((m) => !playedModules.includes(m.id));
    return list;
  }, [modules, selectedCollection, searchTerm, filterRegion, filterPlayers, filterDuration, filterPlayed, playedModules]);

  const handlePreview = (mode, data = null) => {
    setPreviewMode(mode);
    setPreviewData(data);
    window.scrollTo(0, 0);
  };

  // ------------------------------------------------------------ 长图预览独立成页
  if (previewMode) {
    return (
      <CertificatePreview
        previewMode={previewMode}
        previewData={previewData}
        currentUser={currentUser}
        kpName={kpName}
        playedModules={playedModules}
        modules={modules}
        toast={toast}
        showToast={showToast}
        onClose={() => { setPreviewMode(null); setPreviewData(null); }}
      />
    );
  }

  // ------------------------------------------------------------ 角色卡视图
  const renderCharacterView = () => {
    if (view === 'characters') {
      // 未登录 = 访客模式：数据只在本机浏览器里
      if (!currentUser) {
        return (
          <CharacterList
            key={`guest-${characterRefresh}`}
            mode="guest"
            currentUser={null}
            showToast={showToast}
            showConfirm={showConfirm}
            onOpen={(item) => go('characterView', item.id)}
            onEdit={(item) => { setGuestSheet(item ? getGuestSheet(item.id) : null); go('characterEdit', null); }}
            onPrint={(item) => go('characterPrint', item.id)}
          />
        );
      }
      return (
        <CharacterList
          key={`mine-${characterRefresh}`}
          mode="mine"
          currentUser={currentUser}
          showToast={showToast}
          showConfirm={showConfirm}
          onOpen={(item) => go('characterView', item.id)}
          onEdit={(item) => go('characterEdit', item ? item.id : null)}
          onPrint={(item) => go('characterPrint', item.id)}
        />
      );
    }
    if (view === 'kpCharacters' && isAdmin) {
      return (
        <CharacterList
          key={`kp-${characterRefresh}`}
          mode="kp"
          currentUser={currentUser}
          showToast={showToast}
          showConfirm={showConfirm}
          onOpen={(item) => go('characterView', item.id)}
          onEdit={(item) => go('characterEdit', item.id)}
          onPrint={(item) => go('characterPrint', item.id)}
        />
      );
    }
    if (view === 'characterEdit') {
      const guest = !currentUser;
      return (
        <CharacterEditor
          key={guest ? (guestSheet?.id || 'guest-new') : (viewArg || 'new')}
          characterId={guest ? null : viewArg}
          guest={guest}
          initialSheet={guest ? guestSheet : null}
          currentUser={currentUser}
          owners={users}
          customOccupations={customOccupations}
          showToast={showToast}
          showConfirm={showConfirm}
          loadCharacter={!guest && viewArg ? () => apiGet(`/api/characters/${viewArg}`) : null}
          onGuestSave={(payload, id) => {
            try {
              const rec = saveGuestSheet(id ? { ...payload, id } : payload);
              setGuestSheet(rec);
              setCharacterRefresh((n) => n + 1);
              go('characterPrint', rec.id);
            } catch (err) { showToast(err.message, 'error'); }
          }}
          onSaved={(saved) => { setCharacterRefresh((n) => n + 1); go('characterView', saved.id); }}
          onCancel={() => go('characters')}
        />
      );
    }
    if (view === 'characterView') {
      // 访客草稿：不走服务端
      if (!currentUser) {
        const g = getGuestSheet(viewArg);
        if (!g) {
          return (
            <Panel>
              <EmptyState
                title="本机没有这张草稿"
                desc="可能已被清理或换了一台设备，返回列表重新创建即可。"
                action={<Button onClick={() => go('characters')}>返回列表</Button>}
              />
            </Panel>
          );
        }
        return (
          <GuestSheetView
            sheet={g}
            showToast={showToast}
            onBack={() => go('characters')}
            onEdit={() => { setGuestSheet(g); go('characterEdit', null); }}
            onPrint={() => go('characterPrint', g.id)}
            onDelete={() => showConfirm('删除这张本机草稿？', () => {
              deleteGuestSheet(g.id);
              setCharacterRefresh((n) => n + 1);
              go('characters');
            })}
            onLogin={() => go('auth')}
          />
        );
      }
      return (
        <CharacterDetail
          characterId={viewArg}
          currentUser={currentUser}
          showToast={showToast}
          showConfirm={showConfirm}
          onBack={() => go(viewFrom === 'kpReview' ? 'kpReview' : 'characters')}
          onEdit={(c) => go('characterEdit', c.id)}
          onPrint={(c) => go('characterPrint', c.id)}
          onChanged={() => setCharacterRefresh((n) => n + 1)}
        />
      );
    }
    if (view === 'characterPrint') {
      const guestRec = currentUser ? null : getGuestSheet(viewArg);
      return (
        <CharacterPrintView
          characterId={guestRec ? null : viewArg}
          character={guestRec}
          customOccupations={customOccupations}
          showToast={showToast}
          onBack={() => go('characterView', viewArg)}
          onEdit={guestRec
            ? () => { setGuestSheet(guestRec); go('characterEdit', null); }
            : (c) => go('characterEdit', c.id)}
        />
      );
    }
    return null;
  };

  // ------------------------------------------------------------ 主渲染
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-emerald-500/30 pb-20">
      <style dangerouslySetInnerHTML={{
        __html: `
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: #020617; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #475569; }
      `,
      }} />

      <Toast toast={toast} />
      <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />

      <nav className="bg-slate-900/80 backdrop-blur-md border-b border-slate-800 sticky top-0 z-50 no-print">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <button
              type="button"
              className="flex items-center space-x-2 group"
              onClick={() => { go('home'); setHomeTab('grid'); setSelectedCollection(null); }}
            >
              <BookOpen className="h-6 w-6 text-emerald-500 group-hover:text-emerald-400 transition" />
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400 hidden sm:inline">秘密调查档案馆</span>
            </button>
            <div className="flex items-center space-x-1 sm:space-x-2">
              {!currentUser ? (
                <div className="flex items-center gap-2">
                  <NavButton active={view === 'characters'} onClick={() => go('characters')} icon={Users} label="免费车卡" />
                  <Button onClick={() => go('auth')} className="!py-2"><User className="h-4 w-4" />登录身份</Button>
                </div>
              ) : (
                <>
                  <div className="hidden md:flex items-center space-x-1 mr-1 border-r border-slate-700 pr-3">
                    <NavButton active={view === 'characters'} onClick={() => go('characters')} icon={Users} label="我的角色卡" />
                    {isAdmin && (
                      <>
                        <NavButton active={view === 'moduleForm'} onClick={() => { setFormData(EMPTY_MODULE); setIsEditing(false); go('moduleForm'); }} icon={Plus} label="发布模组" tone="emerald" />
                        <NavButton active={view === 'kpDashboard'} onClick={() => go('kpDashboard')} icon={LayoutDashboard} label="KP 控制台" tone="amber" />
                        <NavButton active={view === 'kpCharacters'} onClick={() => go('kpCharacters')} icon={Shield} label="角色卡管理" tone="amber" />
                        <NavButton active={view === 'kpReview'} onClick={() => go('kpReview')} icon={ClipboardCheck} label="审卡中心" tone="amber" />
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => go('profile')}
                    className={cx('flex items-center space-x-2 px-3 py-2 rounded-md transition', view === 'profile' ? 'bg-slate-800 text-emerald-400' : 'hover:bg-slate-800 text-slate-300')}
                  >
                    {isAdmin ? <Crown className="h-4 w-4 text-amber-500" /> : <Shield className="h-4 w-4" />}
                    <span className="truncate font-bold max-w-[7rem]">{currentUser.username}</span>
                  </button>
                  <button type="button" onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-md" title="登出">
                    <LogOut className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
          </div>
          {/* 移动端导航 */}
          {currentUser && (
            <div className="md:hidden flex gap-1 pb-2 overflow-x-auto">
              <NavButton active={view === 'characters'} onClick={() => go('characters')} icon={Users} label="我的角色卡" />
              {isAdmin && <NavButton active={view === 'kpCharacters'} onClick={() => go('kpCharacters')} icon={Shield} label="角色卡管理" tone="amber" />}
              {isAdmin && <NavButton active={view === 'kpReview'} onClick={() => go('kpReview')} icon={ClipboardCheck} label="审卡中心" tone="amber" />}
              {isAdmin && <NavButton active={view === 'moduleForm'} onClick={() => { setFormData(EMPTY_MODULE); setIsEditing(false); go('moduleForm'); }} icon={Plus} label="发布模组" tone="emerald" />}
              {isAdmin && <NavButton active={view === 'kpDashboard'} onClick={() => go('kpDashboard')} icon={LayoutDashboard} label="KP 控制台" tone="amber" />}
            </div>
          )}
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ---------------------------------------------------- 登录 / 初始化 */}
        {view === 'auth' && (
          <AuthView
            isLoginMode={isLoginMode}
            setIsLoginMode={setIsLoginMode}
            username={username}
            setUsername={setUsername}
            password={password}
            setPassword={setPassword}
            authError={authError}
            setAuthError={setAuthError}
            onSubmit={handleAuth}
          />
        )}

        {/* ---------------------------------------------------- 模组录入 / 编辑 */}
        {view === 'moduleForm' && isAdmin && (
          <ModuleFormView
            isEditing={isEditing}
            formData={formData}
            setFormData={setFormData}
            uniqueSeries={uniqueSeries}
            onSubmit={handleSubmitModule}
            onBack={() => { go('home'); setFormData(EMPTY_MODULE); }}
          />
        )}

        {/* ---------------------------------------------------- 管理面板 */}
        {view === 'adminUsers' && isAdmin && (
          <AdminUsersPanel setView={(v) => go(v)} showToast={showToast} showConfirm={showConfirm} />
        )}
        {view === 'kpDashboard' && isAdmin && (
          <KpDashboardPanel
            modules={modules}
            users={users}
            showToast={showToast}
            showConfirm={showConfirm}
            handlePreview={handlePreview}
          />
        )}

        {/* ---------------------------------------------------- 角色卡 */}
        {['characters', 'kpCharacters', 'characterEdit', 'characterView', 'characterPrint'].includes(view) && renderCharacterView()}

        {view === 'kpReview' && isAdmin && (
          <KpReviewCenter
            currentUser={currentUser}
            showToast={showToast}
            showConfirm={showConfirm}
            onOpenCharacter={(id) => go('characterView', id)}
          />
        )}

        {/* ---------------------------------------------------- 首页 */}
        {view === 'home' && (
          <HomeView
            modules={modules}
            currentUser={currentUser}
            playedModules={playedModules}
            isAdmin={isAdmin}
            homeTab={homeTab}
            setHomeTab={setHomeTab}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            filterRegion={filterRegion}
            setFilterRegion={setFilterRegion}
            filterPlayers={filterPlayers}
            setFilterPlayers={setFilterPlayers}
            filterDuration={filterDuration}
            setFilterDuration={setFilterDuration}
            filterPlayed={filterPlayed}
            setFilterPlayed={setFilterPlayed}
            selectedCollection={selectedCollection}
            setSelectedCollection={setSelectedCollection}
            uniqueSeries={uniqueSeries}
            uniqueRegions={uniqueRegions}
            uniquePlayers={uniquePlayers}
            uniqueDurations={uniqueDurations}
            filteredModules={filteredModules}
            onGoAuth={() => go('auth')}
            onGoCharacters={() => go('characters')}
            onOpenModule={(m) => { setSelectedModule(m); go('moduleDetail'); }}
            onEditModule={openEditMode}
            onDeleteModule={handleDeleteModule}
            onTogglePlayed={togglePlayed}
          />
        )}

        {/* ---------------------------------------------------- 模组详情 */}
        {view === 'moduleDetail' && selectedModule && (
          <ModuleDetailView
            module={selectedModule}
            isAdmin={isAdmin}
            currentUser={currentUser}
            played={playedModules.includes(selectedModule.id)}
            onBack={() => go('home')}
            onCopy={handleCopy}
            onEdit={openEditMode}
            onTogglePlayed={togglePlayed}
            onGoCharacters={() => go('characters')}
          />
        )}

        {/* ---------------------------------------------------- 个人中心 */}
        {view === 'profile' && currentUser && (
          <ProfileView
            currentUser={currentUser}
            isAdmin={isAdmin}
            modules={modules}
            playedModules={playedModules}
            getTitleStyles={getTitleStyles}
            showToast={showToast}
            onTogglePlayed={togglePlayed}
            onPreviewCertificate={() => handlePreview('player')}
            onGo={go}
            onLogout={handleLogout}
            onRenamed={(fresh) => { setCurrentUser(fresh); session.saveUser(fresh); }}
          />
        )}
      </main>
    </div>
  );
}

/** 访客本机草稿的只读预览（不经过服务端） */
function GuestSheetView({ sheet, onBack, onEdit, onPrint, onDelete, onLogin, showToast }) {
  const d = computeSheet(sheet, {});
  const used = d.skills.filter((s) => s.used || s.occ > 0 || s.interest > 0 || s.growth > 0);
  const [exportOpen, setExportOpen] = useState(false);
  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <Button variant="ghost" onClick={onBack} className="!p-2.5">←</Button>
            <div>
              <h2 className="text-3xl font-black text-white flex items-center gap-3 flex-wrap">
                {sheet.name || '未命名调查员'}
                <Badge tone="amber">本机草稿</Badge>
              </h2>
              <p className="text-slate-400 text-sm mt-1">
                {d.occupation?.name || '无职业'} · {sheet.age} 岁 · {sheet.era}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" onClick={() => setExportOpen(true)}><Share2 className="w-4 h-4" />导出编码 / 骰娘指令</Button>
            <Button variant="ghost" onClick={onPrint}><FileText className="w-4 h-4" />打印 / 导出 PDF</Button>
            <Button variant="ghost" onClick={onEdit}>编辑</Button>
            <Button onClick={onLogin}><User className="w-4 h-4" />登录后收录</Button>
            <Button variant="danger" onClick={onDelete}><Trash2 className="w-4 h-4" />删除</Button>
          </div>
        </div>
        <p className="mt-4 text-xs text-amber-300/80">
          这张卡只保存在本机浏览器，没有收录进档案馆：不能关联模组经历，也不会出现在 KP 的角色卡管理里。
        </p>
        <p className="mt-2 text-xs text-slate-500">
          教育增强记录：
          {d.eduGrowth.settled ? (
            <span className="text-slate-300">
              {d.eduGrowth.manual ? '手动录入' : `自动检定 ${d.eduGrowth.count} 次`}
              ，提升 <b className="font-mono text-cyan-300">+{d.eduGrowth.gain}</b>
              {d.eduGrowth.rolls?.length ? ` · 骰点 ${d.eduGrowth.rolls.map((r) => `D100=${r.roll}→+${r.gain}`).join('、')}` : ''}
            </span>
          ) : <span className="text-amber-400">尚未结算</span>}
        </p>
        {d.legendary.enabled ? (
          <p className="mt-1 text-xs text-fuchsia-300">KP 已开启传奇标记（额外调整值单独一栏）。</p>
        ) : null}
      </Panel>

      <Panel className="p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[['生命值 HP', d.hp], ['魔法点 MP', d.mp], ['理智 SAN', d.san], ['移动力 MOV', d.mov],
            ['伤害加值', d.db], ['体格', d.build], ['信用评级', `${d.creditRating}%`]].map(([l, v]) => (
            <div key={l} className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-center">
              <div className="text-[11px] text-slate-500 mb-0.5">{l}</div>
              <div className="text-xl font-black text-emerald-400 font-mono">{v}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="p-5">
        <h3 className="font-bold text-white mb-4">技能（{used.length}）</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-slate-950 text-slate-400 text-xs">
              <tr>
                <th className="p-3 text-left">技能</th>
                <th className="p-3 w-20 text-center">基础</th>
                <th className="p-3 w-20 text-center">职业</th>
                <th className="p-3 w-20 text-center">兴趣</th>
                <th className="p-3 w-24 text-center">成功率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {used.map((s) => (
                <tr key={s.id}>
                  <td className="p-3 text-slate-200">
                    {s.isOccupation ? <span className="text-emerald-500 mr-1.5">★</span> : <span className="text-slate-700 mr-1.5">·</span>}
                    {s.name}
                  </td>
                  <td className="p-3 text-center font-mono text-slate-500">{s.base}</td>
                  <td className="p-3 text-center font-mono text-slate-300">{s.occ || '-'}</td>
                  <td className="p-3 text-center font-mono text-slate-300">{s.interest || '-'}</td>
                  <td className="p-3 text-center font-mono font-black text-emerald-400">{s.total}%</td>
                </tr>
              ))}
              {used.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-500">还没有分配技能点</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="font-bold text-white">备注</h3>
          <span className="text-[11px] text-slate-500">只做记录，不会出现在骰娘指令与打印件上</span>
        </div>
        <p className="text-sm text-slate-300 whitespace-pre-wrap bg-slate-950 border border-slate-800 rounded-xl p-3">
          {sheet.notes || <span className="text-slate-600">—</span>}
        </p>
      </Panel>

      <ExportCardModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        character={sheet}
        onToast={showToast}
      />
    </div>
  );
}

/** 顶部导航按钮 */
function NavButton({ active, onClick, icon: Icon, label, tone = 'emerald' }) {
  const tones = {
    emerald: active ? 'bg-slate-800 text-emerald-400' : 'text-emerald-400/80 hover:bg-slate-800',
    amber: active ? 'bg-slate-800 text-amber-400' : 'text-amber-500/70 hover:bg-slate-800',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('flex items-center space-x-2 px-3 py-2 rounded-md font-medium whitespace-nowrap transition', tones[tone])}
    >
      <Icon className="h-4 w-4" /><span>{label}</span>
    </button>
  );
}
