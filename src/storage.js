// 資料層：狀態結構、正規化、localStorage 讀寫、匯入匯出。
// 所有函式都不假設瀏覽器環境（storage 由外部注入），方便測試。

export const STORAGE_KEY = 'ah.sigh.v1';
export const SCHEMA_VERSION = 1;

/** 原因代號（顯示文字在 app.js 的 REASONS 裡）。null 代表「沒為什麼」。 */
export const REASON_IDS = [
  'work',
  'study',
  'love',
  'family',
  'money',
  'health',
  'weather',
  'people',
  'other',
];

export function defaultState() {
  return {
    v: SCHEMA_VERSION,
    // 每一筆嘆氣：{ t: 毫秒時間戳, r: 原因代號或 null, a?: 1 表示麥克風自動偵測 }
    sighs: [],
    settings: {
      theme: 'auto', // 'auto' | 'dark' | 'light'
      sound: false,
      sensitivity: 0.5,
      reason: null, // 目前選定、之後每次嘆氣會套用的原因
    },
  };
}

function clamp01(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

export function normalizeSigh(x) {
  if (!x || typeof x !== 'object') return null;
  const t = Number(x.t);
  if (!Number.isFinite(t) || t <= 0) return null;
  const out = { t: Math.round(t), r: REASON_IDS.includes(x.r) ? x.r : null };
  if (x.a) out.a = 1;
  return out;
}

/** 把任何來路不明的物件整理成合法狀態；壞掉的欄位回到預設值。 */
export function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const sighs = Array.isArray(raw.sighs) ? raw.sighs.map(normalizeSigh).filter(Boolean) : [];
  sighs.sort((a, b) => a.t - b.t);

  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  return {
    v: SCHEMA_VERSION,
    sighs,
    settings: {
      theme: ['auto', 'dark', 'light'].includes(s.theme) ? s.theme : base.settings.theme,
      sound: s.sound === true,
      sensitivity: clamp01(s.sensitivity, base.settings.sensitivity),
      reason: REASON_IDS.includes(s.reason) ? s.reason : null,
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

/** 合併兩份紀錄：同一個時間戳視為同一次嘆氣（後者覆蓋前者），結果依時間排序。 */
export function mergeSighs(a, b) {
  const map = new Map();
  for (const s of [...a, ...b]) {
    const n = normalizeSigh(s);
    if (n) map.set(n.t, n);
  }
  return [...map.values()].sort((x, y) => x.t - y.t);
}

/** 讀取匯出的 JSON（整個狀態或只有陣列都接受）。不合法會丟錯。 */
export function parseImport(text) {
  const raw = JSON.parse(text);
  const arr = Array.isArray(raw) ? raw : raw && raw.sighs;
  if (!Array.isArray(arr)) throw new Error('找不到 sighs 陣列');
  return arr.map(normalizeSigh).filter(Boolean);
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
  const rows = [['timestamp', 'datetime', 'reason', 'reason_label', 'auto']];
  for (const s of sighs) {
    rows.push([s.t, localISO(s.t), s.r ?? '', labelOf(s.r ?? null), s.a ? 1 : 0]);
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
}
