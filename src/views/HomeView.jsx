/**
 * 首页：卷宗阅览 / 合集 / 列表记录
 * 从 App.jsx 抽出的视图组件；只通过 props 接收数据与回调，不直接发请求。
 */
import React from 'react';
import {
  BookOpen, Calendar, CheckCircle, Edit, Filter, FolderArchive, Layers, LayoutGrid,
  ListChecks, Pin, Search, Trash2, Users, X,
} from 'lucide-react';
import { Button, EmptyState, Select, cx } from '../components/ui.jsx';
import CoverArt, { GoldDivider } from '../components/ModuleCover.jsx';

export default function HomeView({ modules, currentUser, playedModules, homeTab, setHomeTab, searchTerm, setSearchTerm, filterRegion, setFilterRegion, filterPlayers, setFilterPlayers, filterDuration, setFilterDuration, filterPlayed, setFilterPlayed, selectedCollection, setSelectedCollection, uniqueSeries, uniqueRegions, uniquePlayers, uniqueDurations, filteredModules, isAdmin, onOpenModule, onEditModule, onDeleteModule, onTogglePlayed, onGoAuth, onGoCharacters }) {
  return (
  <div className="space-y-6">
    <div className="text-center py-8">
      <h1 className="text-4xl md:text-5xl font-extrabold text-slate-100 mb-4">收录世界上不可名状的超自然案件</h1>
      <div className="flex justify-center items-center flex-wrap gap-3 mb-8 text-sm">
        <span className="bg-slate-900 border border-slate-800 text-slate-400 px-4 py-1.5 rounded-full">
          共收录 <strong className="text-white text-base">{modules.length}</strong> 份
        </span>
        {currentUser && (
          <span className="bg-emerald-900/30 border border-emerald-500/30 text-emerald-400 px-4 py-1.5 rounded-full">
            已归档 <strong className="text-white text-base">{playedModules.length}</strong> 份
          </span>
        )}
        {currentUser && (
          <button
            type="button"
            onClick={onGoCharacters}
            className="bg-slate-900 border border-slate-800 text-slate-300 hover:border-emerald-500/50 px-4 py-1.5 rounded-full flex items-center gap-1.5 transition"
          >
            <Users className="w-4 h-4 text-emerald-500" />我的角色卡
          </button>
        )}
      </div>
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
          <input
            type="text" placeholder="搜索关键字…" value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-4 border border-slate-700 rounded-xl bg-slate-900/80 text-white outline-none focus:border-emerald-500 transition"
          />
          {searchTerm && (
            <button type="button" onClick={() => setSearchTerm('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-3 justify-center">
          <Select value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)} className="!py-2 !w-auto text-sm">
            <option value="">全部地区</option>
            {uniqueRegions.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
          <Select value={filterPlayers} onChange={(e) => setFilterPlayers(e.target.value)} className="!py-2 !w-auto text-sm">
            <option value="">全部人数</option>
            {uniquePlayers.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Select value={filterDuration} onChange={(e) => setFilterDuration(e.target.value)} className="!py-2 !w-auto text-sm">
            <option value="">全部时长</option>
            {uniqueDurations.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          {currentUser && (
            <Select value={filterPlayed} onChange={(e) => setFilterPlayed(e.target.value)} className="!py-2 !w-auto text-sm">
              <option value="">全部状态</option>
              <option value="unplayed">未调查</option>
              <option value="played">已调查</option>
            </Select>
          )}
          {(filterRegion || filterPlayers || filterDuration || filterPlayed || selectedCollection) && (
            <button
              type="button"
              onClick={() => {
                setFilterRegion(''); setFilterPlayers(''); setFilterDuration('');
                setFilterPlayed(''); setSelectedCollection(null);
              }}
              className="text-sm font-bold text-red-400"
            >
              清除
            </button>
          )}
        </div>
      </div>
    </div>

    <div className="flex justify-center border-b border-slate-800 mb-6 space-x-8">
      {[['grid', '卷宗阅览', LayoutGrid], ['collections', '合集', FolderArchive]].map(([k, label, Icon]) => (
        <button
          key={k}
          type="button"
          onClick={() => setHomeTab(k)}
          className={cx('pb-3 font-bold flex items-center transition', homeTab === k ? 'border-b-2 border-emerald-500 text-emerald-400' : 'text-slate-400')}
        >
          <Icon className="w-4 h-4 mr-2" />{label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => { if (!currentUser) return onGoAuth(); setHomeTab('list'); }}
        className={cx('pb-3 font-bold flex items-center transition', homeTab === 'list' ? 'border-b-2 border-emerald-500 text-emerald-400' : 'text-slate-400')}
      >
        <ListChecks className="w-4 h-4 mr-2" />列表记录
      </button>
    </div>

    {homeTab === 'collections' && (
      <div className="flex flex-wrap justify-center gap-4 lg:gap-6 py-4">
        {uniqueSeries.map((series) => {
          const count = modules.filter((m) => m.series === series).length;
          return (
            <button
              key={series}
              type="button"
              onClick={() => { setSelectedCollection(series); setHomeTab('grid'); }}
              className="p-[2px] rounded-full bg-gradient-to-r from-emerald-600/40 to-cyan-600/40 hover:from-emerald-400 hover:to-cyan-400 transition"
            >
              <span className="flex items-center gap-3 px-5 py-3 bg-slate-950 rounded-full">
                <Layers className="w-5 h-5 text-emerald-500" />
                <span className="text-slate-200 font-extrabold">{series}</span>
                <span className="bg-slate-800 text-emerald-400 text-xs px-2.5 py-1 rounded-full">{count} 份</span>
              </span>
            </button>
          );
        })}
        {uniqueSeries.length === 0 && <p className="text-slate-500 py-6">还没有任何合集</p>}
      </div>
    )}

    {homeTab === 'list' && currentUser && (
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <table className="w-full text-left">
          <thead className="bg-slate-950/50 border-b border-slate-800 text-slate-400 text-sm">
            <tr><th className="p-4 text-center">状态</th><th className="p-4">名称</th><th className="p-4">合集</th><th className="p-4">参数</th></tr>
          </thead>
          <tbody>
            {filteredModules.map((m) => (
              <tr
                key={m.id}
                onClick={(e) => onTogglePlayed(m.id, e)}
                className="border-b border-slate-800/50 cursor-pointer hover:bg-slate-800/50"
              >
                <td className="p-4 text-center">
                  <CheckCircle className={cx('w-5 h-5 mx-auto', playedModules.includes(m.id) ? 'text-emerald-500' : 'text-slate-700')} />
                </td>
                <td className="p-4 font-bold text-slate-200">
                  {m.title} {m.isPinned && <Pin className="inline w-3 h-3 text-amber-500" />}
                </td>
                <td className="p-4 text-slate-400 text-sm">{m.series || '-'}</td>
                <td className="p-4 text-slate-400 text-sm">{m.players}人 / {m.duration}h</td>
              </tr>
            ))}
            {filteredModules.length === 0 && (
              <tr><td colSpan={4} className="p-8 text-center text-slate-500">没有找到匹配的档案</td></tr>
            )}
          </tbody>
        </table>
      </div>
    )}

    {homeTab === 'grid' && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {selectedCollection && (
          <div className="col-span-full flex justify-between items-center bg-emerald-900/20 border border-emerald-500/30 p-4 rounded-xl mb-2">
            <span className="text-emerald-400 font-bold"><Layers className="inline w-5 h-5 mr-2" />合集：{selectedCollection}</span>
            <button type="button" onClick={() => setSelectedCollection(null)} className="bg-slate-900 hover:bg-slate-800 px-4 py-2 rounded-lg font-bold border border-slate-700">退出</button>
          </div>
        )}
        {filteredModules.map((module) => (
          <div
            key={module.id}
            className="relative bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-emerald-500/50 transition cursor-pointer group flex flex-col"
            onClick={() => onOpenModule(module)}
          >
            {isAdmin && (
              <div className="absolute top-2 right-2 z-30 flex space-x-1 opacity-0 group-hover:opacity-100 transition">
                <button type="button" onClick={(e) => onEditModule(module, e)} className="p-2 bg-slate-800/80 hover:bg-emerald-600 text-white rounded-lg"><Edit className="h-4 w-4" /></button>
                <button type="button" onClick={(e) => onDeleteModule(module.id, e)} className="p-2 bg-slate-800/80 hover:bg-red-500 text-white rounded-lg"><Trash2 className="h-4 w-4" /></button>
              </div>
            )}
            <div className={`h-56 w-full bg-gradient-to-br ${module.themeColor} relative flex flex-col justify-center items-center text-center p-4`}>
              <CoverArt module={module} variant="card" />
              <div className="absolute top-3 left-3 flex flex-col gap-2">
                {module.isPinned && <span className="bg-amber-500 text-amber-950 text-xs px-2 py-1 rounded font-bold shadow"><Pin className="w-3 h-3 inline" /> 置顶</span>}
                {module.series && <span className="bg-white/20 text-white border border-white/30 text-xs px-2 py-1 rounded shadow"><Layers className="inline w-3 h-3 mr-1" />{module.series}</span>}
              </div>
              <h3 className="text-3xl font-serif font-black tracking-[0.06em] text-white z-10 drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">{module.title}</h3>
              <GoldDivider className="z-10 mt-3" />
              <div className="flex gap-2 mt-5 z-10">
                <span className="bg-black/50 text-slate-200 text-xs px-2.5 py-1 rounded-full"><Users className="w-3 h-3 inline" /> {module.players}</span>
                <span className="bg-black/50 text-slate-200 text-xs px-2.5 py-1 rounded-full"><Calendar className="w-3 h-3 inline" /> {module.region} <span className="text-emerald-400">{module.era}</span></span>
              </div>
            </div>
            <div className="p-5 flex-1 flex flex-col bg-slate-900/50">
              <p className="text-sm text-slate-400 line-clamp-3 leading-relaxed">{module.description}</p>
              <div className="mt-auto pt-4 flex justify-between items-center border-t border-slate-800/50">
                <span className="text-emerald-500 text-sm font-bold flex items-center"><BookOpen className="w-4 h-4 mr-1" /> 查阅档案</span>
                {currentUser && playedModules.includes(module.id) && (
                  <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded"><CheckCircle className="w-3 h-3 inline mr-1" />已调查</span>
                )}
              </div>
            </div>
          </div>
        ))}
        {filteredModules.length === 0 && (
          <div className="col-span-full">
            <EmptyState icon={Filter} title="没有找到匹配的档案" desc="试着调整搜索关键字或清除筛选条件。" />
          </div>
        )}
      </div>
    )}
  </div>
  );
}
