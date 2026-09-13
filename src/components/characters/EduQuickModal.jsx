/**
 * KP 快捷处理「教育增强」——在角色卡管理列表 / 审卡中心直接用，不必进入编辑器。
 *
 * 方案 C 的两把钥匙都在这里：
 *   ① 授权重掷一次：玩家下次结算时消耗一次授权（服务端扣减，客户端伪造无效）；
 *   ② 重置教育增强：清空数值与流水，只留下「谁在什么时候重置」的痕迹。
 */

import React from 'react';
import { Dices, History, RotateCcw, ShieldCheck } from 'lucide-react';
import { CHAR_LABEL, eduGrowthLabel, grantEduReroll, resetEduGrowth } from '../../../shared/coc7e.js';
import { apiPatch } from '../../lib/api.js';
import { Badge, Button, Modal, Panel, cx } from '../ui.jsx';

const VIA_LABEL = { roll: '自动检定', manual: '手动录入', reroll: '授权重掷' };

export default function EduQuickModal({ open, item, onClose, onSaved, showToast }) {
  if (!item) return null;
  const g = item.eduGrowth || {};
  const attempts = g.attempts || [];
  const actor = item.__actor || '';

  const patch = async (body, okMsg) => {
    try {
      const saved = await apiPatch(`/api/characters/${item.id}`, body);
      showToast(okMsg);
      onSaved?.(saved);
      onClose?.();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const grant = () => patch(
    { eduGrowth: grantEduReroll(g, actor) },
    `已授权【${item.name}】重掷一次教育增强`,
  );
  const reset = () => patch(
    { eduBonus: 0, eduGrowth: resetEduGrowth(actor) },
    `已重置【${item.name}】的教育增强`,
  );

  return (
    <Modal open={open} onClose={onClose} title={`教育增强 · ${item.name}`} wide>
      <div className="space-y-4">
        <Panel className="p-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {g.settled ? <Badge tone="emerald">已结算</Badge> : <Badge tone="amber">未结算</Badge>}
            {g.settled && (g.granted || 0) <= 0 ? <Badge tone="slate">已锁定</Badge> : null}
            {(g.granted || 0) > 0 ? <Badge tone="cyan">已授权 {g.granted} 次重掷</Badge> : null}
            {(g.rerolls || 0) > 0 ? <Badge tone="amber">已重掷 {g.rerolls} 次</Badge> : null}
            <span className="text-xs text-slate-400">
              当前提升 <b className="font-mono text-cyan-300">+{item.eduGrowth?.gain ?? item.ageAdjust?.eduBonus ?? 0}</b>
              （{eduGrowthLabel(g)}）
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            年龄：{item.age} 岁 · 该年龄需要 {item.ageAdjust?.eduChecks ?? 0} 次教育增强检定。
            {g.settled ? '玩家已结算，默认锁定；要再掷必须先「授权重掷」。' : '玩家还没结算，可以自己掷第一次或手动补录。'}
          </p>
        </Panel>

        <Panel className="p-4">
          <div className="flex items-center gap-2 mb-2 text-sm font-bold text-white">
            <History className="w-4 h-4 text-cyan-400" />结算流水（{attempts.length}）
          </div>
          {attempts.length === 0 ? (
            <p className="text-xs text-slate-500">还没有任何结算记录。</p>
          ) : (
            <div className="space-y-1 text-xs">
              {attempts.map((a, i) => (
                <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-slate-800/60 pb-1 last:border-0">
                  <span className="text-slate-500">#{i + 1}</span>
                  <span className={cx('px-1.5 py-0.5 rounded border text-[10px]',
                    a.via === 'manual' ? 'border-cyan-600/50 text-cyan-300'
                      : a.via === 'reroll' ? 'border-amber-500/40 text-amber-300'
                        : 'border-slate-700 text-slate-400')}
                  >
                    {VIA_LABEL[a.via] || a.via}
                  </span>
                  {a.manual ? null : <span className="text-slate-400">检定 {a.count} 次</span>}
                  <span className="text-slate-300">提升 <b className="font-mono text-cyan-300">+{a.gain}</b></span>
                  <span className="text-slate-500">累计 {a.totalAfter}</span>
                  {a.by ? <span className="text-slate-500">by {a.by}</span> : null}
                  {a.at ? <span className="text-slate-600">{new Date(a.at).toLocaleString('zh-CN')}</span> : null}
                  {a.rolls?.length ? (
                    <span className="font-mono text-slate-500">{a.rolls.map((r) => `D100=${r.roll}→+${r.gain}`).join('、')}</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {g.lastGrant?.by ? (
            <p className="text-[11px] text-slate-500 mt-2">
              最近授权：{g.lastGrant.by}{g.lastGrant.at ? ` · ${new Date(g.lastGrant.at).toLocaleString('zh-CN')}` : ''}
            </p>
          ) : null}
          {g.lastReset?.by ? (
            <p className="text-[11px] text-slate-500">
              最近重置：{g.lastReset.by}{g.lastReset.at ? ` · ${new Date(g.lastReset.at).toLocaleString('zh-CN')}` : ''}
            </p>
          ) : null}
        </Panel>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            只有 KP 能授权/重置；玩家即使绕过界面直接发请求，服务端也会保留存档值。
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>关闭</Button>
            <Button variant="subtle" onClick={reset}><RotateCcw className="w-4 h-4" />重置教育增强</Button>
            <Button onClick={grant}><Dices className="w-4 h-4" />授权重掷一次</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { CHAR_LABEL };
