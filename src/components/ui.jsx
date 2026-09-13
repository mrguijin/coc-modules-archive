/**
 * 通用 UI 原语：与站点既有的暗黑档案风格保持一致（slate 底 + emerald 主色 + amber 强调）。
 * 抽出来的目的是让新增页面不必重复抄写一长串 Tailwind 类，也便于统一改动视觉。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, ChevronDown, X } from 'lucide-react';

// ------------------------------------------------------------------ 基础类
export const cx = (...parts) => parts.filter(Boolean).join(' ');

export const fieldBase = 'w-full p-3 bg-slate-950 border border-slate-700 rounded-lg text-white '
  + 'placeholder-slate-600 outline-none transition focus:border-emerald-500 focus:ring-1 '
  + 'focus:ring-emerald-500/40 disabled:opacity-50';

export const btn = {
  primary: 'px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold transition disabled:opacity-50 disabled:cursor-not-allowed',
  ghost: 'px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium transition border border-slate-700 disabled:opacity-50',
  danger: 'px-4 py-2.5 bg-red-600/90 hover:bg-red-500 text-white rounded-lg font-bold transition disabled:opacity-50',
  amber: 'px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold transition disabled:opacity-50',
  subtle: 'px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg text-sm transition border border-slate-800',
};

export function Button({ variant = 'primary', className, children, ...rest }) {
  return (
    <button type="button" className={cx(btn[variant], 'inline-flex items-center justify-center gap-2', className)} {...rest}>
      {children}
    </button>
  );
}

export function Panel({ className, children }) {
  return (
    <div className={cx('bg-slate-900 border border-slate-800 rounded-2xl shadow-xl', className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ icon: Icon, title, desc, right, className }) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-4', className)}>
      <div>
        <h2 className="text-2xl font-black text-white flex items-center">
          {Icon ? <Icon className="mr-3 text-emerald-500 w-6 h-6" /> : null}
          {title}
        </h2>
        {desc ? <p className="text-slate-400 mt-1 text-sm">{desc}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Badge({ tone = 'slate', children, className }) {
  const tones = {
    slate: 'bg-slate-800 text-slate-300 border-slate-700',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    red: 'bg-red-500/10 text-red-400 border-red-500/30',
    cyan: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  };
  return (
    <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-bold', tones[tone], className)}>
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ 表单
export function Field({ label, hint, required, error, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label ? (
        <span className="flex items-baseline justify-between mb-1">
          <span className="text-sm text-slate-400">
            {label}{required ? <span className="text-red-400 ml-0.5">*</span> : null}
          </span>
          {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
        </span>
      ) : null}
      {children}
      {error ? <span className="block mt-1 text-xs text-red-400">{error}</span> : null}
    </label>
  );
}

export function Input({ className, ...rest }) {
  return <input className={cx(fieldBase, className)} {...rest} />;
}

export function Textarea({ className, rows = 3, ...rest }) {
  return <textarea rows={rows} className={cx(fieldBase, 'resize-y leading-relaxed', className)} {...rest} />;
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={cx(fieldBase, 'cursor-pointer', className)} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cx(
        'flex items-center gap-3 text-left w-full p-3 rounded-lg border transition',
        checked ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-slate-800 bg-slate-950/50',
      )}
    >
      <span className={cx(
        'relative w-10 h-6 rounded-full transition shrink-0',
        checked ? 'bg-emerald-600' : 'bg-slate-700',
      )}>
        <span className={cx(
          'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all',
          checked ? 'left-[1.15rem]' : 'left-0.5',
        )} />
      </span>
      <span>
        <span className="block text-sm font-bold text-slate-200">{label}</span>
        {hint ? <span className="block text-xs text-slate-500 mt-0.5">{hint}</span> : null}
      </span>
    </button>
  );
}

/**
 * 暗色可搜索下拉框（替代浏览器原生 <datalist>）。
 *
 * 为什么不用 datalist：它的建议列表由浏览器原生渲染，Chrome 下是一块白底面板，
 * CSS 与 color-scheme 都改不动，在暗色站点里非常突兀。这里自绘一个：
 * 输入即过滤、点击/回车选中、点击外部或 Esc 关闭，样式与站点完全统一。
 *
 * @param {string[]} options 候选项
 * @param {(v:string)=>void} onChange 输入变化（自由输入也走这里）
 * @param {(v:string)=>void} [onPick] 点选候选项；给了就只回调它，不再回写 value（适合"选中即加入"场景）
 */
export function Combobox({
  value = '', onChange, onPick, options = [], placeholder, maxLength = 60,
  emptyHint = '没有匹配项，可直接输入', className, inputClassName, disabled, id,
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null);

  const list = useMemo(() => {
    const kw = String(value || '').trim().toLowerCase();
    const uniq = [...new Set(options.filter(Boolean))];
    if (!kw) return uniq;
    return uniq.filter((o) => String(o).toLowerCase().includes(kw));
  }, [options, value]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  useEffect(() => { setHi(0); }, [value, open]);

  const pick = (v) => {
    if (onPick) onPick(v);
    else onChange?.(v);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className={cx('relative', className)}>
      <div className="relative">
        <input
          id={id}
          value={value}
          disabled={disabled}
          maxLength={maxLength}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => { onChange?.(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((i) => Math.min(i + 1, list.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') {
              if (open && list[hi]) { e.preventDefault(); pick(list[hi]); }
            } else if (e.key === 'Escape') setOpen(false);
          }}
          className={cx(fieldBase, 'pr-9', inputClassName)}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-emerald-400 transition"
          aria-label="展开候选"
        >
          <ChevronDown className={cx('w-4 h-4 transition', open && 'rotate-180')} />
        </button>
      </div>

      {open && !disabled ? (
        <div data-combobox-panel className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl py-1">
          {list.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">{emptyHint}</p>
          ) : list.map((o, i) => (
            <button
              key={o}
              type="button"
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(o)}
              className={cx(
                'w-full text-left px-3 py-2 text-sm transition',
                i === hi ? 'bg-emerald-600/20 text-emerald-300' : 'text-slate-200 hover:bg-slate-800',
              )}
            >
              {o}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ 反馈
export function Toast({ toast }) {
  if (!toast) return null;
  const isError = toast.type === 'error';
  return (
    <div className={cx(
      'fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-full shadow-2xl',
      'flex items-center animate-in fade-in font-bold text-sm max-w-[92vw]',
      isError ? 'bg-red-500 text-white' : 'bg-emerald-500 text-slate-950',
    )}>
      {isError ? <AlertCircle className="w-4 h-4 mr-2 shrink-0" /> : <CheckCircle className="w-4 h-4 mr-2 shrink-0" />}
      <span className="truncate">{toast.msg}</span>
    </div>
  );
}

export function ConfirmDialog({ dialog, onClose }) {
  if (!dialog) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-2">{dialog.msg}</h3>
        {dialog.detail ? <p className="text-sm text-slate-400 mb-4">{dialog.detail}</p> : <div className="mb-2" />}
        <div className="flex justify-end space-x-3">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700">取消</button>
          <button
            type="button"
            onClick={() => { dialog.onConfirm(); onClose(); }}
            className={cx('px-4 py-2 rounded-lg font-bold', dialog.danger === false ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white')}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
      <div className={cx('bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl my-8 w-full animate-in fade-in', wide ? 'max-w-4xl' : 'max-w-xl')}>
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, desc, action }) {
  return (
    <div className="text-center py-16 px-4">
      {Icon ? <Icon className="w-12 h-12 mx-auto text-slate-700 mb-4" /> : null}
      <p className="text-slate-300 font-bold text-lg">{title}</p>
      {desc ? <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">{desc}</p> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function WarningList({ items, title = '规则提示' }) {
  if (!items || items.length === 0) {
    return (
      <div className="flex items-center gap-2 text-emerald-400 text-sm">
        <CheckCircle className="w-4 h-4" /> 所有规则校验通过
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <p className="text-amber-400 font-bold text-sm mb-2 flex items-center">
        <AlertCircle className="w-4 h-4 mr-1.5" />{title}（{items.length}）
      </p>
      <ul className="space-y-1">
        {items.map((w, i) => (
          <li key={i} className="text-sm text-amber-200/90 flex">
            <span className="mr-2 text-amber-500">•</span><span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 数值输入（供属性/技能点/年龄使用，禁止滚轮误改）。
 *
 * ⚠️ 不要在每次按键时就 Math.max/min 钳制：用户想输入「25」时，按下「2」会被立刻夹成 15
 * （年龄输入框就是这么变成 15 / 120 的）。这里改成：
 *  - 合法输入实时同步给父组件（合计/派生值照常即时刷新）；
 *  - 只输入了一半（如 15 的「1」）时保留原文，等失焦或回车再夹到合法区间。
 */
export function NumberInput({ value, onChange, min = 0, max = 99, className, ...rest }) {
  const [draft, setDraft] = useState(null);
  const shown = draft !== null ? draft : (value === 0 || value ? String(value) : '');

  const commit = (raw) => {
    setDraft(null);
    if (raw === '') { onChange(''); return; }
    const n = Math.trunc(Number(raw));
    if (!Number.isFinite(n)) { onChange(''); return; }
    onChange(Math.max(min, Math.min(max, n)));
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      value={shown}
      min={min}
      max={max}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw === '') return;                       // 允许清空后重新输入
        const n = Math.trunc(Number(raw));
        if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      onWheel={(e) => e.currentTarget.blur()}
      className={cx(fieldBase, 'text-center font-mono', className)}
      {...rest}
    />
  );
}
