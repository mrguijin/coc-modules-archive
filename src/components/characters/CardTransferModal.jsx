/**
 * 角色卡「导入 / 导出」弹窗。
 *
 *  - 导出：两种格式
 *      ① 角色卡编码（COC7G1:…）—— 别人粘贴即可还原成一张可继续编辑的卡；
 *      ② 骰娘机器人导入指令（.st …）—— 与官方 Excel「简化卡 骰娘导入」同格式，直接发到群里给骰娘。
 *  - 导入：粘贴编码 → 解析预览 → 交给上层创建（登录用户走接口，访客存本机）。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCopy, Download, FileCode2, Upload } from 'lucide-react';
import { CHAR_LABEL, CHARS, computeSheet } from '../../../shared/coc7e.js';
import { DICEBOT_FORMATS, buildDiceBotCommand } from '../../../shared/dicebot.js';
import { exportCardCode, importCardCode } from '../../../shared/cardcode.js';
import { Badge, Button, Field, Input, Modal, Panel, Textarea, cx } from '../ui.jsx';

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 非安全上下文可能被拒绝，走降级 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CopyButton({ text, label = '复制', onToast }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="subtle"
      onClick={async () => {
        const ok = await copyText(text);
        if (ok) {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } else {
          onToast?.('复制失败，请手动全选文本复制', 'error');
        }
      }}
    >
      {done ? <Check className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
      {done ? '已复制' : label}
    </Button>
  );
}

/** 导出：角色卡编码 + 骰娘指令 */
export function ExportCardModal({ open, onClose, character, onToast }) {
  const [codeState, setCodeState] = useState({ id: '', value: '' });
  const [bot, setBot] = useState('dice');
  const [dot, setDot] = useState('.');

  useEffect(() => {
    if (!open || !character?.id) return undefined;
    let alive = true;
    exportCardCode(character)
      .then((v) => { if (alive) setCodeState({ id: character.id, value: v }); })
      .catch(() => { if (alive) setCodeState({ id: character.id, value: '' }); });
    return () => { alive = false; };
  }, [open, character]);
  // 编码是按卡缓存的：换一张卡时旧编码不再显示，等新编码算好
  const code = codeState.id === character?.id ? codeState.value : '';
  const busy = Boolean(open && character) && !code;

  const derived = useMemo(
    () => character?.derived || (character ? computeSheet(character) : null),
    [character],
  );
  const botText = useMemo(
    () => (character && derived ? buildDiceBotCommand(character, derived, { bot, dot }) : ''),
    [character, derived, bot, dot],
  );

  return (
    <Modal open={open} onClose={onClose} title="导出角色卡" wide>
      <div className="space-y-5">
        <Panel className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-bold text-white flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-cyan-400" />角色卡编码
              <span className="text-xs font-normal text-slate-500">别人粘贴这段编码即可还原成一张可编辑的卡</span>
            </h4>
            <CopyButton text={code} label="复制编码" onToast={onToast} />
          </div>
          <Textarea
            rows={5}
            readOnly
            value={busy ? '正在生成…' : code}
            className="!font-mono !text-xs break-all"
            onFocus={(e) => e.target.select()}
          />
          <p className="text-[11px] text-slate-500">
            编码里只有「玩家输入」（属性、技能点、背景、备注等），不含归属账号、审核状态与模组经历；
            导入方拿到后可以随意改，不会影响你的原卡。
          </p>
        </Panel>

        <Panel className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-bold text-white flex items-center gap-2">
              <Download className="w-4 h-4 text-emerald-400" />骰娘机器人导入指令
              <span className="text-xs font-normal text-slate-500">同官方 Excel「简化卡 骰娘导入」</span>
            </h4>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-slate-700 overflow-hidden">
                {['.', '。'].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDot(d)}
                    className={cx('px-2.5 py-1 text-xs font-mono',
                      dot === d ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200')}
                  >
                    {d}st
                  </button>
                ))}
              </div>
              <CopyButton text={botText} label="复制指令" onToast={onToast} />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DICEBOT_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setBot(f.id)}
                title={f.hint}
                className={cx('px-2.5 py-1.5 rounded-md text-xs font-bold border transition',
                  bot === f.id
                    ? 'bg-emerald-600 border-emerald-500 text-white'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-emerald-500/50')}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Textarea rows={5} readOnly value={botText} className="!font-mono !text-xs break-all" onFocus={(e) => e.target.select()} />
          <p className="text-[11px] text-slate-500">
            通用格式没有状态与武器；塔系 / 惠惠会在开头带上角色名；shiki Exp10 会额外带时代、性别、DB、体格、闪避、护甲与武器。
          </p>
        </Panel>
      </div>
    </Modal>
  );
}

/** 导入：粘贴编码 → 预览 → 交给上层创建 */
export function ImportCardModal({ open, onClose, onImport, onToast }) {
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 关闭时清空（而不是打开时 setState，避免 effect 里同步 setState 造成级联渲染）
  const handleClose = () => {
    setText('');
    setSheet(null);
    setError('');
    onClose?.();
  };

  const parsed = useMemo(() => (sheet ? computeSheet(sheet) : null), [sheet]);

  const doParse = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await importCardCode(text);
      if (!res.ok) {
        setSheet(null);
        setError(res.error || '解析失败');
        onToast?.(res.error || '解析失败', 'error');
        return;
      }
      setSheet(res.sheet);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="导入角色卡" wide>
      <div className="space-y-4">
        <Field label="粘贴角色卡编码" hint="以 COC7G1: 或 COC7C1: 开头的一整段文本">
          <Textarea
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="COC7G1:……"
            className="!font-mono !text-xs break-all"
          />
        </Field>
        <div className="flex items-center gap-2">
          <Button onClick={doParse} disabled={busy || !text.trim()}>
            <Upload className="w-4 h-4" />{busy ? '解析中…' : '解析'}
          </Button>
          {error ? <span className="text-xs text-red-400">{error}</span> : null}
          {sheet ? <Badge tone="emerald">解析成功</Badge> : null}
        </div>

        {sheet && parsed ? (
          <Panel className="p-4 space-y-3">
            <div className="text-white font-bold flex flex-wrap items-center gap-2">
              {sheet.name || '未命名调查员'}
              <Badge tone="cyan">{parsed.occupation?.name || '未选择职业'}</Badge>
              <span className="text-xs text-slate-500 font-normal">
                {sheet.age} 岁 · {sheet.era} · 已投点技能 {parsed.skills.filter((s) => s.used).length} 项
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center">
              {CHARS.map((k) => (
                <div key={k} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5">
                  <div className="text-[10px] text-slate-500">{CHAR_LABEL[k]}</div>
                  <div className="font-mono font-bold text-slate-200">{parsed.eff[k]}</div>
                </div>
              ))}
            </div>
            {sheet.notes ? (
              <p className="text-xs text-slate-400 border-t border-slate-800 pt-2 whitespace-pre-wrap">
                备注：{sheet.notes.slice(0, 200)}{sheet.notes.length > 200 ? '…' : ''}
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-slate-500">
                导入后是一张新卡（草稿状态、无传奇标记、无审核记录），可以直接编辑再保存。
              </p>
              <Button onClick={() => onImport?.(sheet)}>创建为新角色卡</Button>
            </div>
          </Panel>
        ) : null}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={handleClose}>关闭</Button>
        </div>
      </div>
    </Modal>
  );
}

export { copyText };
