/**
 * 模组详情
 * 从 App.jsx 抽出的视图组件；只通过 props 接收数据与回调，不直接发请求。
 */
import React from 'react';
import {
  AlertCircle, BookOpen, BrainCircuit, Calendar, CheckCircle, Copy, Edit, FileText,
  Info, User, Users,
} from 'lucide-react';
import { Button, cx } from '../components/ui.jsx';
import CoverArt, { GoldDivider } from '../components/ModuleCover.jsx';

/** 把换行转成 <br/>，用于模组长文本 */
const renderMultilineText = (text) => {
  if (!text) return null;
  return text.split(String.fromCharCode(10)).map((line, index) => (
    <React.Fragment key={index}>{line}<br /></React.Fragment>
  ));
};

export default function ModuleDetailView({ module, isAdmin, played, currentUser, onBack, onCopy, onEdit, onTogglePlayed, onGoCharacters }) {
  return (
  <div className="animate-in slide-in-from-bottom-4">
    <div className="flex justify-between items-center mb-6">
      <button type="button" onClick={onBack} className="text-slate-400 hover:text-emerald-400 font-medium">← 返回大厅</button>
      <div className="flex space-x-3">
        <Button variant="ghost" className="!py-2" onClick={() => onCopy(module)}><Copy className="h-4 w-4" />复制简介</Button>
        {isAdmin && (
          <Button variant="ghost" className="!py-2" onClick={(e) => onEdit(module, e)}><Edit className="h-4 w-4" />编辑</Button>
        )}
      </div>
    </div>
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
      <div className={`h-80 w-full bg-gradient-to-br ${module.themeColor} relative flex items-end p-8 md:p-12`}>
        <CoverArt module={module} variant="hero" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/50 to-transparent" />
        <div className="relative z-10 w-full flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {module.isPinned && <span className="bg-amber-500 text-amber-950 text-xs px-2 py-1 rounded font-bold shadow">置顶</span>}
              {module.series && <span className="bg-white/20 text-white text-sm px-3 py-1 rounded-lg font-bold shadow-sm">{module.series}</span>}
            </div>
            <h1 className="text-4xl md:text-6xl font-serif font-black tracking-[0.06em] text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]">{module.title}</h1>
            <GoldDivider className="mt-4 justify-start" />
          </div>
          <button
            type="button"
            onClick={(e) => onTogglePlayed(module.id, e)}
            className={cx(
              'px-8 py-4 rounded-xl font-bold transition flex items-center shadow-xl shrink-0 text-lg',
              played
                ? 'bg-slate-800 text-emerald-400 border border-emerald-500/30'
                : 'bg-emerald-600 text-white hover:bg-emerald-500',
            )}
          >
            <CheckCircle className="h-6 w-6 mr-2" />{played ? '已归档' : '标记为已调查'}
          </button>
        </div>
      </div>
      <div className="p-8 md:p-12 grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-10">
          <section>
            <h3 className="text-2xl font-bold text-slate-200 mb-6 flex items-center"><Info className="h-6 w-6 mr-3 text-emerald-500" /> 案件背景</h3>
            <p className="text-slate-300 leading-relaxed break-words text-lg bg-slate-950/50 p-6 md:p-8 rounded-2xl border border-slate-800/50">
              {renderMultilineText(module.description)}
            </p>
          </section>
          {(module.charInfo || module.occupations || module.skills || module.notes) && (
            <section className="bg-slate-950 p-6 md:p-8 rounded-2xl border border-slate-800">
              <h3 className="text-xl font-bold text-slate-200 mb-6 border-b border-slate-800 pb-3 flex items-center">
                <FileText className="h-5 w-5 mr-2 text-emerald-500" /> 附加档案
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {module.charInfo && (
                  <div>
                    <span className="text-slate-500 text-sm font-bold mb-2 flex"><User className="w-4 h-4 mr-1" />车卡要求</span>
                    <p className="text-slate-300 bg-slate-900 p-4 rounded-lg break-words">{renderMultilineText(module.charInfo)}</p>
                  </div>
                )}
                {module.occupations && (
                  <div>
                    <span className="text-slate-500 text-sm font-bold mb-2 flex"><BookOpen className="w-4 h-4 mr-1" />推荐职业</span>
                    <p className="text-slate-300 bg-slate-900 p-4 rounded-lg break-words">{renderMultilineText(module.occupations)}</p>
                  </div>
                )}
                {module.skills && (
                  <div className="md:col-span-2">
                    <span className="text-slate-500 text-sm font-bold mb-2 flex"><BrainCircuit className="w-4 h-4 mr-1" />推荐技能</span>
                    <p className="text-slate-300 bg-slate-900 p-4 rounded-lg break-words">{renderMultilineText(module.skills)}</p>
                  </div>
                )}
                {module.notes && (
                  <div className="md:col-span-2 p-5 bg-red-950/20 border border-red-900/50 rounded-xl">
                    <span className="text-red-400 text-sm font-black flex mb-2"><AlertCircle className="w-4 h-4 mr-1" /> KP警告/备注</span>
                    <p className="text-red-200 break-words">{renderMultilineText(module.notes)}</p>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
        <div className="bg-slate-950/80 rounded-2xl p-6 md:p-8 border border-slate-800 h-fit space-y-6">
          <h4 className="font-bold text-slate-300 border-b border-slate-800 pb-4">基础参数</h4>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-3 bg-slate-900 px-4 rounded-lg">
              <span className="text-slate-400 flex items-center text-sm"><Users className="h-4 w-4 mr-2" /> 人数</span>
              <span className="text-slate-100 font-bold">{module.players}</span>
            </div>
            <div className="flex justify-between items-center py-3 bg-slate-900 px-4 rounded-lg">
              <span className="text-slate-400 flex items-center text-sm"><Calendar className="h-4 w-4 mr-2" /> 时代</span>
              <span className="text-slate-100 font-bold">{module.region} <span className="text-emerald-400">{module.era}</span></span>
            </div>
            {currentUser && (
              <Button variant="ghost" className="w-full" onClick={onGoCharacters}>
                <Users className="h-4 w-4" />为这个模组车一张卡
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}
