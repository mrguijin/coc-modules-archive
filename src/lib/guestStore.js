/**
 * 访客角色卡的本机存储。
 *
 * 需求：未登录的访客也能完整使用车卡与导出功能，只是**不能收录到档案馆**。
 * 实现：数据只落在浏览器 localStorage 里，服务端不参与，因此不存在匿名写入接口，
 *       也就没有「谁能改谁的数据」这类权限问题。
 *
 * 访客登录后可以把本机草稿一键收录到自己的账号下（见 CharacterList 的收录入口）。
 */

const KEY = 'coc.guest.sheets.v1';
const MAX_SHEETS = 10;
const MAX_BYTES = 200 * 1024;   // 单张卡序列化后的上限，防止把 localStorage 写爆
const TOTAL_BYTES = 3 * 1024 * 1024; // localStorage 通常 5MB，留出余量

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  const payload = JSON.stringify(list);
  if (payload.length > TOTAL_BYTES) {
    throw new Error('本机草稿总量过大，请先清理一些访客角色卡');
  }
  localStorage.setItem(KEY, payload);
}

function newGuestId() {
  return `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function isGuestId(id) {
  return typeof id === 'string' && id.startsWith('g_');
}

/** 全部访客角色卡（按最近更新倒序） */
export function listGuestSheets() {
  return readAll()
    .map((s) => ({ ...s, guest: true }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getGuestSheet(id) {
  const found = readAll().find((s) => s.id === id);
  return found ? { ...found, guest: true } : null;
}

/**
 * 保存（新建或覆盖）一张访客角色卡。
 * @returns {object} 带 id 的完整存档
 */
export function saveGuestSheet(sheet) {
  const list = readAll();
  const now = Date.now();
  let id = isGuestId(sheet.id) ? sheet.id : newGuestId();
  const record = { ...sheet, id, guest: true, updatedAt: now, createdAt: sheet.createdAt || now };
  const size = JSON.stringify(record).length;
  if (size > MAX_BYTES) throw new Error('这张角色卡的数据过大，无法保存在本机');

  const idx = list.findIndex((s) => s.id === id);
  if (idx >= 0) list[idx] = record;
  else {
    if (list.length >= MAX_SHEETS) throw new Error(`本机最多保存 ${MAX_SHEETS} 张访客角色卡，请先收录或删除一些`);
    list.push(record);
  }
  writeAll(list);
  return record;
}

export function deleteGuestSheet(id) {
  writeAll(readAll().filter((s) => s.id !== id));
}

export function clearGuestSheets() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function guestCapacity() {
  const list = readAll();
  return { count: list.length, max: MAX_SHEETS };
}
