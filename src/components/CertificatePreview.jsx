/**
 * 长图预览与导出（调查员结业证书 / KP 执导履历 / 全模组盘点）。
 *
 * 安全改动：原先通过 <script src="https://cdnjs.cloudflare.com/..."> 在运行时加载
 * 第三方截图库 —— 这等于把任意第三方脚本放进自己的页面执行，且离线/内网直接失效。
 * 现改为把 html-to-image 作为正式依赖打包进产物：无运行时外链、可离线、便于收紧 CSP。
 */

import React, { useState } from 'react';
import { toJpeg } from 'html-to-image';
import { AlertCircle, CheckCircle, Download, Shield, X } from 'lucide-react';

const EXPORT_WIDTH = 800;

export default function CertificatePreview({
  previewMode, previewData, currentUser, kpName, playedModules, modules,
  onClose, showToast, toast,
}) {
  const [exporting, setExporting] = useState(false);

  const filename = previewMode === 'player'
    ? '调查员结业档案.jpg'
    : previewMode === 'kp-all' ? '全模组带团盘点表.jpg' : '守秘人履历记录.jpg';

  const exportAsImage = async () => {
    try {
      setExporting(true);
      showToast('正在渲染长图，请稍候…');
      const element = document.getElementById('export-canvas');
      if (!element) throw new Error('找不到目标元素');

      const parent = element.parentElement;
      const originalOverflow = parent.style.overflowX;
      parent.style.overflowX = 'visible';

      // 等字体与布局稳定，避免文字被截断
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 120));

      const canvasHeight = element.offsetHeight;
      const dataUrl = await toJpeg(element, {
        quality: 0.95,
        backgroundColor: '#020617',
        pixelRatio: 2,
        width: EXPORT_WIDTH,
        height: canvasHeight,
        style: { width: `${EXPORT_WIDTH}px`, height: `${canvasHeight}px`, margin: '0', transform: 'none' },
      });

      parent.style.overflowX = originalOverflow;

      const link = document.createElement('a');
      link.download = filename;
      link.href = dataUrl;
      link.click();
      showToast('高清长图已保存！');
    } catch (err) {
      showToast(`生成长图失败：${err.message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const titleStyle = (title, role) => {
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

  return (
    <div className="bg-slate-950 min-h-screen w-full text-slate-200 font-sans pb-20">
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-full shadow-2xl flex items-center animate-in fade-in font-bold text-sm ${toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-slate-950'}`}>
          {toast.type === 'error' ? <AlertCircle className="w-4 h-4 mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
          {toast.msg}
        </div>
      )}

      <div className="fixed top-0 left-0 w-full bg-slate-900/90 backdrop-blur-md border-b border-slate-700 p-4 flex justify-center items-center space-x-4 shadow-xl z-[9999]">
        <button
          type="button"
          disabled={exporting}
          onClick={exportAsImage}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-full font-bold shadow-lg flex items-center transition whitespace-nowrap"
        >
          {exporting ? <span className="animate-pulse">渲染中…</span> : <><Download className="w-5 h-5 mr-2" /> 导出长图</>}
        </button>
        <button
          type="button"
          disabled={exporting}
          onClick={onClose}
          className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-full font-bold shadow flex items-center transition border border-slate-600 whitespace-nowrap"
        >
          <X className="w-5 h-5 mr-2" /> 返回
        </button>
      </div>

      <div className="pt-24 w-full overflow-x-auto pb-10 px-4">
        <div
          id="export-canvas"
          className="w-[800px] min-w-[800px] max-w-[800px] shrink-0 mx-auto relative overflow-hidden bg-[#020617] p-12 border-2 border-slate-800 rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.5)]"
          style={{ boxSizing: 'border-box' }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-5">
            <Shield style={{ width: '600px', height: '600px', color: '#ffffff' }} />
          </div>

          {/* 版面 1：玩家结业档案 */}
          {previewMode === 'player' && (
            <div className="relative z-10 border-4 border-double border-slate-700 p-12 bg-slate-900/40 rounded-xl">
              <div className="text-center border-b-2 border-slate-700 pb-8 mb-10">
                <h1 className="text-5xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400 mb-4 drop-shadow-md">秘密调查档案馆</h1>
                <h2 className="text-2xl font-bold tracking-[0.3em] text-slate-400">【 调 查 员 生 涯 鉴 定 档 案 】</h2>
              </div>

              <div className="flex justify-between items-end mb-8 border-l-4 border-emerald-500 pl-6">
                <div className="text-xl space-y-3">
                  <p className="flex items-center text-slate-300">档案归属： <span className="font-bold text-white text-3xl ml-2 border-b border-slate-600 px-2 pb-1">{currentUser?.username || '见习调查员'}</span></p>
                  <p className="flex items-center text-slate-400 text-lg">签发日期： <span className="ml-2 font-mono">{new Date().toLocaleDateString()}</span></p>
                </div>
                <div className="text-right flex flex-col items-end">
                  <div className="text-slate-500 font-bold tracking-widest text-sm mb-2">已调查事件总数</div>
                  <div className="text-6xl font-black text-emerald-400 mb-2 drop-shadow-md">{playedModules.length}</div>
                </div>
              </div>

              <div className="mb-10 text-center bg-slate-950/50 py-6 border-y border-slate-800 relative overflow-hidden shadow-inner">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-slate-800/30 to-transparent" />
                <p className="text-slate-500 tracking-[0.3em] text-sm uppercase mb-3 relative z-10">经最高监督委员会最终裁定，该对象被正式认定为</p>
                <div className={`text-4xl relative z-10 ${titleStyle(currentUser?.title || '见习调查员', currentUser?.role)}`}>
                  『 {currentUser?.role === 'admin' ? '首席守秘人' : (currentUser?.title || '见习调查员')} 』
                </div>
              </div>

              <h3 className="text-lg font-bold bg-slate-800/80 p-3 rounded-t-lg border-b border-slate-700 text-slate-200 mb-0">生涯事迹明细</h3>
              <table className="w-full text-left border-collapse mb-16 bg-slate-950/50 rounded-b-lg table-fixed">
                <thead>
                  <tr className="bg-slate-900 text-slate-400 text-base">
                    <th className="py-4 px-6 font-medium border-b border-slate-800 w-1/2">事件档案</th>
                    <th className="py-4 px-6 font-medium border-b border-slate-800 w-1/4">时代区域</th>
                    <th className="py-4 px-6 font-medium text-center border-b border-slate-800 w-1/4">参与规模</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-lg">
                  {modules.filter((m) => playedModules.includes(m.id)).map((m, i) => (
                    <tr key={m.id}>
                      <td className="py-4 px-6 font-bold text-slate-200 border-b border-slate-800/50 break-words">{i + 1}. {m.title}</td>
                      <td className="py-4 px-6 text-slate-400 border-b border-slate-800/50">{m.region} {m.era}</td>
                      <td className="py-4 px-6 text-center text-slate-400 border-b border-slate-800/50">{m.players} 人</td>
                    </tr>
                  ))}
                  {modules.filter((m) => playedModules.includes(m.id)).length === 0 && (
                    <tr><td colSpan={3} className="py-8 px-6 text-center text-slate-500">尚未归档任何调查事件</td></tr>
                  )}
                </tbody>
              </table>

              <div className="pt-10 border-t-2 border-slate-800 flex justify-between items-end text-sm">
                <div>
                  <p className="font-bold mb-1 text-slate-300 text-lg">档案馆最高监督委员会 签发</p>
                  <p className="text-slate-500">This deed is attested by Yogesotras</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500 mb-1">守密人 Keeper署名 / Signature</p>
                  <p className="font-serif italic text-4xl text-emerald-400 font-bold tracking-widest">{kpName}</p>
                </div>
              </div>
            </div>
          )}

          {/* 版面 2：KP 带团履历 */}
          {previewMode === 'kp-history' && previewData && (
            <div className="relative z-10 border-4 border-double border-slate-700 p-12 bg-slate-900/40 rounded-xl">
              <div className="text-center pb-8 mb-10 border-b-2 border-slate-700">
                <h1 className="text-5xl font-black tracking-widest text-amber-500 mb-4 drop-shadow-md">守秘人(KP)执导履历明细表</h1>
                <p className="text-slate-400 tracking-[0.2em] text-lg">Keeper Of Arcane Lore : Service Record</p>
              </div>
              <div className="grid grid-cols-3 gap-6 mb-12 text-center">
                <div className="p-6 bg-slate-950/50 border border-slate-800 rounded-xl">
                  <div className="text-base text-slate-500 mb-2 font-bold tracking-widest">守秘人姓名</div>
                  <div className="text-3xl font-black text-slate-200">{currentUser?.username || '首席 KP'}</div>
                </div>
                <div className="p-6 bg-slate-950/50 border border-slate-800 rounded-xl">
                  <div className="text-base text-slate-500 mb-2 font-bold tracking-widest">执导总场次</div>
                  <div className="text-4xl font-black text-amber-400">{previewData.sessions?.length || 0}</div>
                </div>
                <div className="p-6 bg-slate-950/50 border border-slate-800 rounded-xl">
                  <div className="text-base text-slate-500 mb-2 font-bold tracking-widest">累计带团时长</div>
                  <div className="text-4xl font-black text-amber-400">{(previewData.totalHours || 0).toFixed(1)} H</div>
                </div>
              </div>
              <h3 className="text-xl font-bold bg-slate-800/80 text-slate-200 p-4 rounded-t-xl border-b border-slate-700 mb-0">近期执导明细记录</h3>
              <table className="w-full text-left border-collapse bg-slate-950/50 rounded-b-xl table-fixed text-base">
                <thead>
                  <tr className="bg-slate-900 text-slate-400">
                    <th className="p-4 font-medium border-b border-slate-800 w-[20%]">运行日期</th>
                    <th className="p-4 font-medium border-b border-slate-800 w-[30%]">模组名</th>
                    <th className="p-4 font-medium border-b border-slate-800 w-[15%]">用时</th>
                    <th className="p-4 font-medium border-b border-slate-800 w-[35%]">参与调查员名单</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {[...(previewData.sessions || [])].sort((a, b) => new Date(b.date) - new Date(a.date)).map((s) => {
                    const m = (previewData.modules || []).find((x) => x.id === s.moduleId);
                    return (
                      <tr key={s.id}>
                        <td className="p-4 text-slate-400 font-mono border-b border-slate-800/50">{s.date}</td>
                        <td className="p-4 font-bold text-slate-200 border-b border-slate-800/50 break-words">{m?.title || '未知'}</td>
                        <td className="p-4 text-amber-400 font-bold border-b border-slate-800/50">{s.duration} H</td>
                        <td className="p-4 text-slate-400 border-b border-slate-800/50 break-words">
                          {s.investigators} <span className="text-slate-500 text-sm ml-1">({s.playerCount}人)</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 版面 3：全模组盘点 */}
          {previewMode === 'kp-all' && previewData && (
            <div className="relative z-10 border-4 border-double border-slate-700 p-12 bg-slate-900/40 rounded-xl">
              <div className="text-center pb-8 mb-10 border-b-2 border-slate-700">
                <h1 className="text-5xl font-black tracking-widest text-amber-500 mb-4 drop-shadow-md">全模组带团状态盘点表</h1>
                <p className="text-slate-400 text-lg">
                  筛选条件: <span className="text-amber-400 font-bold">{previewData.overviewFilter === 'all' ? '全部模组' : previewData.overviewFilter === 'unplayed' ? '从未带过' : '已带过'}</span>
                  &nbsp;|&nbsp; 统计日期: <span className="font-mono">{new Date().toLocaleDateString()}</span>
                </p>
              </div>
              <table className="w-full text-left border-collapse bg-slate-950/50 rounded-xl table-fixed text-base">
                <thead>
                  <tr className="bg-slate-800/80 text-slate-300">
                    <th className="p-4 font-bold border-b border-slate-800 w-[30%]">模组名称</th>
                    <th className="p-4 font-bold border-b border-slate-800 w-[20%]">地区/时代</th>
                    <th className="p-4 font-bold text-center border-b border-slate-800 w-[15%]">带团次数</th>
                    <th className="p-4 font-bold text-center border-b border-slate-800 w-[15%]">平均用时</th>
                    <th className="p-4 font-bold text-center border-b border-slate-800 w-[20%]">累计用时</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {(previewData.filteredOverviewModules || []).map((m) => {
                    const stats = previewData.moduleStats?.[m.id] || { count: 0, totalDuration: 0 };
                    const isUnplayed = stats.count === 0;
                    return (
                      <tr key={m.id}>
                        <td className="p-4 font-bold text-slate-200 border-b border-slate-800/50 break-words">{m.title}</td>
                        <td className="p-4 text-slate-400 border-b border-slate-800/50">{m.region} {m.era}</td>
                        <td className={`p-4 text-center border-b border-slate-800/50 ${isUnplayed ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold'}`}>{isUnplayed ? '从未带过' : `${stats.count} 次`}</td>
                        <td className="p-4 text-center text-slate-300 font-mono border-b border-slate-800/50">{isUnplayed ? '-' : `${(stats.totalDuration / stats.count).toFixed(1)} H`}</td>
                        <td className="p-4 text-center text-amber-400 font-mono font-bold border-b border-slate-800/50">{isUnplayed ? '-' : `${stats.totalDuration} H`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
