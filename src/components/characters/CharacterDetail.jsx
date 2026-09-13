/**
 * 角色卡详情（只读展示）＋「经历」模组关联 ＋ 送审 / KP 批复。
 *
 * 权限：
 *   - 玩家：可查看自己的卡（以及被 KP 设为公开的卡），可增删模组关联、提交审核。
 *   - KP：可查看与修改所有人的卡，代记经历，并直接在详情页批复。
 * 服务端对每个写操作都会再次校验归属，前端按钮的显隐只是体验优化。
 *
 * 注意：审核状态与批复**不属于角色卡本体**，只用于流程沟通，永远不会被打印导出。
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, BookOpen, Calendar, CheckCircle, ClipboardCheck, Crown, Edit, ExternalLink,
  FileText, Link2, Plus, Printer, ScrollText, Send, Share2, Shield, Sword, Trash2, Undo2,
  User as UserIcon, Wand2, XCircle,
} from 'lucide-react';
import {
  ALL_CHARS, BACKGROUND_FIELDS, CHAR_LABEL, MODULE_ROLES, REVIEW_LABEL,
  SKILL_BY_KEY, STATUS_LABEL, grantEduReroll, resetEduGrowth,
} from '../../../shared/coc7e.js';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api.js';
import {
  Badge, Button, EmptyState, Field, Input, Panel, Select, Textarea, WarningList, cx,
} from '../ui.jsx';
import { ExportCardModal } from './CardTransferModal.jsx';

const STATUS_TONE = { draft: 'slate', active: 'emerald', retired: 'amber', dead: 'red' };
const REVIEW_TONE = { none: 'slate', pending: 'amber', approved: 'emerald', rejected: 'red' };

function StatBox({ label, value, sub, tone = 'emerald' }) {
  const tones = { emerald: 'text-emerald-400', amber: 'text-amber-400', cyan: 'text-cyan-300' };
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-center">
      <div className="text-[11px] text-slate-500 mb-0.5">{label}</div>
      <div className={cx('text-xl font-black font-mono', tones[tone])}>{value}</div>
      {sub ? <div className="text-[10px] text-slate-600">{sub}</div> : null}
    </div>
  );
}

/** 规则提示的严重级别配色 */
const FINDING_TONE = {
  error: 'border-red-500/40 bg-red-500/5 text-red-200',
  warn: 'border-amber-500/40 bg-amber-500/5 text-amber-200',
  info: 'border-cyan-500/40 bg-cyan-500/5 text-cyan-200',
};

export default function CharacterDetail({
  characterId, currentUser, showToast, showConfirm, onBack, onEdit, onPrint, onChanged,
  reviewMode = false,
}) {
  const [c, setC] = useState(null);
  const [loading, setLoading] = useState(true);
  const [moduleOptions, setModuleOptions] = useState([]);
  const [linkForm, setLinkForm] = useState({ moduleId: '', role: 'PC', date: '', note: '' });
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState(reviewMode ? 'review' : 'sheet');
  const [rejectComment, setRejectComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setC(await apiGet(`/api/characters/${characterId}`));
    } catch (err) {
      showToast(err.message, 'error');
      onBack?.();
    } finally {
      setLoading(false);
    }
  }, [characterId, showToast, onBack]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiGet('/api/characters/meta')
      .then((m) => setModuleOptions(m.moduleOptions || []))
      .catch(() => { /* ignore */ });
  }, []);

  const addLink = async () => {
    if (!linkForm.moduleId) return showToast('请选择要关联的模组', 'error');
    setAdding(true);
    try {
      const updated = await apiPost(`/api/characters/${c.id}/modules`, linkForm);
      setC(updated);
      setLinkForm({ moduleId: '', role: 'PC', date: '', note: '' });
      showToast('已记入经历');
      onChanged?.();
    } catch (err) {
      showToast(err.message, 'error');
    } finally { setAdding(false); }
  };

  const removeLink = (moduleId, title) => showConfirm(`从经历中移除【${title}】？`, async () => {
    try {
      const updated = await apiDelete(`/api/characters/${c.id}/modules/${moduleId}`);
      setC(updated);
      onChanged?.();
    } catch (err) { showToast(err.message, 'error'); }
  });

  const submitReview = () => showConfirm(
    review?.status === 'rejected' ? '重新提交给 KP 审核？' : '把这张角色卡提交给 KP 审核？',
    async () => {
      try {
        setC(await apiPost(`/api/characters/${c.id}/submit`, {}));
        showToast('已提交审核');
        onChanged?.();
      } catch (err) { showToast(err.message, 'error'); }
    },
    { detail: 'KP 会看到一张只读的角色卡，审核状态与批复不会写进卡里，也不会被打印。', danger: false },
  );

  const withdrawReview = async () => {
    try {
      setC(await apiPost(`/api/characters/${c.id}/withdraw`, {}));
      showToast('已撤回审核');
      onChanged?.();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const doReview = async (verdict) => {
    setBusy(true);
    try {
      const updated = await apiPost(`/api/characters/${c.id}/review`, { verdict, comment: rejectComment });
      setC(updated);
      setRejectComment('');
      showToast(verdict === 'approved' ? '已通过审核' : '已驳回并附上批复');
      onChanged?.();
    } catch (err) {
      showToast(err.message, 'error');
    } finally { setBusy(false); }
  };

  /** KP：授权一次重掷 / 重置教育增强（不必进入编辑器） */
  const grantEdu = async () => {
    try {
      const saved = await apiPatch(`/api/characters/${c.id}`, {
        eduGrowth: grantEduReroll(c.eduGrowth, currentUser?.username || ''),
      });
      setC(saved);
      showToast('已授权一次教育增强重掷');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const resetEdu = async () => {
    try {
      const saved = await apiPatch(`/api/characters/${c.id}`, {
        eduBonus: 0,
        eduGrowth: resetEduGrowth(currentUser?.username || ''),
      });
      setC(saved);
      showToast('已重置教育增强');
    } catch (err) { showToast(err.message, 'error'); }
  };

  if (loading && !c) return <Panel><EmptyState title="正在载入角色卡…" /></Panel>;
  if (!c) return null;

  const d = c.derived;
  const usedSkills = d.skills.filter((s) => s.used || s.occ > 0 || s.interest > 0 || s.growth > 0);
  const review = c.review || { status: 'none' };
  const canReview = c.canReview && review.status === 'pending';
  const legendary = c.legendary || { enabled: false };
  const legendaryBonus = c.legendaryBonus || {};
  const eduGrowth = c.eduGrowth || {};

  return (
    <div className="space-y-5">
      {/* 头部 */}
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <Button variant="ghost" onClick={onBack} className="!p-2.5"><ArrowLeft className="w-4 h-4" /></Button>
            <div>
              <h2 className="text-3xl font-black text-white flex items-center gap-3 flex-wrap">
                {c.name}
                <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                {review.status !== 'none' ? (
                  <Badge tone={REVIEW_TONE[review.status]}>{REVIEW_LABEL[review.status]}</Badge>
                ) : null}
                {c.isPublic ? <Badge tone="cyan">公开只读</Badge> : null}
              </h2>
              <p className="text-slate-400 text-sm mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1"><UserIcon className="w-3.5 h-3.5" />{c.ownerName}</span>
                <span>{d.occupation?.name || '无职业'}</span>
                <span>{c.age} 岁</span>
                <span>{c.era}</span>
                {c.gender ? <span>{c.gender}</span> : null}
                {c.residence ? <span>住地 {c.residence}</span> : null}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" onClick={() => setExportOpen(true)}><Share2 className="w-4 h-4" />导出编码 / 骰娘指令</Button>
            <Button variant="ghost" onClick={() => onPrint(c)}><Printer className="w-4 h-4" />打印 / 导出 PDF</Button>
            {c.isOwner && (review.status === 'none' || review.status === 'rejected') ? (
              <Button variant="amber" onClick={submitReview}>
                <Send className="w-4 h-4" />{review.status === 'rejected' ? '修改后重新提交' : '提交 KP 审核'}
              </Button>
            ) : null}
            {c.isOwner && review.status === 'pending' ? (
              <Button variant="ghost" onClick={withdrawReview}><Undo2 className="w-4 h-4" />撤回审核</Button>
            ) : null}
            {c.canEdit ? <Button onClick={() => onEdit(c)}><Edit className="w-4 h-4" />编辑</Button> : null}
          </div>
        </div>

        {/* 驳回批复：只在这里显示，不进角色卡、不打印 */}
        {review.status === 'rejected' && review.comment ? (
          <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/5 p-4">
            <div className="text-red-300 font-bold text-sm mb-1 flex items-center gap-2">
              <XCircle className="w-4 h-4" />KP 批复（{review.reviewedByName || 'KP'} · {review.reviewedAt ? new Date(review.reviewedAt).toLocaleString() : ''}）
            </div>
            <p className="text-red-100 text-sm whitespace-pre-wrap leading-relaxed">{review.comment}</p>
            <p className="text-[11px] text-red-300/70 mt-2">批复只用于沟通，不会出现在角色卡或打印件上。</p>
          </div>
        ) : null}
        {review.status === 'approved' ? (
          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-200 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            已通过 KP 审核{review.reviewedByName ? `（${review.reviewedByName}）` : ''}。批复在通过时已清空。
          </div>
        ) : null}
        {review.status === 'pending' ? (
          <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-200 flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4" />已提交审核，等待 KP 批复。
          </div>
        ) : null}
      </Panel>

      {/* 派生值 */}
      <Panel className="p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <StatBox label="生命值 HP" value={d.hp} />
          <StatBox label="魔法点 MP" value={d.mp} />
          <StatBox label="理智 SAN" value={d.san} />
          <StatBox label="移动力 MOV" value={d.mov} />
          <StatBox label="伤害加值" value={d.db} tone="amber" />
          <StatBox label="体格" value={d.build} tone="amber" />
          <StatBox
            label="信用评级"
            value={`${d.creditRating}%`}
            sub={d.creditRange ? `要求 ${d.creditRange[0]}-${d.creditRange[1]}%` : ''}
            tone={d.creditInRange === false ? 'amber' : 'cyan'}
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-3 text-xs text-slate-400">
          <div>职业技能点：<b className="text-white font-mono">{d.spent.occupation}</b> / {d.budget.occupation}</div>
          <div>兴趣技能点：<b className="text-white font-mono">{d.spent.interest}</b> / {d.budget.interest}（智力×2）</div>
        </div>
        <WarningList items={c.warnings} />
      </Panel>

      {/* KP 审核面板 */}
      {c.canReview ? (
        <Panel className="p-5 space-y-4 border-amber-500/30">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h3 className="font-bold text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" />KP 审核区
              <span className="text-xs font-normal text-slate-500">仅 KP 可见 · 不影响玩家看到的角色卡内容</span>
            </h3>
            {c.audit ? (
              <Badge tone={c.audit.passed ? 'emerald' : 'red'}>
                规则判定：{c.audit.passed ? '通过' : '不合规'}
              </Badge>
            ) : null}
          </div>

          {c.audit ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                  <div className="text-slate-500">属性总和</div>
                  <div className="font-mono font-black text-white">{c.audit.stats.charTotal}</div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                  <div className="text-slate-500">职业点</div>
                  <div className="font-mono font-black text-white">{c.audit.stats.occupationPoints} / {c.audit.stats.occupationBudget}</div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                  <div className="text-slate-500">兴趣点</div>
                  <div className="font-mono font-black text-white">{c.audit.stats.interestPoints} / {c.audit.stats.interestBudget}</div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                  <div className="text-slate-500">自定义技能</div>
                  <div className="font-mono font-black text-white">{c.audit.stats.customSkillCount}</div>
                </div>
              </div>

              {c.audit.findings.length > 0 ? (
                <ul className="space-y-1.5">
                  {c.audit.findings.map((f, i) => (
                    <li key={`${f.id}-${i}`} className={cx('rounded-lg border p-2.5 text-sm', FINDING_TONE[f.level])}>
                      <b>{f.label}</b>：{f.detail}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-emerald-400 flex items-center gap-1.5"><CheckCircle className="w-4 h-4" />按当前规则未发现问题</p>
              )}
            </div>
          ) : null}

          {canReview ? (
            <div className="border-t border-slate-800 pt-4 space-y-3">
              <Field label="驳回时的批复" hint="通过时批复会被清空，不需要填写">
                <Textarea
                  rows={2}
                  maxLength={500}
                  value={rejectComment}
                  onChange={(e) => setRejectComment(e.target.value)}
                  placeholder="例：力量 90 偏高，请把属性总和控制在 600 以内"
                />
              </Field>
              <div className="flex gap-2">
                <Button onClick={() => doReview('approved')} disabled={busy}>
                  <CheckCircle className="w-4 h-4" />通过审核
                </Button>
                <Button variant="danger" onClick={() => doReview('rejected')} disabled={busy || !rejectComment.trim()}>
                  <XCircle className="w-4 h-4" />驳回并批复
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              {review.status === 'pending' ? '该卡处于待审核状态，可在上方直接批复。' : '该卡当前不在待审核队列中。'}
            </p>
          )}

          {c.reviewHistory?.length ? (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer hover:text-slate-300">审核历史（{c.reviewHistory.length}）</summary>
              <ul className="mt-2 space-y-1">
                {c.reviewHistory.map((h) => (
                  <li key={h.id}>
                    {new Date(h.createdAt).toLocaleString()} · {h.kpName} ·{' '}
                    <span className={h.verdict === 'approved' ? 'text-emerald-400' : 'text-red-400'}>
                      {h.verdict === 'approved' ? '通过' : '驳回'}
                    </span>
                    {h.comment ? `：${h.comment}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Panel>
      ) : null}

      {/* 分页 */}
      <div className="flex gap-1 border-b border-slate-800">
        {[['sheet', '属性与技能', Wand2], ['story', '背景故事', BookOpen], ['journal', '装备与经历', ScrollText]].map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cx('px-4 py-3 font-bold text-sm flex items-center gap-2 border-b-2 -mb-px transition',
              tab === k ? 'text-emerald-400 border-emerald-500' : 'text-slate-500 border-transparent hover:text-slate-300')}
          >
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'sheet' && (
        <div className="space-y-5 animate-in fade-in">
          <Panel className="p-5">
            <h3 className="font-bold text-white mb-4">属性</h3>
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
              {ALL_CHARS.map((k) => (
                <div key={k} className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-2.5 text-center">
                  <div className="text-[10px] text-slate-500">{CHAR_LABEL[k]}</div>
                  <div className={cx('text-lg font-black font-mono', d.eff[k] !== d.raw[k] ? 'text-amber-400' : 'text-white')}>
                    {d.eff[k]}
                  </div>
                  <div className="text-[10px] text-slate-600 font-mono">基础 {d.raw[k]}</div>
                  {legendary.enabled ? (
                    <div className="text-[10px] text-fuchsia-400 font-mono">传奇 +{legendaryBonus[k] || 0}</div>
                  ) : null}
                  <div className="text-[10px] text-slate-600 font-mono">{d.half[k]}/{d.fifth[k]}</div>
                </div>
              ))}
            </div>
            {legendary.enabled ? (
              <div className="mt-3 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 p-3 text-xs text-fuchsia-200 flex items-start gap-2">
                <Crown className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  KP 已开启<b>传奇标记</b>：允许突破属性 99 上限，上表「传奇 +N」是额外调整值（单独一栏，不与掷骰属性混用）。
                  {legendary.note ? ` 备注：${legendary.note}` : ''}
                  {legendary.by ? `（${legendary.by}${legendary.at ? ` · ${new Date(legendary.at).toLocaleDateString('zh-CN')}` : ''}）` : ''}
                </span>
              </div>
            ) : null}
            {c.agePenaltyWaived ? (
              <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-200">
                KP 已豁免这张卡的年龄减益：属性不因年龄下降、移动力不减，教育成长照常保留。
              </div>
            ) : null}
            {d.ageAdjust.label ? (
              <p className="text-xs text-slate-500 mt-3">
                年龄补正：{d.ageAdjust.apply ? d.ageAdjust.label : '已关闭'}
                {d.ageAdjust.apply && !c.agePenaltyWaived && d.ageAdjust.poolPoints > 0
                  ? ` · 分配：${d.ageAdjust.poolKeys.map((k) => `${CHAR_LABEL[k]} −${d.ageAdjust.alloc[k] || 0}`).join('，')}`
                  : ''}
                {` · 教育增强 +${d.ageAdjust.eduBonus}`}
              </p>
            ) : null}
            <div className="mt-2 text-xs text-slate-500 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span>教育增强记录：</span>
                {eduGrowth.settled ? <Badge tone="emerald">已结算</Badge> : <Badge tone="amber">未结算</Badge>}
                {eduGrowth.settled && (eduGrowth.granted || 0) <= 0 ? <Badge tone="slate">已锁定</Badge> : null}
                {(eduGrowth.granted || 0) > 0 ? <Badge tone="cyan">KP 已授权 {eduGrowth.granted} 次重掷</Badge> : null}
                {(eduGrowth.rerolls || 0) > 0 ? <Badge tone="amber">已重掷 {eduGrowth.rerolls} 次</Badge> : null}
                {!eduGrowth.settled ? (
                  <span className="text-amber-400">该年龄需要 {d.ageAdjust.eduChecks} 次教育增强检定</span>
                ) : null}
              </div>
              {(eduGrowth.attempts || []).length > 0 ? (
                <div className="space-y-0.5">
                  {(eduGrowth.attempts || []).map((a, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-x-2">
                      <span className="text-slate-600">#{i + 1}</span>
                      <span className={cx('px-1.5 py-0.5 rounded border text-[10px]',
                        a.via === 'manual' ? 'border-cyan-600/50 text-cyan-300'
                          : a.via === 'reroll' ? 'border-amber-500/40 text-amber-300'
                            : 'border-slate-700 text-slate-400')}
                      >
                        {a.via === 'manual' ? '手动录入' : a.via === 'reroll' ? '授权重掷' : '自动检定'}
                      </span>
                      {a.manual ? null : <span>检定 {a.count} 次</span>}
                      <span>提升 <b className="font-mono text-cyan-300">+{a.gain}</b></span>
                      <span className="text-slate-600">累计 {a.totalAfter}</span>
                      {a.by ? <span className="text-slate-600">by {a.by}</span> : null}
                      {a.at ? <span className="text-slate-600">{new Date(a.at).toLocaleString('zh-CN')}</span> : null}
                      {a.rolls?.length ? (
                        <span className="font-mono text-slate-500">{a.rolls.map((r) => `D100=${r.roll}→+${r.gain}`).join('、')}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {currentUser?.role === 'admin' ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button variant="subtle" onClick={grantEdu}>授权重掷一次</Button>
                  <Button variant="subtle" onClick={resetEdu}>重置教育增强</Button>
                  <span className="text-[11px] text-slate-600">
                    玩家已结算后不能自助重掷；授权会在他下次结算时消耗一次，并记入流水。
                  </span>
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel className="p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="font-bold text-white flex items-center"><Wand2 className="w-4 h-4 mr-2 text-emerald-500" />技能（{usedSkills.length}）</h3>
              <span className="text-xs text-slate-500">★ = 本职技能 · ✎ = 自定义技能 · 打印时会列出全部技能与基础值</span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-sm min-w-[620px]">
                <thead className="bg-slate-950 text-slate-400 text-xs">
                  <tr>
                    <th className="p-3 text-left">技能</th>
                    <th className="p-3 w-20 text-center">基础</th>
                    <th className="p-3 w-20 text-center">职业</th>
                    <th className="p-3 w-20 text-center">兴趣</th>
                    <th className="p-3 w-20 text-center">成长</th>
                    <th className="p-3 w-24 text-center">成功率</th>
                    <th className="p-3 w-24 text-center">困难/极难</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {usedSkills.map((s) => (
                    <tr
                      key={s.id}
                      className={cx(
                        s.isOccupation && 'bg-emerald-500/[0.03]',
                        s.special === 'credit' && 'bg-amber-500/[0.06]',
                        s.special === 'cthulhu' && 'bg-fuchsia-500/[0.06]',
                      )}
                    >
                      <td className="p-3 text-slate-200">
                        {s.kind === 'custom'
                          ? <span className="text-cyan-400 mr-1.5">✎</span>
                          : (s.isOccupation ? <span className="text-emerald-500 mr-1.5">★</span> : <span className="text-slate-700 mr-1.5">·</span>)}
                        <span className={cx(s.special && 'font-bold text-white')}>{s.name}</span>
                      </td>
                      <td className="p-3 text-center font-mono text-slate-500">{s.base}</td>
                      <td className="p-3 text-center font-mono text-slate-300">{s.occ || '-'}</td>
                      <td className="p-3 text-center font-mono text-slate-300">{s.interest || '-'}</td>
                      <td className="p-3 text-center font-mono text-slate-300">{s.growth || '-'}</td>
                      <td className="p-3 text-center font-mono font-black text-emerald-400">{s.total}%</td>
                      <td className="p-3 text-center font-mono text-slate-400">{s.half} / {s.fifth}</td>
                    </tr>
                  ))}
                  {usedSkills.length === 0 && (
                    <tr><td colSpan={7} className="p-8 text-center text-slate-500">还没有分配任何技能点</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel className="p-5">
            <h3 className="font-bold text-white flex items-center mb-4"><Sword className="w-4 h-4 mr-2 text-emerald-500" />武器</h3>
            {(c.weapons || []).length === 0 ? (
              <p className="text-sm text-slate-500">未登记武器</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="bg-slate-950 text-slate-400 text-xs">
                    <tr>{['武器', '技能', '伤害', '射程', '攻击', '装弹', '故障'].map((h) => <th key={h} className="p-3 text-left">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {c.weapons.map((w, i) => (
                      <tr key={i}>
                        <td className="p-3 text-slate-200 font-bold">{w.name}</td>
                        <td className="p-3 text-slate-400">{w.skill}</td>
                        <td className="p-3 text-slate-300 font-mono">{w.damage}</td>
                        <td className="p-3 text-slate-400">{w.range}</td>
                        <td className="p-3 text-slate-400">{w.attacks}</td>
                        <td className="p-3 text-slate-400">{w.ammo}</td>
                        <td className="p-3 text-slate-400">{w.malfunction}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === 'story' && (
        <Panel className="p-5 animate-in fade-in">
          <h3 className="font-bold text-white mb-4 flex items-center"><BookOpen className="w-4 h-4 mr-2 text-emerald-500" />背景故事</h3>
          <div className="grid md:grid-cols-2 gap-5">
            {BACKGROUND_FIELDS.map(([key, label]) => (
              <div key={key}>
                <div className="text-sm font-bold text-slate-400 border-b border-slate-800 pb-1.5 mb-2">{label}</div>
                <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed min-h-[2rem]">
                  {c.background?.[key] || <span className="text-slate-600">—</span>}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === 'journal' && (
        <div className="space-y-5 animate-in fade-in">
          <Panel className="p-5 space-y-4">
            <h3 className="font-bold text-white flex items-center"><ScrollText className="w-4 h-4 mr-2 text-emerald-500" />经历（关联模组）</h3>

            <div className="space-y-2">
              {(c.moduleLinks || []).map((l) => (
                <div key={l.moduleId} className="flex flex-wrap items-center gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3">
                  <Badge tone="emerald">{l.role}</Badge>
                  <div className="flex-1 min-w-[10rem]">
                    <div className="text-slate-200 font-bold">{l.moduleTitle}</div>
                    <div className="text-xs text-slate-500">
                      {l.moduleRegion} {l.moduleEra}
                      {l.date ? ` · ${l.date}` : ''}
                      {l.note ? ` · ${l.note}` : ''}
                    </div>
                  </div>
                  {c.canEdit ? (
                    <button type="button" onClick={() => removeLink(l.moduleId, l.moduleTitle)} className="p-2 text-slate-500 hover:text-red-400" title="移除">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : null}
                </div>
              ))}
              {(c.moduleLinks || []).length === 0 && <p className="text-sm text-slate-500 py-2">还没有关联任何模组。</p>}
            </div>

            {c.canEdit ? (
              <div className="border-t border-slate-800 pt-4 space-y-3">
                <p className="text-xs text-slate-500 flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5" />关联一个跑过的模组（玩家与 KP 均可添加）
                </p>
                <div className="grid sm:grid-cols-4 gap-3">
                  <Field label="模组" className="sm:col-span-2">
                    <Select value={linkForm.moduleId} onChange={(e) => setLinkForm({ ...linkForm, moduleId: e.target.value })}>
                      <option value="">请选择模组…</option>
                      {moduleOptions.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                    </Select>
                  </Field>
                  <Field label="参与身份">
                    <Select value={linkForm.role} onChange={(e) => setLinkForm({ ...linkForm, role: e.target.value })}>
                      {MODULE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </Select>
                  </Field>
                  <Field label="日期">
                    <Input type="date" value={linkForm.date} onChange={(e) => setLinkForm({ ...linkForm, date: e.target.value })} style={{ colorScheme: 'dark' }} />
                  </Field>
                </div>
                <Field label="经历备注">
                  <Textarea rows={2} maxLength={200} value={linkForm.note} onChange={(e) => setLinkForm({ ...linkForm, note: e.target.value })} placeholder="例：第一次跑团，角色失去 5 点理智" />
                </Field>
                <Button onClick={addLink} disabled={adding}><Plus className="w-4 h-4" />{adding ? '添加中…' : '加入经历'}</Button>
              </div>
            ) : null}
          </Panel>

          <Panel className="p-5 space-y-4">
            <h3 className="font-bold text-white flex items-center"><FileText className="w-4 h-4 mr-2 text-emerald-500" />装备与资产</h3>
            <div>
              <div className="text-sm font-bold text-slate-400 mb-1.5">装备和物品</div>
              <p className="text-sm text-slate-300 whitespace-pre-wrap bg-slate-950 border border-slate-800 rounded-xl p-3">
                {c.equipment || <span className="text-slate-600">—</span>}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
              <div className="text-xs text-slate-500">
                按「{c.era} · {d.wealth?.currencyLabel}」与信用评级 {d.creditRating}% 自动计算（不可手改）
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                {[['消费水平', d.wealth?.level], ['现金', d.wealth?.cashText], ['资产', d.wealth?.assetsText]].map(([l, v]) => (
                  <div key={l} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                    <div className="text-xs text-slate-500 mb-1">{l}</div>
                    <div className="text-slate-100 font-mono font-bold">{v || '—'}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">额外资产</div>
                <div className="text-slate-200 whitespace-pre-wrap">{c.extraAssets || '—'}</div>
              </div>
            </div>
            {c.experience ? (
              <div>
                <div className="text-sm font-bold text-slate-400 mb-1.5">经历记录</div>
                <p className="text-sm text-slate-300 whitespace-pre-wrap bg-slate-950 border border-slate-800 rounded-xl p-3">{c.experience}</p>
              </div>
            ) : null}
          </Panel>

          <Panel className="p-5">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h3 className="font-bold text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-cyan-400" />备注
              </h3>
              <span className="text-[11px] text-slate-500">只做记录，不会出现在骰娘指令与打印件上</span>
            </div>
            <p className="text-sm text-slate-300 whitespace-pre-wrap bg-slate-950 border border-slate-800 rounded-xl p-3">
              {c.notes || <span className="text-slate-600">—</span>}
            </p>
          </Panel>
        </div>
      )}

      <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />创建 {new Date(c.createdAt).toLocaleString()}</span>
        <span>最近更新 {new Date(c.updatedAt).toLocaleString()}</span>
        <span className="flex items-center gap-1"><Shield className="w-3.5 h-3.5" />归属 {c.ownerName}</span>
        {currentUser?.role === 'admin' ? <span className="flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" />KP 可见全部角色卡</span> : null}
      </div>

      <ExportCardModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        character={c}
        onToast={showToast}
      />
    </div>
  );
}
