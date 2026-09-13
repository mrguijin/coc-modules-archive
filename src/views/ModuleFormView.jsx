/**
 * KP 录入 / 编辑模组档案
 * 从 App.jsx 抽出的视图组件；只通过 props 接收数据与回调，不直接发请求。
 */
import React from 'react';
import { Edit, FileText, Pin, Plus } from 'lucide-react';
import { Combobox, Field, Input, Select, Textarea, cx } from '../components/ui.jsx';

export default function ModuleFormView({ isEditing, formData, setFormData, uniqueSeries, onSubmit, onBack }) {
  return (
  <div className="max-w-3xl mx-auto">
    <button type="button" onClick={onBack} className="mb-6 text-slate-400 hover:text-emerald-400">← 返回</button>
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white flex items-center">
          {isEditing ? <Edit className="mr-2 text-emerald-500" /> : <Plus className="mr-2 text-emerald-500" />}
          {isEditing ? '编辑档案' : '录入档案'}
        </h2>
        <button
          type="button"
          onClick={() => setFormData({ ...formData, isPinned: !formData.isPinned })}
          className={cx(
            'flex items-center px-3 py-1.5 rounded-lg border cursor-pointer transition',
            formData.isPinned ? 'text-amber-500 bg-amber-500/10 border-amber-500/30' : 'text-slate-400 bg-slate-950 border-slate-700',
          )}
        >
          <Pin className="h-4 w-4 mr-1" /><span className="text-sm font-bold">置顶</span>
        </button>
      </div>
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="名称" required>
            <Input required maxLength={60} value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} />
          </Field>
          <Field label="所属合集/系列 (选填)">
            <Combobox
              options={uniqueSeries}
              value={formData.series}
              onChange={(v) => setFormData({ ...formData, series: v })}
              maxLength={40}
              placeholder="选择已有合集，或直接输入新名字…"
              emptyHint="没有匹配的合集，直接输入即可创建"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="地区"><Input maxLength={40} value={formData.region} onChange={(e) => setFormData({ ...formData, region: e.target.value })} /></Field>
          <Field label="时代" required>
            <Select required value={formData.era} onChange={(e) => setFormData({ ...formData, era: e.target.value })}>
              <option value="" disabled>请选择</option>
              <option value="1920s">1920s</option>
              <option value="现代">现代</option>
              <option value="其他">其他</option>
            </Select>
          </Field>
          <Field label="人数" required><Input required maxLength={20} value={formData.players} onChange={(e) => setFormData({ ...formData, players: e.target.value })} /></Field>
          <Field label="时长" required><Input required maxLength={20} value={formData.duration} onChange={(e) => setFormData({ ...formData, duration: e.target.value })} /></Field>
        </div>
        <Field label="简介" required>
          <Textarea required rows={4} maxLength={4000} value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
        </Field>
        <div className="bg-slate-950/50 p-6 rounded-xl border border-slate-800 space-y-4">
          <h3 className="text-emerald-500 font-bold border-b border-slate-800 pb-2 flex items-center">
            <FileText className="mr-2 h-4 w-4" /> 附加档案 (选填)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="车卡要求"><Textarea rows={2} maxLength={2000} value={formData.charInfo} onChange={(e) => setFormData({ ...formData, charInfo: e.target.value })} /></Field>
            <Field label="推荐职业"><Textarea rows={2} maxLength={2000} value={formData.occupations} onChange={(e) => setFormData({ ...formData, occupations: e.target.value })} /></Field>
            <Field label="推荐技能"><Textarea rows={2} maxLength={2000} value={formData.skills} onChange={(e) => setFormData({ ...formData, skills: e.target.value })} /></Field>
            <Field label="KP 警告/备注"><Textarea rows={2} maxLength={2000} value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} /></Field>
          </div>
        </div>
        <button type="submit" className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition">
          {isEditing ? '保存修改' : '发布至档案馆'}
        </button>
      </form>
    </div>
  </div>
  );
}
