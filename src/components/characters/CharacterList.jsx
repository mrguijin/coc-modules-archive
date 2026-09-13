/**
 * 角色卡列表。
 * 同一个组件服务三种场景：
 *   mode="mine"  —— 登录玩家查看/管理自己的角色卡
 *   mode="guest" —— 未登录访客查看本机草稿（数据只在浏览器里）
 *   mode="kp"    —— KP 统一管理全站角色卡（可筛选归属玩家、状态、审核状态、关联模组）
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpen, CloudUpload, Copy, Crown, Edit, Eye, FileText, Filter,
  GraduationCap, LogIn, Plus, Printer, RefreshCw, Search, Share2, Shield, ShieldOff,
  Trash2, Upload, User as UserIcon, Users,
} from 'lucide-react';
import { REVIEW_LABEL, STATUS_LABEL, computeSheet, eduGrowthLabel, validateSheet } from '../../../shared/coc7e.js';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api.js';
import {
  deleteGuestSheet, listGuestSheets, guestCapacity, saveGuestSheet,
} from '../../lib/guestStore.js';
import { ExportCardModal, ImportCardModal } from './CardTransferModal.jsx';
import LegendaryQuickModal from './LegendaryQuickModal.jsx';
import EduQuickModal from './EduQuickModal.jsx';
import {
  Badge, Button, EmptyState, Input, Modal, Panel, Select, SectionTitle, cx,
} from '../ui.jsx';

/** 访客草稿是原始存档，这里就地算出与后端列表一致的摘要字段，卡片组件才能复用 */
function buildGuestItems() {
  return listGuestSheets().map((g) => {
    const d = computeSheet(g);
    return {
      ...g,
      occupationName: d.occupation?.name || '无职业',
      hp: d.hp, san: d.san, mov: d.mov,
      skillCount: d.skills.filter((s) => s.used).length,
      moduleCount: 0,
      warningCount: validateSheet(g).length,
      reviewStatus: 'none',
    };
  });
}

const STATUS_TONE = { draft: 'slate', active: 'emerald', retired: 'amber', dead: 'red' };
const REVIEW_TONE = { none: 'slate', pending: 'amber', approved: 'emerald', rejected: 'red' };

function CharacterCard({
  item, onOpen, onEdit, onPrint, onDelete, onDuplicate, showOwner, onPublish, guest,
  onLegendary, onEdu, onExport, onToggleWaiveAge, exporting,
}) {
  return (
    <Panel className="overflow-hidden flex flex-col hover:border-emerald-500/40 transition">
      <div className="p-5 flex-1 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-black text-white truncate">{item.name}</h3>
            <p className="text-xs text-slate-500 truncate">
              {item.occupationName} · {item.age} 岁 · {item.era}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge tone={STATUS_TONE[item.status] || 'slate'}>{STATUS_LABEL[item.status] || item.status}</Badge>
            {guest
              ? <Badge tone="amber">本机草稿</Badge>
              : (item.reviewStatus && item.reviewStatus !== 'none'
                ? <Badge tone={REVIEW_TONE[item.reviewStatus]}>{REVIEW_LABEL[item.reviewStatus]}</Badge>
                : null)}
            {item.isPublic ? <Badge tone="cyan">公开</Badge> : null}
            {item.legendary?.enabled ? <Badge tone="red">传奇 +{item.legendaryBonusTotal || 0}</Badge> : null}
            {item.agePenaltyWaived ? <Badge tone="emerald">免年龄减益</Badge> : null}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          {[['HP', item.hp], ['SAN', item.san], ['MOV', item.mov]].map(([l, v]) => (
            <div key={l} className="bg-slate-950 border border-slate-800 rounded-lg py-1.5">
              <div className="text-[10px] text-slate-500">{l}</div>
              <div className="font-mono font-black text-emerald-400">{v}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" />技能 {item.skillCount}</span>
          {!guest && <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" />模组 {item.moduleCount}</span>}
          {item.warningCount > 0
            ? <span className="flex items-center gap-1 text-amber-400"><AlertTriangle className="w-3.5 h-3.5" />{item.warningCount} 项提示</span>
            : <span className="flex items-center gap-1 text-emerald-500">规则校验通过</span>}
          {!guest && item.eduGrowth ? (
            item.eduGrowth.settled
              ? <span className="flex items-center gap-1 text-slate-400">
                <GraduationCap className="w-3.5 h-3.5" />教育 +{item.eduGrowth.gain}
                （{eduGrowthLabel(item.eduGrowth)}）
                {(item.eduGrowth.rerolls || 0) > 0 ? ` · 重掷 ${item.eduGrowth.rerolls} 次` : ''}
              </span>
              : <span className="flex items-center gap-1 text-amber-400"><GraduationCap className="w-3.5 h-3.5" />教育未结算</span>
          ) : null}
        </div>

        {showOwner && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400 border-t border-slate-800 pt-3">
            <UserIcon className="w-3.5 h-3.5" />{item.ownerName}
          </div>
        )}
      </div>

      <div className="bg-slate-950/60 border-t border-slate-800 divide-y divide-slate-800/70">
        {/* 第一行：常用操作 */}
        <div className="flex flex-wrap items-center gap-1.5 p-2.5">
          <Button variant="ghost" className="!py-1.5 !px-3 text-sm" onClick={() => onOpen(item)}>
            <Eye className="w-4 h-4" />查看
          </Button>
          <Button variant="ghost" className="!py-1.5 !px-3 text-sm" onClick={() => onEdit(item)}>
            <Edit className="w-4 h-4" />编辑
          </Button>
          <Button variant="ghost" className="!py-1.5 !px-3 text-sm" onClick={() => onPrint(item)}>
            <Printer className="w-4 h-4" />打印
          </Button>
          <Button
            variant="ghost"
            className="!py-1.5 !px-3 text-sm"
            disabled={exporting}
            title="导出角色卡编码（给别人导入）或骰娘机器人导入指令"
            onClick={() => onExport(item)}
          >
            <Share2 className="w-4 h-4" />{exporting ? '导出中…' : '导出'}
          </Button>
        </div>

        {/* 第二行：KP 快捷裁定（传奇 / 年龄豁免 / 教育增强）+ 次要图标操作 */}
        <div className="flex flex-wrap items-center gap-1.5 p-2.5">
          {onLegendary || onEdu || onToggleWaiveAge ? (
            <span className="text-[10px] font-bold text-amber-500/80 tracking-wider mr-0.5">KP 快捷</span>
          ) : null}
          {onLegendary || onEdu || onToggleWaiveAge ? (
            <>
            {onLegendary ? (
              <Button
                variant={item.legendary?.enabled ? 'amber' : 'ghost'}
                className="!py-1.5 !px-2.5 text-sm"
                title={item.legendary?.enabled
                  ? `传奇标记已开启（额外 +${item.legendaryBonusTotal || 0}），点击修改`
                  : '不解锁编辑，直接给这张卡开启传奇标记与额外调整值'}
                onClick={() => onLegendary(item)}
              >
                <Crown className="w-4 h-4" />传奇
              </Button>
            ) : null}
            {onToggleWaiveAge ? (
              <Button
                variant={item.agePenaltyWaived ? 'amber' : 'ghost'}
                className="!py-1.5 !px-2.5 text-sm"
                title={item.agePenaltyWaived
                  ? '当前已豁免年龄减益（属性不因年龄下降、只保留教育成长），点击恢复'
                  : '一键豁免这张卡的年龄减益（只享受教育成长）'}
                onClick={() => onToggleWaiveAge(item)}
              >
                {item.agePenaltyWaived
                  ? <><ShieldOff className="w-4 h-4" />恢复年龄</>
                  : <><Shield className="w-4 h-4" />豁免年龄</>}
              </Button>
            ) : null}
            {onEdu ? (
              <Button
                variant={(item.eduGrowth?.granted || 0) > 0 ? 'amber' : 'ghost'}
                className="!py-1.5 !px-2.5 text-sm"
                title="不解锁编辑：查看教育增强流水、授权重掷或重置"
                onClick={() => onEdu(item)}
              >
                <GraduationCap className="w-4 h-4" />教育
                {(item.eduGrowth?.granted || 0) > 0 ? `（已授权 ${item.eduGrowth.granted}）` : ''}
              </Button>
            ) : null}
            </>
          ) : null}
          <div className="flex-1" />
          {guest && onPublish ? (
            <button type="button" title="收录到档案馆" onClick={() => onPublish(item)} className="p-2 text-amber-400 hover:text-amber-300">
              <CloudUpload className="w-4 h-4" />
            </button>
          ) : null}
          {!guest && (
            <button type="button" title="复制一张" onClick={() => onDuplicate(item)} className="p-2 text-slate-400 hover:text-emerald-400">
              <Copy className="w-4 h-4" />
            </button>
          )}
          <button type="button" title="删除" onClick={() => onDelete(item)} className="p-2 text-slate-400 hover:text-red-400">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </Panel>
  );
}

export default function CharacterList({
  mode = 'mine', currentUser, showToast, showConfirm, onOpen, onEdit, onPrint,
}) {
  const isKp = mode === 'kp' && currentUser?.role === 'admin';
  const isGuest = mode === 'guest' || !currentUser;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(!isGuest);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [reviewStatus, setReviewStatus] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [meta, setMeta] = useState({ owners: [], moduleOptions: [], customOccupations: [] });
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    if (isGuest) { setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (isKp) params.set('scope', 'all');
      if (status) params.set('status', status);
      if (isKp && ownerId) params.set('ownerId', ownerId);
      if (moduleId) params.set('moduleId', moduleId);
      if (q.trim()) params.set('q', q.trim());
      const res = await apiGet(`/api/characters?${params.toString()}`);
      let list = res.items || [];
      if (reviewStatus) list = list.filter((c) => (c.reviewStatus || 'none') === reviewStatus);
      setItems(list);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [isKp, isGuest, status, ownerId, moduleId, q, reviewStatus, showToast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (isGuest) return;
    apiGet('/api/characters/meta')
      .then((m) => setMeta({
        owners: m.owners || [],
        moduleOptions: m.moduleOptions || [],
        customOccupations: m.customOccupations || [],
      }))
      .catch(() => { /* 元数据失败不影响列表 */ });
  }, [isGuest]);

  const [cardImportOpen, setCardImportOpen] = useState(false);
  const [legendaryItem, setLegendaryItem] = useState(null);
  const [eduItem, setEduItem] = useState(null);
  const [exportItem, setExportItem] = useState(null);
  const [exportingId, setExportingId] = useState('');

  const [guestItems, setGuestItems] = useState(() => buildGuestItems());
  const capacity = guestCapacity();

  const refreshGuest = useCallback(() => setGuestItems(buildGuestItems()), []);

  const displayItems = isGuest ? guestItems : items;

  const stats = useMemo(() => ({
    total: displayItems.length,
    active: displayItems.filter((i) => i.status === 'active').length,
    warned: displayItems.filter((i) => i.warningCount > 0).length,
    pending: displayItems.filter((i) => i.reviewStatus === 'pending').length,
  }), [displayItems]);

  const handleDelete = (item) => showConfirm(`确定删除角色卡【${item.name}】吗？此操作不可恢复。`, async () => {
    try {
      if (isGuest) { deleteGuestSheet(item.id); refreshGuest(); showToast('本机草稿已删除'); return; }
      await apiDelete(`/api/characters/${item.id}`);
      showToast('角色卡已删除');
      load();
    } catch (err) { showToast(err.message, 'error'); }
  });

  /** KP 快捷：一键开关「豁免年龄减益」 */
  const toggleWaiveAge = async (item) => {
    try {
      const saved = await apiPatch(`/api/characters/${item.id}`, { agePenaltyWaived: !item.agePenaltyWaived });
      showToast(saved.agePenaltyWaived
        ? `已豁免【${item.name}】的年龄减益（只保留教育成长）`
        : `已恢复【${item.name}】的年龄减益`);
      load();
    } catch (err) { showToast(err.message, 'error'); }
  };

  /**
   * 导出：列表摘要不含完整车卡数据，先按需拉一次详情再打开导出弹窗
   * （访客草稿本身就是完整存档，直接用）。
   */
  const openExport = async (item) => {
    if (isGuest) { setExportItem(item); return; }
    setExportingId(item.id);
    try {
      const full = await apiGet(`/api/characters/${item.id}`);
      setExportItem(full);
    } catch (err) {
      showToast(err.message, 'error');
    } finally { setExportingId(''); }
  };

  const handleDuplicate = async (item) => {
    try {
      await apiPost(`/api/characters/${item.id}/duplicate`, {});
      showToast('已复制一张角色卡');
      load();
    } catch (err) { showToast(err.message, 'error'); }
  };

  /** 把本机访客草稿收录到自己的账号下 */
  const importAllGuest = async () => {
    setImporting(true);
    let done = 0;
    try {
      for (const g of guestItems) {
        const { id, guest, updatedAt, createdAt, ...payload } = g;
        void id; void guest; void updatedAt; void createdAt;
        await apiPost('/api/characters', payload);
        deleteGuestSheet(g.id);
        done += 1;
      }
      refreshGuest();
      await load();
      setImportOpen(false);
      showToast(`已收录 ${done} 张角色卡到你的档案馆`);
    } catch (err) {
      showToast(`收录到第 ${done + 1} 张时失败：${err.message}`, 'error');
      refreshGuest();
      load();
    } finally { setImporting(false); }
  };

  const importOne = async (item) => {
    try {
      const { id, guest, updatedAt, createdAt, ...payload } = item;
      void id; void guest; void updatedAt; void createdAt;
      await apiPost('/api/characters', payload);
      deleteGuestSheet(item.id);
      refreshGuest();
      showToast('已收录到你的档案馆');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const title = isGuest ? '角色卡（访客模式）' : (isKp ? '角色卡统一管理' : '我的角色卡');
  const desc = isGuest
    ? '未登录也能完整车卡、打印与导出 PDF；数据保存在本机浏览器里，登录后可一键收录到自己的账号下。'
    : (isKp
      ? '查看与管理全站调查员角色卡：代玩家修改、批量打印、按玩家 / 状态 / 审核进度检索。'
      : '在这里创建、编辑、打印你的调查员角色卡；KP 可以看到并协助管理。');

  return (
    <div className="space-y-6">
      <SectionTitle
        icon={isKp ? Shield : Users}
        title={title}
        desc={desc}
        right={(
          <div className="flex items-center gap-2">
            {!isGuest && <Button variant="ghost" onClick={load}><RefreshCw className={cx('w-4 h-4', loading && 'animate-spin')} />刷新</Button>}
            {isGuest && guestItems.length > 0 && !currentUser && (
              <Button variant="ghost" onClick={() => onEdit(null)} disabled><LogIn className="w-4 h-4" />登录后可收录</Button>
            )}
            {isGuest && guestItems.length > 0 && currentUser && (
              <Button variant="amber" onClick={() => setImportOpen(true)}>
                <CloudUpload className="w-4 h-4" />一键收录 {guestItems.length} 张
              </Button>
            )}
            <Button variant="ghost" onClick={() => setCardImportOpen(true)}>
              <Upload className="w-4 h-4" />导入角色卡
            </Button>
            <Button onClick={() => onEdit(null)}><Plus className="w-4 h-4" />新建角色卡</Button>
          </div>
        )}
      />

      {isGuest && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            访客角色卡只保存在这台设备的浏览器里（当前 {capacity.count} / {capacity.max} 张），换设备或清理浏览器数据会丢失。
            {currentUser ? '你已登录，可以随时把草稿收录进档案馆。' : '登录后可以一键收录，并解锁模组经历关联等功能。'}
          </span>
        </div>
      )}

      {!isGuest && (
        <Panel className="p-4 space-y-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索角色名 / 玩家名…" className="!pl-9" />
            </div>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">全部状态</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
              <option value="">全部审核状态</option>
              {Object.entries(REVIEW_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            {isKp ? (
              <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">全部玩家</option>
                {meta.owners.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
              </Select>
            ) : (
              <Select value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
                <option value="">全部模组经历</option>
                {meta.moduleOptions.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </Select>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><Filter className="w-3.5 h-3.5" />共 {stats.total} 张</span>
            <span>使用中 {stats.active}</span>
            {isKp && stats.pending > 0 ? <span className="text-amber-400">待审核 {stats.pending}</span> : null}
            <span className={stats.warned ? 'text-amber-400' : ''}>有规则提示 {stats.warned}</span>
          </div>
        </Panel>
      )}

      {loading && displayItems.length === 0 ? (
        <Panel><EmptyState title="正在载入…" /></Panel>
      ) : displayItems.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Users}
            title={isGuest ? '还没有角色卡' : (isKp ? '还没有任何角色卡' : '你还没有角色卡')}
            desc={isGuest
              ? '点击「新建角色卡」即可开始：一键掷骰、自动算派生值、自动标记本职技能，全程无需登录。'
              : (isKp ? '玩家创建角色卡后会出现在这里。' : '点击「新建角色卡」开始半自动车卡。')}
            action={<Button onClick={() => onEdit(null)}><Plus className="w-4 h-4" />新建角色卡</Button>}
          />
        </Panel>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {displayItems.map((item) => (
            <CharacterCard
              key={item.id}
              item={item}
              guest={isGuest}
              showOwner={isKp}
              onOpen={onOpen}
              onEdit={onEdit}
              onPrint={onPrint}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onPublish={isGuest && currentUser ? importOne : null}
              onLegendary={isKp ? (it) => setLegendaryItem(it) : null}
              onEdu={isKp ? (it) => setEduItem(it) : null}
              onToggleWaiveAge={isKp ? toggleWaiveAge : null}
              onExport={openExport}
              exporting={exportingId === item.id}
            />
          ))}
        </div>
      )}

      <ExportCardModal
        open={Boolean(exportItem)}
        character={exportItem}
        onToast={showToast}
        onClose={() => setExportItem(null)}
      />

      <EduQuickModal
        open={Boolean(eduItem)}
        item={eduItem ? { ...eduItem, __actor: currentUser?.username || '' } : null}
        showToast={showToast}
        onClose={() => setEduItem(null)}
        onSaved={() => load()}
      />

      <LegendaryQuickModal
        open={Boolean(legendaryItem)}
        item={legendaryItem}
        showToast={showToast}
        onClose={() => setLegendaryItem(null)}
        onSaved={() => load()}
      />

      <ImportCardModal
        open={cardImportOpen}
        onClose={() => setCardImportOpen(false)}
        onToast={showToast}
        onImport={async (sheet) => {
          try {
            if (isGuest && !currentUser) {
              if (guestItems.length >= capacity.max) return showToast(`本机最多保存 ${capacity.max} 张草稿`, 'error');
              saveGuestSheet(sheet);
              refreshGuest();
              setCardImportOpen(false);
              showToast('已导入到本机草稿');
              return;
            }
            await apiPost('/api/characters', {
              ...sheet,
              name: sheet.name || '导入的调查员',
              playerName: sheet.playerName || currentUser?.username || '',
            });
            setCardImportOpen(false);
            await load();
            showToast('角色卡已导入');
          } catch (err) {
            showToast(`导入失败：${err.message}`, 'error');
          }
        }}
      />

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="收录访客角色卡">
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            下面的 {guestItems.length} 张角色卡将从本机浏览器转移到你的档案馆账号下：
          </p>
          <ul className="space-y-1 max-h-60 overflow-y-auto">
            {guestItems.map((g) => (
              <li key={g.id} className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm">
                <span className="text-slate-200">{g.name || '未命名调查员'}</span>
                <span className="text-xs text-slate-500">{g.occupationName || '无职业'}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">收录成功后本机草稿会被清理，避免重复。</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setImportOpen(false)}>取消</Button>
            <Button onClick={importAllGuest} disabled={importing}>
              <CloudUpload className="w-4 h-4" />{importing ? '收录中…' : '确认收录'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
