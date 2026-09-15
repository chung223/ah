// 原因標籤：內建的一組，加上使用者自訂的；可以排序、改名、刪除。
// 這裡只處理資料，不碰畫面。

export const BUILTIN_REASONS = [
  { id: null, label: '沒為什麼' },
  { id: 'work', label: '工作' },
  { id: 'study', label: '課業' },
  { id: 'love', label: '感情' },
  { id: 'family', label: '家庭' },
  { id: 'money', label: '金錢' },
  { id: 'health', label: '身體' },
  { id: 'weather', label: '天氣' },
  { id: 'people', label: '人際' },
  { id: 'other', label: '其他' },
];

export const BUILTIN_IDS = BUILTIN_REASONS.filter((r) => r.id).map((r) => r.id);
export const CUSTOM_ID_RE = /^c_[a-z0-9]{4,16}$/;
export const MAX_LABEL = 12;
export const MAX_CUSTOM = 20;

/** 合法的原因代號：內建的，或 c_ 開頭的自訂代號。null 另外處理。 */
export function isReasonId(id) {
  return typeof id === 'string' && (BUILTIN_IDS.includes(id) || CUSTOM_ID_RE.test(id));
}

export function cleanLabel(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL);
}

/** 整理自訂標籤清單：丟掉壞掉的、重複的。 */
export function normalizeCustomReasons(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const label = cleanLabel(x.label);
    if (!CUSTOM_ID_RE.test(x.id) || !label || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push({ id: x.id, label });
    if (out.length >= MAX_CUSTOM) break;
  }
  return out;
}

/** 依使用者排序後的完整清單；「沒為什麼」永遠在最前面。 */
export function orderedReasons(settings) {
  const known = new Map();
  for (const r of BUILTIN_REASONS) if (r.id) known.set(r.id, { id: r.id, label: r.label, custom: false });
  for (const c of settings.customReasons || []) known.set(c.id, { id: c.id, label: c.label, custom: true });
  const out = [{ ...BUILTIN_REASONS[0], custom: false }];
  const used = new Set();
  for (const id of settings.reasonOrder || []) {
    if (known.has(id) && !used.has(id)) {
      out.push(known.get(id));
      used.add(id);
    }
  }
  for (const [id, r] of known) if (!used.has(id)) out.push(r);
  return out;
}

export function labelFor(settings, id) {
  if (id == null) return BUILTIN_REASONS[0].label;
  const r = orderedReasons(settings).find((x) => x.id === id);
  return r ? r.label : '（已移除）';
}

export function makeCustomId(rng = Math.random) {
  let s = '';
  while (s.length < 6) s += Math.floor(rng() * 36).toString(36);
  return `c_${s}`;
}

export function addCustomReason(settings, label, rng = Math.random) {
  const l = cleanLabel(label);
  if (!l) return { error: '請輸入名稱' };
  if (orderedReasons(settings).some((r) => r.label === l)) return { error: '已經有這個標籤了' };
  if ((settings.customReasons || []).length >= MAX_CUSTOM) return { error: `最多 ${MAX_CUSTOM} 個自訂標籤` };
  let id = makeCustomId(rng);
  while ((settings.customReasons || []).some((c) => c.id === id)) id = makeCustomId(rng);
  settings.customReasons = [...(settings.customReasons || []), { id, label: l }];
  settings.reasonOrder = orderedReasons(settings)
    .filter((r) => r.id)
    .map((r) => r.id);
  return { id };
}

export function renameCustomReason(settings, id, label) {
  const l = cleanLabel(label);
  if (!l) return { error: '請輸入名稱' };
  const c = (settings.customReasons || []).find((x) => x.id === id);
  if (!c) return { error: '找不到這個標籤' };
  if (orderedReasons(settings).some((r) => r.label === l && r.id !== id)) return { error: '已經有這個標籤了' };
  c.label = l;
  return { id };
}

/** 刪除自訂標籤；設定裡指到它的地方都改回「沒為什麼」。 */
export function removeCustomReason(settings, id) {
  settings.customReasons = (settings.customReasons || []).filter((x) => x.id !== id);
  settings.reasonOrder = (settings.reasonOrder || []).filter((x) => x !== id);
  if (settings.reason === id) settings.reason = null;
  const pr = settings.periodReasons || {};
  for (const k of Object.keys(pr)) if (pr[k] === id) pr[k] = null;
}

/** 往前（dir = -1）或往後（dir = 1）移一格。 */
export function moveReason(settings, id, dir) {
  const ids = orderedReasons(settings)
    .filter((r) => r.id)
    .map((r) => r.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return false;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  settings.reasonOrder = ids;
  return true;
}
