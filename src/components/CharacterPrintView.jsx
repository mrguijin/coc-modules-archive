/**
 * 角色卡打印预览页。
 * 屏幕上是 A4 纸张预览，点「打印 / 导出 PDF」调用浏览器原生打印，
 * 在打印对话框里选择「另存为 PDF」即可得到矢量 PDF（文字可选中、可搜索）。
 *
 * 两种数据来源：
 *   - characterId：登录用户，从服务端拉取（会做归属校验）；
 *   - character：访客草稿，直接由上层传入，不经过服务端。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Edit, Printer } from 'lucide-react';
import { computeSheet, validateSheet } from '../../shared/coc7e.js';
import { apiGet } from '../lib/api.js';
import { Button, EmptyState, Panel } from './ui.jsx';
import CharacterPrint from './characters/CharacterPrint.jsx';

export default function CharacterPrintView({
  characterId, character: preset, customOccupations = [], onBack, onEdit, showToast,
}) {
  const [fetched, setFetched] = useState(null);
  const [loading, setLoading] = useState(!preset);

  useEffect(() => {
    if (preset) { setLoading(false); return undefined; }
    let alive = true;
    setLoading(true);
    apiGet(`/api/characters/${characterId}`)
      .then((data) => { if (alive) setFetched(data); })
      .catch((err) => { showToast(err.message, 'error'); onBack?.(); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [characterId, preset, showToast, onBack]);

  // 访客草稿没有 derived，就地补一份（与后端同一套算法）
  const character = useMemo(() => {
    if (preset) {
      const ctx = { customOccupations };
      return { ...preset, derived: preset.derived || computeSheet(preset, ctx), warnings: preset.warnings || validateSheet(preset, ctx) };
    }
    return fetched;
  }, [preset, fetched, customOccupations]);

  if (loading && !character) return <Panel><EmptyState title="正在准备打印版面…" /></Panel>;
  if (!character) return null;

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onBack}><ArrowLeft className="w-4 h-4" />返回</Button>
          <div>
            <div className="text-white font-bold">{character.name} · 打印版面</div>
            <div className="text-xs text-slate-500">
              A4 双页 · 全部技能与基础值都会打印 · 在打印对话框中选择「另存为 PDF」即可导出
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onEdit && character.canEdit !== false ? (
            <Button variant="ghost" onClick={() => onEdit(character)}><Edit className="w-4 h-4" />编辑</Button>
          ) : null}
          <Button onClick={() => window.print()}><Printer className="w-4 h-4" />打印 / 导出 PDF</Button>
        </div>
      </div>

      <div className="no-print text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-xl p-3">
        提示：打印设置里请把「页边距」设为默认、「背景图形」保持关闭 —— 角色卡版面本身不需要背景色即可清晰打印。
        审核状态与 KP 批复不会出现在打印件上。
      </div>

      <div className="overflow-x-auto pb-8">
        <CharacterPrint character={character} />
      </div>
    </div>
  );
}
