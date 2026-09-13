/**
 * 角色卡打印版面（A4，双页），对标官方《1920s 调查员》纸质卡的栏目结构。
 *
 * 为什么用「浏览器打印」而不是截图导出：
 *   - 纸质卡本来就是给人打印的，浏览器的「打印 / 另存为 PDF」输出的是矢量文字，清晰且可搜索；
 *   - 不需要引入 html2canvas/html-to-image 之类的第三方脚本，也就不必为了导出功能放开 CSP。
 *
 * 版面设计要点：
 *   - 字号整体上调（技能 9px → 11px，其它栏目同步放大），仍保证第一页容纳全部栏目；
 *   - **全部技能都会打印**并标出括号内的基础值；专攻技能只有选了方向才打印；
 *   - **已分配点数的技能排在前面并加浅底加粗**，未动过的默认技能排在后面，一眼能看出这张卡"练了什么"；
 *   - 每个技能前有一个小方块 ☐，玩家可在游戏里勾选"本局大成功"（与官方纸质卡一致）；
 *   - 消费水平 / 现金 / 资产由信用评级自动算出，另留一栏「额外资产」；
 *   - 审核状态与 KP 批复不属于角色卡本体，永远不会出现在打印件上。
 */

import React, { useMemo } from 'react';
import { BACKGROUND_FIELDS, ALL_CHARS, CHAR_LABEL, STATUS_LABEL } from '../../../shared/coc7e.js';

function Line({ value, className = '' }) {
  return (
    // ⚠️ 必须单行：whitespace-nowrap + 定宽 + 超出裁切，否则长姓名/长住地会折行把基础信息撑成两行
    <span
      title={typeof value === 'string' ? value : undefined}
      className={`inline-block border-b border-gray-400 align-bottom min-w-[2rem] px-1 whitespace-nowrap overflow-hidden text-ellipsis ${className}`}
    >
      {value || '\u00a0'}
    </span>
  );
}

function Box({ label, value, sub }) {
  return (
    <div className="border border-gray-500 rounded px-1.5 py-1 text-center leading-tight">
      <div className="text-[10.5px] text-gray-600">{label}</div>
      <div className="text-[19px] font-bold font-mono">{value ?? '—'}</div>
      {sub ? <div className="text-[10.5px] text-gray-500">{sub}</div> : null}
    </div>
  );
}

/**
 * 技能表的一列。
 * 已投点的技能加浅底 + 加粗；每行前面留一个 ☐ 供玩家标记本局大成功。
 */
function SkillColumn({ skills }) {
  return (
    // table-fixed + colgroup：列宽固定、技能名单行裁切 —— 保证「一个技能一行」
    <table className="w-full text-[12.5px] border-collapse table-fixed">
      <colgroup>
        <col style={{ width: '15px' }} />
        <col style={{ width: '11px' }} />
        <col />
        <col style={{ width: '40px' }} />
        <col style={{ width: '35px' }} />
      </colgroup>
      <tbody>
        {skills.map((s) => {
          const allocated = s.occ > 0 || s.interest > 0 || s.growth > 0;
          // 名字长的（「操作重型机械」「外语（拉丁语）」等）自动缩一档，尽量不被裁切
          const label = `${s.name}（${s.base}%）`;
          const tight = label.length >= 11;
          return (
            <tr
              key={s.id}
              className={`border-b border-gray-300 ${allocated ? 'bg-gray-100 font-bold' : ''}`}
            >
              <td className="py-[1.5px] align-middle text-[15px] leading-none">{s.marked ? '☑' : '☐'}</td>
              <td className="py-[1.5px] text-gray-500">{s.isOccupation ? '★' : (s.kind === 'custom' ? '✎' : '')}</td>
              <td className={`py-[1.5px] pr-1 whitespace-nowrap overflow-hidden text-ellipsis ${tight ? 'text-[11px]' : ''}`}>
                <span title={label}>{s.name}</span>
                <span className="text-gray-500 font-normal">（{s.base}%）</span>
              </td>
              <td className="py-[1.5px] text-right font-mono whitespace-nowrap text-gray-500 font-normal">
                {s.half}/{s.fifth}
              </td>
              <td className="py-[1.5px] text-right font-mono whitespace-nowrap">{s.total}%</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function CharacterPrint({ character }) {
  const printedAt = useMemo(() => new Date().toLocaleDateString(), []);
  if (!character?.derived) return null;
  const d = character.derived;

  // 全部技能：专攻槽位只有填了方向才打印；已投点的排前面
  const printable = d.skills.filter((s) => (s.spec ? Boolean(s.custom) : true));
  const allocated = printable.filter((s) => s.occ > 0 || s.interest > 0 || s.growth > 0 || s.marked);
  const untouched = printable.filter((s) => !(s.occ > 0 || s.interest > 0 || s.growth > 0 || s.marked));
  const ordered = [...allocated, ...untouched];
  const per = Math.ceil(ordered.length / 3) || 1;
  const cols = [ordered.slice(0, per), ordered.slice(per, per * 2), ordered.slice(per * 2)];

  const w = d.wealth || { level: '—', cashText: '—', assetsText: '—' };

  return (
    <div className="print-root text-gray-900">
      {/* ============================ 第 1 页 ============================ */}
      <section className="print-paper print-page">
        <div className="border-2 border-double border-gray-700 p-3">
          <div className="text-center border-b-2 border-gray-700 pb-1 mb-2">
            <div className="text-[12.5px] tracking-[0.5em] text-gray-600">{character.era || '1920s'} 调查员</div>
            <div className="text-2xl font-black tracking-[0.3em]">COC 七版 角色卡</div>
          </div>

          {/* 基本信息 */}
          <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-[12.5px] mb-2">
            <div className="whitespace-nowrap">姓名：<Line value={character.name} className="w-[8.6rem]" /></div>
            <div className="whitespace-nowrap">玩家：<Line value={character.playerName} className="w-[7.4rem]" /></div>
            <div className="whitespace-nowrap">职业：<Line value={d.occupation?.name || '无'} className="w-[7.4rem]" /></div>
            <div className="whitespace-nowrap">年龄：<Line value={character.age} className="w-[3rem]" /></div>
            <div className="whitespace-nowrap">性别：<Line value={character.gender} className="w-[3.4rem]" /></div>
            <div className="whitespace-nowrap">住地：<Line value={character.residence} className="w-[7.4rem]" /></div>
            <div className="whitespace-nowrap">故乡：<Line value={character.birthplace} className="w-[7.4rem]" /></div>
            <div className="whitespace-nowrap">时代：<Line value={character.era} className="w-[5rem]" /></div>
            <div className="whitespace-nowrap">状态：<Line value={STATUS_LABEL[character.status] || ''} className="w-[5rem]" /></div>
          </div>

          {/* 属性 */}
          <div className="grid grid-cols-9 gap-1 mb-2">
            {ALL_CHARS.filter((k) => k !== 'Luck').map((k) => (
              <Box key={k} label={`${CHAR_LABEL[k]} ${k}`} value={d.eff[k]} sub={`${d.half[k]}/${d.fifth[k]}`} />
            ))}
            <Box label="幸运 LUCK" value={d.eff.Luck} sub={`${d.half.Luck}/${d.fifth.Luck}`} />
          </div>

          {/* 派生值 */}
          <div className="grid grid-cols-6 gap-1 mb-2">
            <Box label="生命值 HP" value={d.hp} />
            <Box label="重伤值" value={Math.ceil(d.hp / 2)} />
            <Box label="魔法点 MP" value={d.mp} />
            <Box label="理智 SAN" value={d.san} />
            <Box label="移动力 MOV" value={d.mov} />
            <Box label="伤害加值 / 体格" value={`${d.db} / ${d.build}`} />
          </div>

          {/* 技能 */}
          <div className="border border-gray-500 rounded">
            <div className="bg-gray-200 px-2 py-1 text-[12.5px] font-bold flex justify-between flex-wrap gap-2">
              <span>调查员技能（★本职 · ✎自定义 · 加粗=已投点 · ☐=本局大成功标记 · 括号内为基础值）</span>
              <span className="font-normal text-gray-600">
                职业 {d.spent.occupation}/{d.budget.occupation} · 兴趣 {d.spent.interest}/{d.budget.interest}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-x-2 px-1.5 py-1.5">
              {cols.map((col, i) => <SkillColumn key={i} skills={col} />)}
            </div>
          </div>

          {/* 武器 */}
          <div className="border border-gray-500 rounded mt-2">
            <div className="bg-gray-200 px-2 py-1 text-[12.5px] font-bold">武器</div>
            <table className="w-full text-[11.5px] border-collapse">
              <thead>
                <tr className="border-b border-gray-400 text-gray-600">
                  <th className="text-left px-2 py-[2px]">武器名称</th>
                  <th className="text-left px-2 py-[2px]">使用技能</th>
                  <th className="text-left px-2 py-[2px]">伤害</th>
                  <th className="text-left px-2 py-[2px]">射程</th>
                  <th className="text-left px-2 py-[2px]">每轮攻击</th>
                  <th className="text-left px-2 py-[2px]">装弹量</th>
                  <th className="text-left px-2 py-[2px]">故障值</th>
                </tr>
              </thead>
              <tbody>
                {(character.weapons || []).map((row, i) => (
                  <tr key={`${row.name}-${i}`} className="border-b border-gray-200">
                    <td className="px-2 py-[3px] font-bold">{row.name}</td>
                    <td className="px-2 py-[3px]">{row.skill}</td>
                    <td className="px-2 py-[3px]">{row.damage}</td>
                    <td className="px-2 py-[3px]">{row.range}</td>
                    <td className="px-2 py-[3px]">{row.attacks}</td>
                    <td className="px-2 py-[3px]">{row.ammo}</td>
                    <td className="px-2 py-[3px]">{row.malfunction}</td>
                  </tr>
                ))}
                {Array.from({ length: Math.max(0, 4 - (character.weapons || []).length) }).map((_, i) => (
                  <tr key={`e${i}`} className="border-b border-gray-200">
                    {Array.from({ length: 7 }).map((__, j) => <td key={j} className="px-2 py-[8px]" />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[10.5px] text-gray-500 mt-1.5 text-center">
            {character.ownerName || character.playerName || ''} · 由「秘密调查档案馆」生成 · {printedAt}
          </div>
        </div>
      </section>

      {/* ============================ 第 2 页 ============================ */}
      <section className="print-paper print-page">
        <div className="border-2 border-double border-gray-700 p-3 h-full flex flex-col">
          <div className="text-center border-b-2 border-gray-700 pb-1 mb-2">
            <div className="text-xl font-black tracking-[0.3em]">背景故事</div>
            <div className="text-[11.5px] text-gray-500">
              {character.name}{character.playerName ? ` · ${character.playerName}` : ''}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {BACKGROUND_FIELDS.map(([key, label]) => (
              <div key={key} className="print-avoid-break">
                <div className="text-[12.5px] font-bold border-b border-gray-400 mb-[2px]">{label}</div>
                <div className="text-[11.5px] leading-[1.55] whitespace-pre-wrap min-h-[2.9rem]">
                  {character.background?.[key] || ''}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="border border-gray-500 rounded">
              <div className="bg-gray-200 px-2 py-1 text-[12.5px] font-bold">装备和物品</div>
              <div className="p-2 text-[11.5px] leading-[1.65] whitespace-pre-wrap min-h-[5.5rem]">{character.equipment || ''}</div>
            </div>
            <div className="border border-gray-500 rounded">
              <div className="bg-gray-200 px-2 py-1 text-[12.5px] font-bold flex justify-between">
                <span>资产</span>
                <span className="font-normal text-gray-600">按信用评级自动计算</span>
              </div>
              <div className="p-2 text-[11.5px] space-y-1">
                <div>时代 / 货币：<b>{character.era} · {w.currencyLabel || ''}</b></div>
                <div>消费水平：<b>{w.level}</b><span className="mx-2">·</span>信用评级：<b className="font-mono">{d.creditRating}%</b>
                  {d.occupation ? <span className="text-gray-500">（{d.occupation.cr[0]}-{d.occupation.cr[1]}）</span> : null}
                </div>
                <div>现金：<b className="font-mono">{w.cashText}</b><span className="mx-2">·</span>资产：<b className="font-mono">{w.assetsText}</b></div>
                <div className="pt-1 border-t border-gray-300">
                  额外资产：<span className="whitespace-pre-wrap">{character.extraAssets || '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 经历：模组关联 */}
          <div className="border border-gray-500 rounded mt-3 flex-1">
            <div className="bg-gray-200 px-2 py-1 text-[12.5px] font-bold flex justify-between">
              <span>经历（跑团记录）</span>
              <span className="font-normal text-gray-600">共 {(character.moduleLinks || []).length} 个模组</span>
            </div>
            <table className="w-full text-[11.5px] border-collapse">
              <thead>
                <tr className="border-b border-gray-400 text-gray-600">
                  <th className="text-left px-2 py-[2px] w-[22%]">日期</th>
                  <th className="text-left px-2 py-[2px]">模组</th>
                  <th className="text-left px-2 py-[2px] w-[12%]">身份</th>
                  <th className="text-left px-2 py-[2px] w-[38%]">备注</th>
                </tr>
              </thead>
              <tbody>
                {(character.moduleLinks || []).map((l) => (
                  <tr key={l.moduleId} className="border-b border-gray-200">
                    <td className="px-2 py-[3px] font-mono">{l.date || ''}</td>
                    <td className="px-2 py-[3px]">{l.moduleTitle}</td>
                    <td className="px-2 py-[3px]">{l.role}</td>
                    <td className="px-2 py-[3px]">{l.note || ''}</td>
                  </tr>
                ))}
                {(character.moduleLinks || []).length === 0 && (
                  <tr><td colSpan={4} className="px-2 py-3 text-center text-gray-400">暂无记录</td></tr>
                )}
              </tbody>
            </table>
            {character.experience ? (
              <div className="p-2 text-[11.5px] leading-[1.65] whitespace-pre-wrap border-t border-gray-300">
                {character.experience}
              </div>
            ) : null}
          </div>

          <div className="text-[10.5px] text-gray-500 mt-1.5 text-center">
            角色卡由「秘密调查档案馆」生成 · COC 第 7 版规则
          </div>
        </div>
      </section>
    </div>
  );
}
