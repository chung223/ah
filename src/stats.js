// 純函式：所有統計、洞察與時間格式化。
// 不碰 DOM、不碰 localStorage，方便在 Node 裡直接測試。

export const DAY_MS = 86_400_000;
export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const pad2 = (n) => String(n).padStart(2, '0');

/** 以「本機時區」為準的日期鍵：YYYY-MM-DD */
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 用 setDate 加減天數，跨日光節約時間也正確。 */
export function addDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function countToday(sighs, now = Date.now()) {
  const key = dayKey(now);
  let n = 0;
  for (const s of sighs) if (dayKey(s.t) === key) n++;
  return n;
}

export function countsByDayMap(sighs) {
  const map = new Map();
  for (const s of sighs) {
    const k = dayKey(s.t);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
}

/** 最近 days 天、每天的次數（由舊到新，最後一筆是今天）。 */
export function countsByDay(sighs, days, now = Date.now()) {
  const map = countsByDayMap(sighs);
  const today = startOfDay(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = addDays(today, -i);
    const key = dayKey(start);
    out.push({
      key,
      start,
      weekday: WEEKDAYS[new Date(start).getDay()],
      count: map.get(key) || 0,
    });
  }
  return out;
}

export function countsByHour(sighs) {
  const hours = new Array(24).fill(0);
  for (const s of sighs) hours[new Date(s.t).getHours()]++;
  return hours;
}

/** 依原因統計，由多到少。reason 為 null 代表「沒為什麼」。 */
export function countsByReason(sighs) {
  const map = new Map();
  for (const s of sighs) {
    const r = s.r ?? null;
    map.set(r, (map.get(r) || 0) + 1);
  }
  const total = sighs.length || 1;
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count, ratio: count / total }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 平靜時間：
 * - longest：兩次嘆氣之間最長的間隔（含「上一次到現在」）
 * - current：距離上一次嘆氣多久；沒有紀錄時為 null
 * sighs 必須依時間排序。
 */
export function calmGaps(sighs, now = Date.now()) {
  let longest = 0;
  let longestFrom = null;
  for (let i = 1; i < sighs.length; i++) {
    const gap = sighs[i].t - sighs[i - 1].t;
    if (gap > longest) {
      longest = gap;
      longestFrom = sighs[i - 1].t;
    }
  }
  const last = sighs.length ? sighs[sighs.length - 1].t : null;
  const current = last == null ? null : Math.max(0, now - last);
  if (current != null && current > longest) {
    longest = current;
    longestFrom = last;
  }
  return { longest, longestFrom, current, last };
}

export function summary(sighs, now = Date.now()) {
  const total = sighs.length;
  const today = countToday(sighs, now);
  const dayMap = countsByDayMap(sighs);
  const activeDays = dayMap.size;
  const first = total ? sighs[0].t : null;
  const daysTracked =
    first == null
      ? 0
      : Math.max(1, Math.round((startOfDay(now) - startOfDay(first)) / DAY_MS) + 1);

  let maxDay = null;
  for (const [key, count] of dayMap) {
    if (!maxDay || count > maxDay.count) maxDay = { key, count };
  }

  const hours = countsByHour(sighs);
  const busiestHour = total ? hours.indexOf(Math.max(...hours)) : null;

  const reasons = countsByReason(sighs);
  const topReason = reasons.find((r) => r.reason != null) || null;

  const { longest, current } = calmGaps(sighs, now);

  const fortnight = countsByDay(sighs, 14, now);
  const prevWeek = fortnight.slice(0, 7).reduce((a, d) => a + d.count, 0);
  const thisWeek = fortnight.slice(7).reduce((a, d) => a + d.count, 0);

  return {
    total,
    today,
    activeDays,
    daysTracked,
    avgPerDay: daysTracked ? total / daysTracked : 0,
    avgPerActiveDay: activeDays ? total / activeDays : 0,
    maxDay,
    busiestHour,
    topReason,
    longestCalm: longest,
    currentCalm: current,
    thisWeek,
    prevWeek,
  };
}

export function periodLabel(h) {
  if (h >= 5 && h <= 10) return '早上';
  if (h >= 11 && h <= 12) return '中午';
  if (h >= 13 && h <= 17) return '下午';
  if (h >= 18 && h <= 21) return '晚上';
  return '深夜';
}

/** 例：14 → 「下午 2 點」 */
export function hourLabel(h) {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${periodLabel(h)} ${h12} 點`;
}

export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 5) return '剛剛';
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} 小時 ${m % 60} 分` : `${h} 小時`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} 天 ${h % 24} 小時` : `${d} 天`;
}

/** 'YYYY-MM-DD' → 「9 月 14 日」 */
export function formatDateLabel(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${m} 月 ${d} 日`;
}

/** 時間顯示：今天只顯示時分；昨天加「昨天」；更早顯示月/日。 */
export function formatTime(ts, now = Date.now()) {
  const d = new Date(ts);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const key = dayKey(ts);
  if (key === dayKey(now)) return hm;
  if (key === dayKey(addDays(startOfDay(now), -1))) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** 幾句根據資料寫出來的觀察。labelOf 把原因代號轉成中文。 */
export function insights(sighs, now = Date.now(), labelOf = (r) => String(r)) {
  const s = summary(sighs, now);
  const out = [];
  if (s.total === 0) return ['還沒有紀錄。下次嘆氣的時候按一下，我會幫你記著。'];

  if (s.today === 0) {
    out.push('今天還沒嘆過氣。');
  } else if (s.activeDays >= 3 && s.today >= 3 && s.today > s.avgPerActiveDay * 1.5) {
    out.push(`今天已經 ${s.today} 次，比平常多。辛苦了。`);
  } else if (s.activeDays >= 3 && s.today < s.avgPerActiveDay * 0.5) {
    out.push('今天比平常平靜一些。');
  }

  if (s.total >= 5 && s.busiestHour != null) {
    out.push(`你最常在${hourLabel(s.busiestHour)}左右嘆氣。`);
  }
  if (s.topReason && s.topReason.count >= 3) {
    out.push(
      `最常讓你嘆氣的是「${labelOf(s.topReason.reason)}」，佔了 ${Math.round(s.topReason.ratio * 100)}%。`,
    );
  }
  if (s.daysTracked >= 8) {
    const diff = s.thisWeek - s.prevWeek;
    if (diff < 0) out.push(`這 7 天比前 7 天少嘆了 ${-diff} 次。`);
    else if (diff > 0) out.push(`這 7 天比前 7 天多嘆了 ${diff} 次。`);
    else out.push('這 7 天和前 7 天一樣多。');
  }
  if (s.longestCalm >= 6 * 3_600_000) {
    out.push(`最長曾有 ${formatDuration(s.longestCalm)} 沒有嘆氣。`);
  }
  if (s.maxDay && s.maxDay.count >= 5 && s.activeDays >= 2) {
    out.push(`嘆最多的一天是 ${formatDateLabel(s.maxDay.key)}，${s.maxDay.count} 次。`);
  }
  if (!out.length) out.push('才剛開始。多記幾天，這裡會慢慢出現一些觀察。');
  return out;
}
