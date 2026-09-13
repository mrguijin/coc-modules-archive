/**
 * 模组封面装饰层 ——「档案封印」风格。
 *
 * 设计目标：在**保留每个模组原有主题渐变**的前提下，把它做成一份正式卷宗：
 *   1. 斜纹网纹 + 径向暗角，让纯色渐变有纸质/布纹质感
 *   2. 双线内框 + 四角 L 形装饰角标（古籍装帧的角花）
 *   3. 档案编号（取模组 id 末尾生成，纯装饰）
 *   4. 蜡封印章：双环 + 盾形纹章，暗示"已归档封存"
 *
 * 用法：作为**绝对定位的装饰层**放进已有的封面容器里，
 * 调用方的实际内容（标题、徽章、按钮）保持原有 z-10 层级即可压在装饰之上。
 *
 * <div className="relative h-56 bg-gradient-to-br ...">
 *   <CoverArt module={m} variant="card" />
 *   ...原有内容...
 * </div>
 */

import React from 'react';
import { Shield } from 'lucide-react';

/** 由模组 id 生成一枚稳定的档案编号（纯展示，无业务含义） */
export function fileNumberOf(module) {
  const raw = String(module?.id || '').replace(/^[a-z]+_/, '');
  const tail = (raw.slice(-6) || '000000').toUpperCase();
  return `NO.${tail}`;
}

/** 烫金分隔线：放在标题下方，给"档案抬头"收个尾 */
export function GoldDivider({ className = '' }) {
  return (
    <div className={`flex items-center justify-center gap-1.5 ${className}`} aria-hidden="true">
      <span className="h-px w-10 bg-gradient-to-r from-transparent to-amber-300/70" />
      <span className="w-1.5 h-1.5 rotate-45 bg-amber-300/80" />
      <span className="h-px w-10 bg-gradient-to-l from-transparent to-amber-300/70" />
    </div>
  );
}

/** 蜡封印章 */
function WaxSeal({ className, size = 'md' }) {
  const outer = size === 'lg' ? 'w-14 h-14' : 'w-11 h-11';
  const inner = size === 'lg' ? 'w-10 h-10' : 'w-8 h-8';
  const icon = size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';
  return (
    <div className={`absolute ${className} ${outer} rounded-full flex items-center justify-center
      bg-gradient-to-br from-amber-700/70 to-red-900/70
      border border-amber-200/40 shadow-[inset_0_1px_3px_rgba(0,0,0,.5),0_2px_8px_rgba(0,0,0,.45)]`}
    >
      <span className={`${inner} rounded-full border border-amber-200/30 flex items-center justify-center`}>
        <Shield className={`${icon} text-amber-100/70`} />
      </span>
    </div>
  );
}

/**
 * @param {object} module 模组对象（用到 id）
 * @param {'card'|'hero'} variant 卡片封面 / 详情页头图
 */
export default function CoverArt({ module, variant = 'card' }) {
  const hero = variant === 'hero';
  const borderInset = hero ? 'inset-3' : 'inset-2';
  const borderInset2 = hero ? 'inset-[15px]' : 'inset-[10px]';
  const cornerInset = hero ? 12 : 8;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      {/* 压暗底色，保证白字对比度 */}
      <div className={hero ? 'absolute inset-0 bg-black/45' : 'absolute inset-0 bg-black/35'} />

      {/* 斜纹网纹（布纹/纸纹质感） */}
      <div
        className="absolute inset-0 opacity-[0.13] mix-blend-overlay"
        style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,.75) 0 1px, transparent 1px 8px)' }}
      />
      {/* 交叉细网，避免斜纹过于单调 */}
      <div
        className="absolute inset-0 opacity-[0.06] mix-blend-overlay"
        style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.7) 0 1px, transparent 1px 14px)' }}
      />

      {/* 径向暗角 */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 45%, transparent 32%, rgba(2,6,23,.62) 100%)' }}
      />

      {/* 双线内框 */}
      <div className={`absolute ${borderInset} border border-white/25`} />
      <div className={`absolute ${borderInset2} border border-white/10`} />

      {/* 四角 L 形角标 */}
      <span className="absolute w-3.5 h-3.5 border-t border-l border-amber-200/45" style={{ top: cornerInset, left: cornerInset }} />
      <span className="absolute w-3.5 h-3.5 border-t border-r border-amber-200/45" style={{ top: cornerInset, right: cornerInset }} />
      <span className="absolute w-3.5 h-3.5 border-b border-l border-amber-200/45" style={{ bottom: cornerInset, left: cornerInset }} />
      <span className="absolute w-3.5 h-3.5 border-b border-r border-amber-200/45" style={{ bottom: cornerInset, right: cornerInset }} />

      {/* 档案编号 + 蜡封：卡片与头图的空位不同，分开摆位避免挡住内容 */}
      {hero ? (
        <>
          <span className="absolute top-6 left-7 font-mono text-[10px] tracking-[0.3em] text-amber-200/45">
            档案编号 {fileNumberOf(module)}
          </span>
          <WaxSeal className="top-6 right-7" size="lg" />
        </>
      ) : (
        <>
          <span className="absolute bottom-2.5 left-3.5 font-mono text-[9px] tracking-[0.25em] text-amber-200/40">
            {fileNumberOf(module)}
          </span>
          <WaxSeal className="bottom-2.5 right-3" />
        </>
      )}
    </div>
  );
}
