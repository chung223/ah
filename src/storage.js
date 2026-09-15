// 資料層：狀態結構、正規化、localStorage 讀寫、匯入匯出。
// 所有函式都不假設瀏覽器環境（storage 由外部注入），方便測試。

import { isReasonId, normalizeCustomReasons } from './reasons.js';

export const STORAGE_KEY = 'ah.sigh.v1';
export const SCHEMA_VERSION = 2;
export const MAX_NOTE = 200;
export const PERIOD_KEYS = ['morning', 'noon', 'afternoon', 'evening', 'night'];

export function defaultState() {
  return {
    v: SCHEMA_VERSION,
    // 每一筆嘆氣：{ t: 毫秒時間戳, r: 原因代號或 null, a?: 1 表示麥克風自動偵測, n?: 一句話筆記 }
    sighs: [],
    // 被刪掉的紀錄的時間戳（同步用的墓碑，避免刪掉的又從雲端回來）
    deleted: [],
    settings: {
      theme: 'auto', // 'auto' | 'dark' | 'light'
      sound: false,
      badge: true, // App 圖示顯示今日次數
      sensitivity: 0.5,
      reason: null, // 目前選定、之後每次嘆氣會套用的原因
      reasonMode: 'manual', // 'manual' | 'period'：照時段自動選原因
      periodReasons: { morning: null, noon: null, afternoon: null, evening: null, night: null },
      customReasons: [], // [{ id: 'c_xxxxxx', label }]
      reasonOrder: null, // 原因顯示順序（不含 null）；null 表示預設順序
      micProfile: null, // 麥克風校正結果 { minFlat, riseDb, minDur, maxDur }
      sync: null, // { token, gistId, lastSync }
    },
  };
}

function clamp(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function cleanNote(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NOTE);
}

export function normalizeSigh(x) {
  if (!x || typeof x !== 'object') return null;
  const t = Number(x.t);
  if (!Number.isFinite(t) || t <= 0) return null;
  const out = { t: Math.round(t), r: isReasonId(x.r) ? x.r : null };
  if (x.a) out.a = 1;
  const n = cleanNote(x.n);
  if (n) out.n = n;
  return out;
}

function normalizeDeleted(list) {
  if (!Array.isArray(list)) return [];
  const set = new Set();
  for (const v of list) {
    const t = Number(v);
    if (Number.isFinite(t) && t > 0) set.add(Math.round(t));
  }
  return [...set].sort((a, b) => a - b).slice(-5000);
}

function normalizeMicProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {
    minFlat: clamp(p.minFlat, 0.02, 0.5, NaN),
    riseDb: clamp(p.riseDb, 3, 20, NaN),
    minDur: clamp(p.minDur, 200, 1500, 450),
    maxDur: clamp(p.maxDur, 1500, 10000, 4500),
  };
  if (!Number.isFinite(out.minFlat) || !Number.isFinite(out.riseDb)) return null;
  return out;
}

function normalizeSync(s) {
  if (!s || typeof s !== 'object') return null;
  const token = typeof s.token === 'string' ? s.token.trim() : '';
  if (!token) return null;
  return {
    token,
    gistId: typeof s.gistId === 'string' ? s.gistId.trim() : '',
    lastSync: clamp(s.lastSync, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

/** 把任何來路不明的物件整理成合法狀態；壞掉的欄位回到預設值。 */
export function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const sighs = Array.isArray(raw.sighs) ? raw.sighs.map(normalizeSigh).filter(Boolean) : [];
  sighs.sort((a, b) => a.t - b.t);

  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const customReasons = normalizeCustomReasons(s.customReasons);
  const customIds = new Set(customReasons.map((c) => c.id));
  const validReason = (id) => (isReasonId(id) && (!id.startsWith('c_') || customIds.has(id)) ? id : null);

  const pr = s.periodReasons && typeof s.periodReasons === 'object' ? s.periodReasons : {};
  const periodReasons = {};
  for (const k of PERIOD_KEYS) periodReasons[k] = validReason(pr[k]);

  const order = Array.isArray(s.reasonOrder) ? s.reasonOrder.filter((id) => validReason(id)) : null;

  return {
    v: SCHEMA_VERSION,
    sighs,
    deleted: normalizeDeleted(raw.deleted),
    settings: {
      theme: ['auto', 'dark', 'light'].includes(s.theme) ? s.theme : base.settings.theme,
      sound: s.sound === true,
      badge: s.badge !== false,
      sensitivity: clamp(s.sensitivity, 0, 1, base.settings.sensitivity),
      reason: validReason(s.reason),
      reasonMode: s.reasonMode === 'period' ? 'period' : 'manual',
      periodReasons,
      customReasons,
      reasonOrder: order && order.length ? order : null,
      micProfile: normalizeMicProfile(s.micProfile),
      sync: normalizeSync(s.sync),
    },
  };
}

/** storage 只需要 getItem / setItem / removeItem（localStorage 或測試用的假物件）。 */
export function createStore(storage) {
  return {
    load() {
      let raw = null;
      try {
        const text = storage.getItem(STORAGE_KEY);
        raw = text ? JSON.parse(text) : null;
      } catch {
        raw = null;
      }
      return normalizeState(raw);
    },
    save(state) {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        /* 忽略 */
      }
    },
  };
}

/**
 * 合併兩份紀錄：同一個時間戳視為同一次嘆氣，後者覆蓋前者，
 * 但筆記不會被沒有筆記的那一份蓋掉。結果依時間排序。
 */
export function mergeSighs(a, b) {
  const map = new Map();
  for (const s of [...a, ...b]) {
    const n = normalizeSigh(s);
    if (!n) continue;
    const prev = map.get(n.t);
    if (prev && prev.n && !n.n) n.n = prev.n;
    if (prev && prev.a && !n.a) n.a = 1;
    map.set(n.t, n);
  }
  return [...map.values()].sort((x, y) => x.t - y.t);
}

/** 讀取匯出的 JSON（整個狀態或只有陣列都接受）。不合法會丟錯。 */
export function parseImport(text) {
  const raw = JSON.parse(text);
  const arr = Array.isArray(raw) ? raw : raw && raw.sighs;
  if (!Array.isArray(arr)) throw new Error('找不到 sighs 陣列');
  return {
    sighs: arr.map(normalizeSigh).filter(Boolean),
    customReasons: Array.isArray(raw) ? [] : normalizeCustomReasons(raw.customReasons),
  };
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 本機時間的 ISO 樣式字串（不帶時區），給人看、給試算表用。 */
export function localISO(ts) {
  const d = new Date(ts);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

export function exportJSON(state, now = Date.now()) {
  return JSON.stringify(
    {
      app: 'ah-sigh-counter',
      v: SCHEMA_VERSION,
      exportedAt: localISO(now),
      sighs: state.sighs,
      customReasons: (state.settings && state.settings.customReasons) || [],
    },
    null,
    2,
  );
}

export function toCSV(sighs, labelOf = (r) => (r == null ? '' : String(r))) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['timestamp', 'datetime', 'reason', 'reason_label', 'auto', 'note']];
  for (const s of sighs) {
    rows.push([s.t, localISO(s.t), s.r ?? '', labelOf(s.r ?? null), s.a ? 1 : 0, s.n ?? '']);
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
}
