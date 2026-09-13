/**
 * KP 审卡中心：审核队列 + 批量辅助审卡 + 审卡规则设置 + 自定义职业模板。
 *
 * 设计要点：
 *  - 审核状态与批复**不属于角色卡本体**，只存在 reviews 集合里，因此绝不会被打印导出。
 *  - 审卡规则全部**可选**：值为 0 / false 表示不启用该条检查；规则由服务端权威判定，
 *    前端只负责展示结论（防止有人改前端绕过）。
 *  - 批量审卡按当前规则一次性扫描，便于 KP 在开团前统一过一遍。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle, ClipboardCheck, Crown, Eye, GraduationCap, Plus, RefreshCw,
  Save, Scale, Shield, Trash2, Users, Wand2, XCircle,
} from 'lucide-react';
import {
  AUDIT_RULE_META, DEFAULT_AUDIT_RULES, REVIEW_LABEL, SKILLS, SKILL_BY_KEY,
  SOCIAL_SKILLS, STATUS_LABEL,
} from '../../../shared/coc7e.js';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../../lib/api.js';
import { eduGrowthLabel, grantEduReroll } from '../../../shared/coc7e.js';
import EduQuickModal from './EduQuickModal.jsx';
import {
  Badge, Button, EmptyState, Field, Input, Modal, NumberInput, Panel, SectionTitle,
  Select, Textarea, Toggle, cx,
} from '../ui.jsx';

const TABS = [
  { key: 'queue', label: '待审核队列', icon: ClipboardCheck },
  { key: 'batch', label: '批量审卡', icon: Scale },
  { key: 'rules', label: '审卡规则', icon: Shield },
  { key: 'occupations', label: '职业模板', icon: Wand2 },
];

const FINDING_TONE = {
  error: 'border-red-500/40 bg-red-500/5 text-red-200',
  warn: 'border-amber-500/40 bg-amber-500/5 text-amber-200',
  info: 'border-cyan-500/40 bg-cyan-500/5 text-cyan-200',
};

function Findings({ findings }) {
  if (!findings?.length) {
    return <p className="text-xs text-emerald-400 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5" />未发现问题</p>;
  }
  return (
    <ul className="space-y-1">
      {findings.map((f, i) => (
        <li key={`${f.id}-${i}`} className={cx('rounded-lg border p-2 text-xs', FINDING_TONE[f.level])}>
          <b>{f.label}</b>：{f.detail}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ 主组件
export default function KpReviewCenter({ currentUser, showToast, showConfirm, onOpenCharacter }) {
  const [tab, setTab] = useState('queue');

  return (
    <div className="space-y-6">
      <SectionTitle
        icon={Shield}
        title="审卡中心"
        desc="集中处理玩家提交的角色卡：辅助规则审卡、批量核对与职业模板维护。审核状态与批复不会被打印导出。"
      />
      <div className="flex flex-wrap gap-1 border-b border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cx('px-4 py-3 font-bold text-sm flex items-center gap-2 border-b-2 -mb-px transition',
              tab === t.key ? 'text-amber-400 border-amber-500' : 'text-slate-500 border-transparent hover:text-slate-300')}
          >
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {tab === 'queue' && (
        <QueueTab showToast={showToast} showConfirm={showConfirm} onOpenCharacter={onOpenCharacter} currentUser={currentUser} />
      )}
      {tab === 'batch' && <BatchTab showToast={showToast} onOpenCharacter={onOpenCharacter} />}
      {tab === 'rules' && <RulesTab showToast={showToast} />}
      {tab === 'occupations' && <OccupationsTab showToast={showToast} showConfirm={showConfirm} currentUser={currentUser} />}
    </div>
  );
}

// ------------------------------------------------------------------ 审核队列
function QueueTab({ showToast, showConfirm, onOpenCharacter, currentUser }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [eduItem, setEduItem] = useState(null);
  const eduActor = currentUser?.username || '';

  /** 队列里一键授权重掷（不打开弹窗） */
  const quickGrantEdu = async (it) => {
    try {
      await apiPatch(`/api/characters/${it.id}`, { eduGrowth: grantEduReroll(it.eduGrowth, eduActor) });
      showToast(`已授权【${it.name}】重掷一次教育增强`);
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet(`/api/admin/reviews?status=${status}`);
      setItems(res.items || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally { setLoading(false); }
  }, [status, showToast]);

  useEffect(() => { load(); }, [load]);

  const review = async (id, verdict) => {
    setBusy(true);
    try {
      await apiPost(`/api/characters/${id}/review`, { verdict, comment });
      showToast(verdict === 'approved' ? '已通过' : '已驳回并附批复');
      setOpenId('');
      setComment('');
      load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Panel className="p-4 flex flex-wrap items-center gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto !py-2 text-sm">
          <option value="pending">待审核</option>
          <option value="rejected">已驳回</option>
          <option value="approved">已通过</option>
          <option value="none">未提交</option>
        </Select>
        <Button variant="ghost" onClick={load}><RefreshCw className={cx('w-4 h-4', loading && 'animate-spin')} />刷新</Button>
        <span className="text-xs text-slate-500">共 {items.length} 张</span>
      </Panel>

      <EduQuickModal
        open={Boolean(eduItem)}
        item={eduItem}
        showToast={showToast}
        onClose={() => setEduItem(null)}
        onSaved={() => load()}
      />

      {items.length === 0 ? (
        <Panel><EmptyState icon={ClipboardCheck} title="队列是空的" desc="玩家提交审核后，角色卡会出现在这里。" /></Panel>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <Panel key={it.id} className="p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-white font-bold flex items-center gap-2 flex-wrap">
                    {it.name}
                    <Badge tone={it.reviewStatus === 'pending' ? 'amber' : it.reviewStatus === 'approved' ? 'emerald' : 'red'}>
                      {REVIEW_LABEL[it.reviewStatus] || it.reviewStatus}
                    </Badge>
                    <Badge tone="slate">{STATUS_LABEL[it.status] || it.status}</Badge>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {it.legendary?.enabled ? <Badge tone="red">传奇 +{it.legendaryBonusTotal || 0}</Badge> : null}
                    {it.agePenaltyWaived ? <Badge tone="emerald">免年龄减益</Badge> : null}
                    {it.eduGrowth?.settled ? (
                      <span className={cx('flex items-center gap-1', (it.eduGrowth.rerolls || 0) > 0 ? 'text-amber-400' : 'text-slate-400')}>
                        <GraduationCap className="w-3.5 h-3.5" />教育 +{it.eduGrowth.gain}
                        （{eduGrowthLabel(it.eduGrowth)}）
                        {(it.eduGrowth.rerolls || 0) > 0 ? ` · 重掷 ${it.eduGrowth.rerolls} 次` : ''}
                        {(it.eduGrowth.granted || 0) > 0 ? `· 已授权 ${it.eduGrowth.granted} 次` : ''}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-400"><GraduationCap className="w-3.5 h-3.5" />教育未结算</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {it.ownerName} · {it.occupationName} · {it.age} 岁 · HP {it.hp} / SAN {it.san} / MOV {it.mov}
                    {it.warningCount ? ` · ${it.warningCount} 项规则提示` : ' · 规则校验通过'}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {it.eduGrowth ? (
                    <>
                      <Button
                        variant={(it.eduGrowth.granted || 0) > 0 ? 'amber' : 'ghost'}
                        className="!py-2"
                        title="查看教育增强流水，授权重掷或重置"
                        onClick={() => setEduItem({ ...it, __actor: eduActor })}
                      >
                        <GraduationCap className="w-4 h-4" />教育
                      </Button>
                      {it.eduGrowth.settled && (it.eduGrowth.granted || 0) <= 0 ? (
                        <Button variant="ghost" className="!py-2" title="直接授权一次重掷" onClick={() => quickGrantEdu(it)}>
                          <Crown className="w-4 h-4" />授权重掷
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  <Button variant="ghost" className="!py-2" onClick={() => onOpenCharacter?.(it.id, true)}>
                    <Eye className="w-4 h-4" />打开核对
                  </Button>
                  {it.reviewStatus === 'pending' ? (
                    <>
                      <Button
                        className="!py-2"
                        onClick={() => showConfirm(`直接通过【${it.name}】？`, () => review(it.id, 'approved'), {
                          detail: '通过后批复会被清空，只记录审核人与时间。', danger: false,
                        })}
                        disabled={busy}
                      >
                        <CheckCircle className="w-4 h-4" />通过
                      </Button>
                      <Button variant="danger" className="!py-2" onClick={() => { setOpenId(openId === it.id ? '' : it.id); setComment(''); }}>
                        <XCircle className="w-4 h-4" />驳回
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>

              {openId === it.id ? (
                <div className="border-t border-slate-800 pt-3 space-y-2">
                  <Field label="批复说明" hint="会展示给玩家，但不写入角色卡、不打印">
                    <Textarea rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="例：技能点超了 20，请重新分配" />
                  </Field>
                  <div className="flex gap-2">
                    <Button variant="danger" onClick={() => review(it.id, 'rejected')} disabled={busy || !comment.trim()}>
                      <XCircle className="w-4 h-4" />确认驳回并发送批复
                    </Button>
                    <Button variant="ghost" onClick={() => setOpenId('')}>取消</Button>
                  </div>
                </div>
              ) : null}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 批量审卡
function BatchTab({ showToast, onOpenCharacter }) {
  const [scope, setScope] = useState('pending');
  const [owners, setOwners] = useState([]);
  const [allCards, setAllCards] = useState([]);
  const [ownerId, setOwnerId] = useState('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    apiGet('/api/characters/meta')
      .then((m) => setOwners(m.owners || []))
      .catch(() => { /* ignore */ });
  }, []);

  // 手动勾选模式需要先拿到全站角色卡列表
  useEffect(() => {
    if (scope !== 'manual') return;
    apiGet('/api/characters?scope=all')
      .then((res) => setAllCards(res.items || []))
      .catch((err) => showToast(err.message, 'error'));
  }, [scope, showToast]);

  const run = async () => {
    setBusy(true);
    try {
      const ids = [...selected];
      const res = await apiPost('/api/admin/audit/batch', scope === 'manual'
        ? { scope: 'manual', characterIds: ids }
        : { scope, ownerId, status });
      setResult(res);
      showToast(`已审核 ${res.total} 张：合规 ${res.passed}，不合规 ${res.failed}`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally { setBusy(false); }
  };

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const selectAllPassed = () => setSelected(new Set((result?.items || []).filter((r) => r.passed).map((r) => r.characterId)));
  const selectAllFailed = () => setSelected(new Set((result?.items || []).filter((r) => !r.passed).map((r) => r.characterId)));
  const selectNone = () => setSelected(new Set());

  /** 审完之后按需给选中的卡打上「已通过」标签 */
  const approveSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return showToast('请先勾选要标记为通过的卡片', 'error');
    setApproving(true);
    try {
      const res = await apiPost('/api/admin/reviews/batch', { characterIds: ids, verdict: 'approved' });
      showToast(`已标记 ${res.reviewed} 张为审核通过${res.skipped?.length ? `，跳过 ${res.skipped.length} 张` : ''}`);
      setSelected(new Set());
      setResult((prev) => (prev ? {
        ...prev,
        items: prev.items.map((r) => (ids.includes(r.characterId) ? { ...r, reviewStatus: 'approved' } : r)),
      } : prev));
    } catch (err) {
      showToast(err.message, 'error');
    } finally { setApproving(false); }
  };

  return (
    <div className="space-y-4">
      <Panel className="p-5 space-y-4">
        <h3 className="font-bold text-white flex items-center gap-2"><Scale className="w-4 h-4 text-amber-400" />批量辅助审卡</h3>
        <p className="text-xs text-slate-500">
          按「审卡规则」标签页里启用的规则，一次性扫描多张角色卡。规则未启用的检查项不会产生任何判定。
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="审查范围">
            <Select value={scope} onChange={(e) => { setScope(e.target.value); setSelected(new Set()); setResult(null); }}>
              <option value="pending">仅待审核的卡</option>
              <option value="all">全部角色卡</option>
              <option value="owner">指定玩家的卡</option>
              <option value="manual">手动勾选…</option>
            </Select>
          </Field>
          {scope === 'owner' ? (
            <Field label="玩家">
              <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">请选择…</option>
                {owners.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
              </Select>
            </Field>
          ) : null}
          <Field label="生涯状态筛选">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">不限</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        </div>
        {scope === 'manual' ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-slate-500">共 {allCards.length} 张，已勾选 <b className="text-amber-400">{selected.size}</b> 张</span>
              <button type="button" className="text-emerald-400 hover:underline" onClick={() => setSelected(new Set(allCards.map((c) => c.id)))}>全选</button>
              <button type="button" className="text-slate-400 hover:underline" onClick={selectNone}>清空</button>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-800 divide-y divide-slate-800/60">
              {allCards.map((c) => (
                <label key={c.id} className="flex items-center gap-3 p-3 hover:bg-slate-800/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="w-4 h-4 accent-amber-500"
                  />
                  <span className="text-slate-200 font-bold">{c.name}</span>
                  <span className="text-xs text-slate-500">{c.ownerName} · {c.occupationName} · {REVIEW_LABEL[c.reviewStatus] || c.reviewStatus}</span>
                </label>
              ))}
              {allCards.length === 0 && <p className="p-4 text-sm text-slate-500">暂无角色卡</p>}
            </div>
          </div>
        ) : null}

        <Button onClick={run} disabled={busy || (scope === 'manual' && selected.size === 0)}>
          <Scale className="w-4 h-4" />{busy ? '审核中…' : '开始批量审卡'}
        </Button>
      </Panel>

      {result ? (
        <>
          <Panel className="p-4 grid grid-cols-3 gap-3 text-center">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-xs text-slate-500">总计</div>
              <div className="text-2xl font-black text-white font-mono">{result.total}</div>
            </div>
            <div className="bg-slate-950 border border-emerald-800/60 rounded-xl p-3">
              <div className="text-xs text-slate-500">合规</div>
              <div className="text-2xl font-black text-emerald-400 font-mono">{result.passed}</div>
            </div>
            <div className="bg-slate-950 border border-red-800/60 rounded-xl p-3">
              <div className="text-xs text-slate-500">不合规</div>
              <div className="text-2xl font-black text-red-400 font-mono">{result.failed}</div>
            </div>
          </Panel>

          <Panel className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-slate-400">已勾选 <b className="text-amber-400">{selected.size}</b> 张</span>
                <button type="button" className="text-emerald-400 hover:underline" onClick={selectAllPassed}>选中全部合规</button>
                <button type="button" className="text-red-400 hover:underline" onClick={selectAllFailed}>选中全部不合规</button>
                <button type="button" className="text-slate-400 hover:underline" onClick={selectNone}>清空</button>
              </div>
              <Button onClick={approveSelected} disabled={approving || selected.size === 0}>
                <CheckCircle className="w-4 h-4" />{approving ? '标记中…' : `给勾选的 ${selected.size} 张打上「已通过」`}
              </Button>
            </div>
            <p className="text-[11px] text-slate-500">
              提示：批量标记只写审核状态与审核人，不写批复（通过的卡本来就不留批复）。
            </p>
          </Panel>

          <div className="space-y-3">
            {result.items.map((r) => (
              <Panel key={r.characterId} className="p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="checkbox"
                      checked={selected.has(r.characterId)}
                      onChange={() => toggle(r.characterId)}
                      className="w-4 h-4 accent-amber-500"
                    />
                    <span className="text-white font-bold">{r.name}</span>
                    <span className="text-xs text-slate-500">{r.ownerName}</span>
                    <Badge tone={r.passed ? 'emerald' : 'red'}>{r.passed ? '合规' : '不合规'}</Badge>
                    <Badge tone="slate">{REVIEW_LABEL[r.reviewStatus] || r.reviewStatus}</Badge>
                    {r.stats?.legendary ? (
                      <Badge tone="cyan">传奇 +{r.stats.legendaryBonusTotal || 0}</Badge>
                    ) : null}
                    {r.stats?.agePenaltyWaived ? <Badge tone="emerald">豁免年龄减益</Badge> : null}
                    <span className={cx('text-[11px]', r.stats?.eduSettled ? 'text-slate-400' : 'text-amber-400')}>
                      教育增强 {r.stats?.eduSettled
                        ? `+${r.stats.eduBonus}${r.stats.eduManual ? '（手动录入）' : `（检定 ${r.stats.eduCount} 次）`}`
                        : '未结算'}
                    </span>
                  </div>
                  <Button variant="ghost" className="!py-1.5 !px-3 text-sm" onClick={() => onOpenCharacter?.(r.characterId, true)}>
                    <Eye className="w-4 h-4" />打开
                  </Button>
                </div>
                <Findings findings={r.findings} />
              </Panel>
            ))}
            {result.items.length === 0 && <Panel><EmptyState title="没有符合条件的角色卡" /></Panel>}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ 审卡规则
function RulesTab({ showToast }) {
  const [rules, setRules] = useState(DEFAULT_AUDIT_RULES);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet('/api/admin/audit-rules');
      setRules({ ...DEFAULT_AUDIT_RULES, ...(res.rules || {}) });
    } catch (err) { showToast(err.message, 'error'); } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await apiPut('/api/admin/audit-rules', rules);
      setRules({ ...DEFAULT_AUDIT_RULES, ...res.rules });
      showToast('审卡规则已保存');
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  };

  const numbers = AUDIT_RULE_META.filter((m) => m.type === 'number');
  const booleans = AUDIT_RULE_META.filter((m) => m.type === 'boolean');

  return (
    <div className="space-y-4">
      <Panel className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-white flex items-center gap-2"><Shield className="w-4 h-4 text-amber-400" />辅助审卡规则</h3>
            <p className="text-xs text-slate-500 mt-1">
              所有规则都是<b>可选</b>的：数字填 0、开关关掉即表示不检查这一条。规则由服务端判定，玩家端改不了。
            </p>
          </div>
          <Button variant="ghost" onClick={load}><RefreshCw className={cx('w-4 h-4', loading && 'animate-spin')} />重新读取</Button>
        </div>

        <Toggle
          checked={Boolean(rules.enabled)}
          onChange={(v) => setRules({ ...rules, enabled: v })}
          label="启用规则审卡"
          hint="关闭后批量审卡仍可运行，但只会用「职业公式预算」这类内置底线，不套用下面的自定义阈值"
        />

        <div>
          <h4 className="text-sm font-bold text-slate-300 mb-3">数值阈值</h4>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {numbers.map((m) => (
              <Field key={m.key} label={m.label} hint={m.hint}>
                <NumberInput
                  min={0}
                  max={m.key === 'minPointUsage' ? 1 : 10000}
                  value={rules[m.key]}
                  onChange={(v) => setRules({ ...rules, [m.key]: v === '' ? 0 : v })}
                />
              </Field>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-bold text-slate-300 mb-3">开关项</h4>
          <div className="grid sm:grid-cols-2 gap-3">
            {booleans.map((m) => (
              <Toggle
                key={m.key}
                checked={Boolean(rules[m.key])}
                onChange={(v) => setRules({ ...rules, [m.key]: v })}
                label={m.label}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={save} disabled={busy}><Save className="w-4 h-4" />{busy ? '保存中…' : '保存规则'}</Button>
          <Button variant="ghost" onClick={() => setRules(DEFAULT_AUDIT_RULES)}>恢复默认</Button>
        </div>
      </Panel>

      <Panel className="p-5 text-xs text-slate-500 space-y-1.5">
        <p className="text-slate-400 font-bold text-sm mb-1">规则说明与建议</p>
        <p>· <b>属性上限 / 下限 / 总和上限</b>用来卡"六边形战士"：常规 1920s 调查员八项属性合计多在 450-650。</p>
        <p>· <b>职业/兴趣技能成功率上限</b>建议 70-80：初始就 90% 的侦查会让模组失去悬念；两项分开设，可以允许兴趣技能堆得更高或更低。</p>
        <p>· <b>禁止混点</b>是核心一致性检查：职业点只能投本职技能，兴趣点才是不限的（点数总量本身已由职业公式与智力×2 兜底）。</p>
        <p>· <b>职业点最低使用率</b>能揪出"懒得分配"的卡（例如低于 0.8 就提醒）。</p>
        <p>· 自定义技能、关闭年龄补正这类情况只做 info 提示，最终仍由你判断。</p>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ 职业模板
function OccupationsTab({ showToast, showConfirm, currentUser }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet('/api/admin/occupations');
      setItems(res.items || []);
    } catch (err) { showToast(err.message, 'error'); } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const remove = (occ) => showConfirm(`删除职业模板【${occ.name}】？`, async () => {
    try {
      const res = await apiDelete(`/api/admin/occupations/${occ.id}`);
      showToast(res.affectedCharacters
        ? `已删除；有 ${res.affectedCharacters} 张角色卡仍引用该模板，请提醒玩家改职业`
        : '已删除');
      load();
    } catch (err) { showToast(err.message, 'error'); }
  });

  return (
    <div className="space-y-4">
      <Panel className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-white flex items-center gap-2"><Wand2 className="w-4 h-4 text-amber-400" />自定义职业模板</h3>
            <p className="text-xs text-slate-500 mt-1">
              规则书没有、或本桌特有的职业：自己勾选本职技能、设定信用评级区间与技能点算法，玩家车卡时能直接选。
            </p>
          </div>
          <Button onClick={() => setEditing(blankTemplate())}><Plus className="w-4 h-4" />新建职业模板</Button>
        </div>

        {items.length === 0 ? (
          <EmptyState icon={Wand2} title={loading ? '载入中…' : '还没有自定义职业'} desc="例如「深潜者信徒」「业余神秘学家」这类房规职业。" />
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {items.map((o) => (
              <div key={o.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-white font-bold">{o.name}</div>
                    <div className="text-xs text-slate-500">
                      信用评级 {o.cr[0]}-{o.cr[1]} · {o.attr}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setEditing({ ...o, crMin: o.cr[0], crMax: o.cr[1] })} className="p-1.5 text-slate-400 hover:text-emerald-400">
                      <Wand2 className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => remove(o)} className="p-1.5 text-slate-400 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {o.keys.slice(0, 8).map((k) => (
                    <span key={k} className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                      {SKILL_BY_KEY[k]?.name || k}
                    </span>
                  ))}
                  {o.free ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300">任意 ×{o.free}</span> : null}
                  {o.social ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300">社交 ×{o.social}</span> : null}
                </div>
                <div className="text-[11px] text-slate-600">{o.createdByName} · {new Date(o.createdAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {editing ? (
        <TemplateEditor
          value={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          showToast={showToast}
          currentUser={currentUser}
        />
      ) : null}
    </div>
  );
}

function blankTemplate() {
  return {
    id: '', name: '', crMin: 0, crMax: 99, attr: '教育×4',
    pts: { terms: [{ stat: 'EDU', mult: 4 }], max: [] },
    keys: [], customKeys: [], choices: [], social: 0, free: 0, desc: '',
  };
}

const STAT_OPTIONS = [
  ['EDU', '教育'], ['INT', '智力'], ['STR', '力量'], ['DEX', '敏捷'],
  ['APP', '外貌'], ['POW', '意志'], ['CON', '体质'], ['SIZ', '体型'],
];

/** 职业模板编辑器：勾选本职技能 + 组合技能点公式 */
function TemplateEditor({ value, onClose, onSaved, showToast }) {
  const [form, setForm] = useState(() => ({ ...blankTemplate(), ...value, customKeys: value.customKeys || [] }));
  const [q, setQ] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [busy, setBusy] = useState(false);

  const addCustomKey = (raw) => {
    const name = String(raw || '').trim().slice(0, 24);
    if (!name) return;
    if (SKILL_BY_KEY[name] || SKILLS.some((s) => s.name === name)) {
      return showToast('这是内置技能，直接在上面勾选即可', 'error');
    }
    if ((form.customKeys || []).includes(name)) return showToast('已经加过了', 'error');
    if ((form.customKeys || []).length >= 20) return showToast('自定义技能最多 20 项', 'error');
    setForm((prev) => ({ ...prev, customKeys: [...(prev.customKeys || []), name] }));
    setCustomKey('');
  };

  const removeCustomKey = (name) => setForm((prev) => ({
    ...prev, customKeys: (prev.customKeys || []).filter((k) => k !== name),
  }));

  const skills = useMemo(
    () => SKILLS.filter((s) => !q.trim() || s.name.includes(q.trim())),
    [q],
  );

  const toggleKey = (key) => {
    setForm((prev) => ({
      ...prev,
      keys: prev.keys.includes(key) ? prev.keys.filter((k) => k !== key) : [...prev.keys, key],
    }));
  };

  // 搜索同时匹配内置技能名与已添加的自定义技能名
  const matchedCustom = (form.customKeys || []).filter((k) => !q.trim() || k.includes(q.trim()));

  const setTerm = (idx, field, v) => {
    setForm((prev) => {
      const terms = prev.pts.terms.map((t, i) => (i === idx ? { ...t, [field]: v } : t));
      return { ...prev, pts: { ...prev.pts, terms } };
    });
  };

  const addTerm = () => setForm((prev) => ({ ...prev, pts: { ...prev.pts, terms: [...prev.pts.terms, { stat: 'EDU', mult: 2 }] } }));
  const removeTerm = (idx) => setForm((prev) => ({ ...prev, pts: { ...prev.pts, terms: prev.pts.terms.filter((_, i) => i !== idx) } }));
  const toggleMax = (stat) => setForm((prev) => {
    const has = prev.pts.max.some((t) => t.stat === stat);
    return {
      ...prev,
      pts: {
        ...prev.pts,
        max: has ? prev.pts.max.filter((t) => t.stat !== stat) : [...prev.pts.max, { stat, mult: 2 }],
      },
    };
  });

  const save = async () => {
    if (!form.name.trim()) return showToast('请填写职业名称', 'error');
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        crMin: form.crMin,
        crMax: form.crMax,
        attr: form.attr,
        pts: { terms: form.pts.terms, max: form.pts.max },
        keys: form.keys,
        customKeys: form.customKeys || [],
        choices: form.choices,
        social: form.social,
        free: form.free,
        desc: form.desc,
      };
      if (form.id) await apiPut(`/api/admin/occupations/${form.id}`, payload);
      else await apiPost('/api/admin/occupations', payload);
      showToast('职业模板已保存');
      onSaved?.();
    } catch (err) {
      showToast(err.message, 'error');
    } finally { setBusy(false); }
  };

  const formulaText = [
    ...form.pts.terms.map((t) => `${STAT_OPTIONS.find((s) => s[0] === t.stat)?.[1] || t.stat}×${t.mult}`),
    form.pts.max.length
      ? `取大（${form.pts.max.map((t) => `${STAT_OPTIONS.find((s) => s[0] === t.stat)?.[1] || t.stat}×${t.mult}`).join(' / ')}）`
      : '',
  ].filter(Boolean).join(' ＋ ');

  return (
    <Modal open onClose={onClose} title={form.id ? `编辑职业模板：${form.name}` : '新建职业模板'} wide>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-4 gap-3">
          <Field label="职业名称" required className="sm:col-span-2">
            <Input maxLength={24} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例：深潜者信徒" />
          </Field>
          <Field label="信用评级下限">
            <NumberInput min={0} max={99} value={form.crMin} onChange={(v) => setForm({ ...form, crMin: v === '' ? 0 : v })} />
          </Field>
          <Field label="信用评级上限">
            <NumberInput min={0} max={99} value={form.crMax} onChange={(v) => setForm({ ...form, crMax: v === '' ? 99 : v })} />
          </Field>
        </div>

        <Field label="技能点公式" hint={`当前：${formulaText || '（未设置）'}`}>
          <div className="space-y-2">
            {form.pts.terms.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={t.stat} onChange={(e) => setTerm(i, 'stat', e.target.value)} className="!w-32 !py-2">
                  {STAT_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </Select>
                <span className="text-slate-500">×</span>
                <NumberInput min={1} max={10} value={t.mult} onChange={(v) => setTerm(i, 'mult', v === '' ? 1 : v)} className="!w-20 !py-2" />
                <button type="button" onClick={() => removeTerm(i)} className="p-1.5 text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <Button variant="ghost" className="!py-1.5" onClick={addTerm}><Plus className="w-4 h-4" />加一项</Button>
          </div>
        </Field>

        <Field label="取大项（可选）" hint="勾选的属性按 ×2 计算后取最大值，再与上面的项相加（对应「教育×2＋力量或敏捷×2」这类公式）">
          <div className="flex flex-wrap gap-2">
            {STAT_OPTIONS.map(([k, label]) => {
              const on = form.pts.max.some((t) => t.stat === k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleMax(k)}
                  className={cx('px-3 py-1.5 rounded-lg text-sm font-bold border transition',
                    on ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-amber-500/50')}
                >
                  {label}×2
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="点法说明" hint="显示给玩家看的一句话，例如「教育×4」">
          <Input maxLength={40} value={form.attr} onChange={(e) => setForm({ ...form, attr: e.target.value })} />
        </Field>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="任选社交技能槽位"><NumberInput min={0} max={6} value={form.social} onChange={(v) => setForm({ ...form, social: v === '' ? 0 : v })} /></Field>
          <Field label="任意特长槽位"><NumberInput min={0} max={8} value={form.free} onChange={(v) => setForm({ ...form, free: v === '' ? 0 : v })} /></Field>
        </div>

        <Field label="一句话简介">
          <Textarea rows={2} maxLength={200} value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} />
        </Field>

        <Field
          label={`本职技能（内置已选 ${form.keys.length} · 自定义 ${(form.customKeys || []).length}）`}
          hint="玩家在这些技能上可以用职业点提升"
        >
          <div className="space-y-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索内置技能…" />
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto border border-slate-800 rounded-xl p-3">
              {skills.map((s) => {
                const on = form.keys.includes(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => toggleKey(s.key)}
                    className={cx('px-2 py-1 rounded-md text-xs font-bold border transition',
                      on ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-emerald-500/50')}
                  >
                    {s.name}
                  </button>
                );
              })}
              {matchedCustom.map((name) => (
                <span
                  key={name}
                  className="px-2 py-1 rounded-md text-xs font-bold border bg-cyan-600 border-cyan-500 text-white flex items-center gap-1"
                >
                  {name}
                  <button type="button" onClick={() => removeCustomKey(name)} className="hover:text-red-200"><Trash2 className="w-3 h-3" /></button>
                </span>
              ))}
              {skills.length === 0 && matchedCustom.length === 0 && (
                <span className="text-xs text-slate-500">没有匹配的技能</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Input
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomKey(customKey); } }}
                maxLength={24}
                placeholder="规则书没有的技能名，例如：驾驶（坦克）"
              />
              <Button variant="ghost" onClick={() => addCustomKey(customKey)} disabled={!customKey.trim()}>
                <Plus className="w-4 h-4" />添加
              </Button>
            </div>
            <p className="text-[11px] text-slate-500">
              提示：加进来的自定义技能会自动成为该职业的本职技能；玩家车卡时在「自定义技能」里填同名即可用职业点提升。
              社交技能组当前为 {SOCIAL_SKILLS.map((k) => SKILL_BY_KEY[k]?.name).join('、')}；信用评级会自动对所有职业开放。
            </p>
          </div>
        </Field>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={busy}><Save className="w-4 h-4" />{busy ? '保存中…' : '保存模板'}</Button>
        </div>
      </div>
    </Modal>
  );
}
