/**
 * 守秘人控制台：录入带团记录 + 全模组带团盘点 + 导出长图。
 *
 * 与旧实现的关键差异：
 *  - 录入记录时用 **模组 id** 关联（旧实现用模组标题字符串匹配，重名模组会串数据）。
 *  - 所有请求走统一 API 客户端，删除/新增后不再直接改动 state 数组的排序。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CheckCircle, Image as ImageIcon, LayoutDashboard, NotebookPen, Search, X,
} from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '../lib/api.js';
import { Button, Combobox, EmptyState, Field, Input, Panel, SectionTitle, Select, cx } from './ui.jsx';

export default function KpDashboardPanel({ modules, showToast, showConfirm, handlePreview, users = [] }) {
  const [sessions, setSessions] = useState([]);
  const [kpTab, setKpTab] = useState('history');
  const [overviewFilter, setOverviewFilter] = useState('all');
  const [form, setForm] = useState({ moduleId: '', date: '', duration: '', investigators: [] });
  const [moduleQuery, setModuleQuery] = useState('');
  const [playerSearch, setPlayerSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const fetchSessions = useCallback(async () => {
    try { setSessions(await apiGet('/api/sessions')); } catch (err) { showToast(err.message, 'error'); }
  }, [showToast]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const filteredModuleOptions = useMemo(() => {
    const q = moduleQuery.trim().toLowerCase();
    if (!q) return modules;
    return modules.filter((m) => m.title.toLowerCase().includes(q) || (m.series || '').toLowerCase().includes(q));
  }, [modules, moduleQuery]);

  const addPlayer = (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    setForm((prev) => (prev.investigators.includes(trimmed)
      ? prev
      : { ...prev, investigators: [...prev.investigators, trimmed] }));
    setPlayerSearch('');
  };
  const removePlayer = (name) => setForm((prev) => ({ ...prev, investigators: prev.investigators.filter((p) => p !== name) }));

  const handleAddSession = async (e) => {
    e.preventDefault();
    if (!form.moduleId) return showToast('请选择模组', 'error');
    if (form.investigators.length === 0) return showToast('请至少添加一名在车玩家', 'error');
    setBusy(true);
    try {
      await apiPost('/api/sessions', {
        moduleId: form.moduleId,
        date: form.date,
        duration: Number(form.duration),
        playerCount: form.investigators.length,
        investigators: form.investigators.join(', '),
      });
      showToast('跑团记录添加成功！');
      setForm({ moduleId: '', date: '', duration: '', investigators: [] });
      fetchSessions();
    } catch (err) {
      showToast(err.message, 'error');
    } finally { setBusy(false); }
  };

  const handleDeleteSession = (id) => showConfirm('确定删除这条带团记录吗？', async () => {
    try {
      await apiDelete(`/api/sessions/${id}`);
      showToast('记录已删除');
      fetchSessions();
    } catch (err) { showToast(err.message, 'error'); }
  });

  const totalHours = sessions.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
  const moduleStats = useMemo(() => {
    const stats = {};
    sessions.forEach((s) => {
      if (!stats[s.moduleId]) stats[s.moduleId] = { count: 0, totalDuration: 0 };
      stats[s.moduleId].count += 1;
      stats[s.moduleId].totalDuration += (Number(s.duration) || 0);
    });
    return stats;
  }, [sessions]);

  const filteredOverviewModules = useMemo(() => modules.filter((m) => {
    const count = moduleStats[m.id]?.count || 0;
    if (overviewFilter === 'unplayed') return count === 0;
    if (overviewFilter === 'played') return count > 0;
    return true;
  }).sort((a, b) => (moduleStats[b.id]?.count || 0) - (moduleStats[a.id]?.count || 0)), [modules, moduleStats, overviewFilter]);

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => new Date(b.date) - new Date(a.date)),
    [sessions],
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in">
      <SectionTitle
        icon={LayoutDashboard}
        title="守秘人控制台"
        desc="在这里记录、管理并统计你的带团生涯数据。"
      />

      <div className="flex border-b border-slate-800">
        <button type="button" onClick={() => setKpTab('history')} className={cx('px-6 py-3 font-bold transition', kpTab === 'history' ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-300')}>历史记录与分析</button>
        <button type="button" onClick={() => setKpTab('overview')} className={cx('px-6 py-3 font-bold transition', kpTab === 'overview' ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-300')}>全模组带团盘点</button>
      </div>

      {kpTab === 'history' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in">
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-4 bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl">
              <div className="text-center border-r border-slate-800">
                <div className="text-4xl font-black text-emerald-400">{sessions.length}</div>
                <div className="text-sm text-slate-500 mt-1">总带团场次</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-black text-emerald-400">{totalHours.toFixed(1)} <span className="text-lg">h</span></div>
                <div className="text-sm text-slate-500 mt-1">累计带团时长</div>
              </div>
            </div>

            <form onSubmit={handleAddSession} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <h3 className="text-lg font-bold text-slate-200 mb-6 flex items-center border-b border-slate-800 pb-3">
                <NotebookPen className="w-5 h-5 mr-2 text-emerald-500" /> 录入跑团记录
              </h3>
              <div className="space-y-5">
                <div className="space-y-2">
                  <Field label="选择模组" required hint="按 id 关联，重名也不怕">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <Input value={moduleQuery} onChange={(e) => setModuleQuery(e.target.value)} placeholder="筛选模组…" className="!pl-9 mb-2" />
                    </div>
                    <Select required value={form.moduleId} onChange={(e) => setForm({ ...form, moduleId: e.target.value })}>
                      <option value="">请选择已收录的模组…</option>
                      {filteredModuleOptions.map((m) => (
                        <option key={m.id} value={m.id}>{m.title}{m.series ? `（${m.series}）` : ''} · {m.era}</option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="日期" required>
                    <Input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={{ colorScheme: 'dark' }} />
                  </Field>
                  <Field label="用时(h)" required>
                    <Input required type="number" step="0.5" min="0.5" max="72" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="4.5" />
                  </Field>
                </div>

                <div>
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-sm text-slate-400">在车调查员 <span className="text-red-400">*</span></span>
                    <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      系统已统计: {form.investigators.length} 人
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {form.investigators.map((p) => (
                      <span key={p} className="bg-slate-800 text-slate-200 px-3 py-1 rounded-full text-sm flex items-center shadow-sm">
                        {p}
                        <button type="button" onClick={() => removePlayer(p)} className="ml-2 text-slate-400 hover:text-red-400"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                    {form.investigators.length === 0 && <span className="text-sm text-slate-600 italic">请添加玩家…</span>}
                  </div>
                  <div className="flex space-x-2">
                    <Combobox
                      className="flex-1"
                      options={users.filter((u) => !form.investigators.includes(u.username)).map((u) => u.username)}
                      value={playerSearch}
                      onChange={setPlayerSearch}
                      onPick={(name) => addPlayer(name)}
                      maxLength={40}
                      placeholder="选人 / 输入名字后回车…"
                      emptyHint="没有匹配的账号，可直接输入名字后回车"
                    />
                    <Button variant="ghost" onClick={() => addPlayer(playerSearch)}>加入</Button>
                  </div>
                </div>

                <Button type="submit" disabled={busy} className="w-full !py-3.5">{busy ? '保存中…' : '保存执导记录'}</Button>
              </div>
            </form>
          </div>

          <div className="lg:col-span-2">
            <Panel className="overflow-hidden flex flex-col h-full">
              <div className="flex justify-between items-center p-6 bg-slate-950/50 border-b border-slate-800">
                <h3 className="text-lg font-bold text-slate-200">近期详细带团记录</h3>
                <Button
                  variant="ghost"
                  className="!py-2 text-sm"
                  onClick={() => handlePreview('kp-history', { sessions, moduleStats, totalHours, modules })}
                >
                  <ImageIcon className="w-4 h-4" /> 预览并导出长图
                </Button>
              </div>
              <div className="overflow-x-auto flex-1 max-h-[600px] overflow-y-auto">
                <table className="w-full text-left whitespace-nowrap text-sm">
                  <thead className="sticky top-0 bg-slate-950 border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider z-10">
                    <tr>
                      <th className="p-4">日期</th><th className="p-4">剧本名</th><th className="p-4">时长</th>
                      <th className="p-4">玩家名单</th><th className="p-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {sortedSessions.map((s) => {
                      const m = modules.find((x) => x.id === s.moduleId);
                      return (
                        <tr key={s.id} className="hover:bg-slate-800/30">
                          <td className="p-4 text-slate-400 font-mono">{s.date}</td>
                          <td className="p-4 font-bold text-slate-200">{m?.title || '未知模组'}</td>
                          <td className="p-4 text-emerald-400 font-medium">{s.duration}h</td>
                          <td className="p-4 text-slate-400"><span className="text-white mr-1 font-bold">{s.playerCount}人:</span> {s.investigators}</td>
                          <td className="p-4 text-right">
                            <button type="button" onClick={() => handleDeleteSession(s.id)} className="text-red-400 hover:text-red-300">删除</button>
                          </td>
                        </tr>
                      );
                    })}
                    {sessions.length === 0 && <tr><td colSpan="5" className="p-8 text-center text-slate-500">暂无任何跑团记录</td></tr>}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {kpTab === 'overview' && (
        <Panel className="overflow-hidden animate-in fade-in">
          <div className="flex flex-col sm:flex-row justify-between items-center p-6 bg-slate-950/50 border-b border-slate-800 gap-4">
            <h3 className="text-lg font-bold text-slate-200">系统全收录模组带团状态</h3>
            <div className="flex items-center space-x-4">
              <Select value={overviewFilter} onChange={(e) => setOverviewFilter(e.target.value)} className="!py-2 !w-auto text-sm">
                <option value="all">显示全部模组</option>
                <option value="unplayed">找出从未带过的模组</option>
                <option value="played">只看带过的模组</option>
              </Select>
              <Button
                variant="ghost"
                className="!py-2 text-sm"
                onClick={() => handlePreview('kp-all', { filteredOverviewModules, moduleStats, overviewFilter })}
              >
                <ImageIcon className="w-4 h-4" /> 导出盘点长图
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-slate-950 border-b border-slate-800 text-slate-400 text-sm shadow z-10">
                <tr>
                  <th className="p-4 font-medium">模组名称</th>
                  <th className="p-4 font-medium hidden sm:table-cell">地区与时代</th>
                  <th className="p-4 font-medium text-center">带团次数</th>
                  <th className="p-4 font-medium text-center">平均用时</th>
                  <th className="p-4 font-medium text-center hidden sm:table-cell">历史累计用时</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredOverviewModules.map((m) => {
                  const stats = moduleStats[m.id] || { count: 0, totalDuration: 0 };
                  const isUnplayed = stats.count === 0;
                  return (
                    <tr key={m.id} className={cx('transition', isUnplayed ? 'hover:bg-red-900/10' : 'hover:bg-slate-800/30')}>
                      <td className="p-4 text-white font-bold">{m.title}</td>
                      <td className="p-4 text-slate-400 hidden sm:table-cell text-sm">{m.region} {m.era}</td>
                      <td className="p-4 text-center">
                        {isUnplayed
                          ? <span className="text-red-400 text-xs bg-red-400/10 px-2 py-1 rounded font-bold">从未带过</span>
                          : <span className="text-emerald-400 font-bold">{stats.count} 次</span>}
                      </td>
                      <td className="p-4 text-center text-slate-300 font-medium">{isUnplayed ? '-' : `${(stats.totalDuration / stats.count).toFixed(1)} h`}</td>
                      <td className="p-4 text-center text-slate-500 hidden sm:table-cell">{isUnplayed ? '-' : `${stats.totalDuration} h`}</td>
                    </tr>
                  );
                })}
                {filteredOverviewModules.length === 0 && <tr><td colSpan="5" className="p-8 text-center text-slate-500">此分类下没有找到模组数据</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
