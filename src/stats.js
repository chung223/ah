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
  const longCount = sighs.filter((s) => s.i === 2).length;

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
    longCount,
    thisWeek,
    prevWeek,
  };
}

export const PERIODS = [
  { key: 'morning', label: '早上', hours: '5–10 點' },
  { key: 'noon', label: '中午', hours: '11–12 點' },
  { key: 'afternoon', label: '下午', hours: '13–17 點' },
  { key: 'evening', label: '晚上', hours: '18–21 點' },
  { key: 'night', label: '深夜', hours: '22–4 點' },
];

export function periodKey(h) {
  if (h >= 5 && h <= 10) return 'morning';
  if (h >= 11 && h <= 12) return 'noon';
  if (h >= 13 && h <= 17) return 'afternoon';
  if (h >= 18 && h <= 21) return 'evening';
  return 'night';
}

export function periodLabel(h) {
  return PERIODS.find((p) => p.key === periodKey(h)).label;
}

/** 'YYYY-MM-DD' → '9/14' */
export function shortDate(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${m}/${d}`;
}

/** 星期 × 時段 的次數表：grid[星期 0–6][時段索引]。 */
export function weekdayPeriodGrid(sighs) {
  const grid = Array.from({ length: 7 }, () => new Array(PERIODS.length).fill(0));
  let max = 0;
  for (const s of sighs) {
    const d = new Date(s.t);
    const r = d.getDay();
    const c = PERIODS.findIndex((p) => p.key === periodKey(d.getHours()));
    grid[r][c]++;
    if (grid[r][c] > max) max = grid[r][c];
  }
  const weekdayTotals = grid.map((row) => row.reduce((a, b) => a + b, 0));
  const busiestWeekday = sighs.length ? weekdayTotals.indexOf(Math.max(...weekdayTotals)) : null;
  let busiest = null;
  grid.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v > 0 && (!busiest || v > busiest.count)) busiest = { weekday: r, period: PERIODS[c].key, count: v };
    }),
  );
  return { grid, max, weekdayTotals, busiestWeekday, busiest };
}

/**
 * 熱力圖資料：最近 weeks 週，每欄一週（週日開始），最後一欄包含今天。
 * columns[w][d] = { key, start, count, future, today }
 */
export function yearGrid(sighs, now = Date.now(), weeks = 53) {
  const map = countsByDayMap(sighs);
  const today = startOfDay(now);
  const lastSunday = addDays(today, -new Date(today).getDay());
  const firstSunday = addDays(lastSunday, -(weeks - 1) * 7);
  const columns = [];
  const months = [];
  let max = 0;
  let total = 0;
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const start = addDays(firstSunday, w * 7 + d);
      const future = start > today;
      const key = dayKey(start);
      const count = future ? 0 : map.get(key) || 0;
      if (count > max) max = count;
      total += count;
      col.push({ key, start, count, future, today: start === today });
    }
    const m = new Date(col[0].start).getMonth();
    if (m !== lastMonth) {
      months.push({ col: w, label: `${m + 1}月` });
      lastMonth = m;
    }
    columns.push(col);
  }
  return { columns, max, months, total, firstSunday, lastSunday };
}

/**
 * 連續天數：
 * - calmDays：從今天往回數、連續沒嘆氣的天數（今天有嘆就是 0）
 * - recordDays：連續有紀錄的天數（今天還沒有的話，從昨天起算）
 */
export function streaks(sighs, now = Date.now()) {
  if (!sighs.length) return { calmDays: 0, recordDays: 0 };
  const map = countsByDayMap(sighs);
  const today = startOfDay(now);
  const firstDay = startOfDay(sighs[0].t);
  let calmDays = 0;
  for (let i = 0; i < 3650; i++) {
    const d = addDays(today, -i);
    if (d < firstDay || map.get(dayKey(d))) break;
    calmDays++;
  }
  let recordDays = 0;
  const startOffset = map.get(dayKey(today)) ? 0 : 1;
  for (let i = startOffset; i < 3650 + startOffset; i++) {
    if (!map.get(dayKey(addDays(today, -i)))) break;
    recordDays++;
  }
  return { calmDays, recordDays };
}

/** 昨天回顧：幾次、最常的原因、最常的時段、幾則筆記。 */
export function yesterdayReview(sighs, now = Date.now(), labelOf = (r) => String(r)) {
  const y1 = startOfDay(now);
  const y0 = addDays(y1, -1);
  const list = sighs.filter((s) => s.t >= y0 && s.t < y1);
  const top = countsByReason(list).find((r) => r.reason != null) || null;
  const periodCounts = new Map();
  for (const s of list) {
    const k = periodKey(new Date(s.t).getHours());
    periodCounts.set(k, (periodCounts.get(k) || 0) + 1);
  }
  let busiest = null;
  for (const p of PERIODS) {
    const c = periodCounts.get(p.key) || 0;
    if (c && (!busiest || c > busiest.count)) busiest = { label: p.label, count: c };
  }
  const weekCount = sighs.filter((s) => s.t >= addDays(y1, -7) && s.t < y1).length;
  return {
    key: dayKey(y0),
    count: list.length,
    longCount: list.filter((s) => s.i === 2).length,
    topReason: top ? labelOf(top.reason) : null,
    busiestPeriod: busiest ? busiest.label : null,
    notes: list.filter((s) => s.n).map((s) => s.n).slice(0, 3),
    weekCount,
  };
}

/** 某年某月（month 1–12）的範圍與天數。 */
export function monthRange(year, month) {
  const start = new Date(year, month - 1, 1).getTime();
  const end = new Date(year, month, 1).getTime();
  const days = new Date(year, month, 0).getDate();
  return { start, end, days, label: `${year} 年 ${month} 月` };
}

function topReasons(list, labelOf, n = 3) {
  return countsByReason(list)
    .filter((r) => r.reason != null)
    .slice(0, n)
    .map((r) => ({ reason: r.reason, label: labelOf(r.reason), count: r.count, ratio: r.ratio }));
}

function busiestPeriodOf(list) {
  const counts = new Map();
  for (const s of list) {
    const k = periodKey(new Date(s.t).getHours());
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null;
  for (const p of PERIODS) {
    const c = counts.get(p.key) || 0;
    if (c && (!best || c > best.count)) best = { key: p.key, label: p.label, count: c };
  }
  return best;
}

/** 月報：某年某月，對比上個月。 */
export function monthSummary(sighs, year, month, now = Date.now(), labelOf = (r) => String(r)) {
  const range = monthRange(year, month);
  const prevRange = monthRange(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);
  const list = sighs.filter((s) => s.t >= range.start && s.t < range.end);
  const prevTotal = sighs.filter((s) => s.t >= prevRange.start && s.t < prevRange.end).length;
  const map = countsByDayMap(list);
  const days = [];
  for (let d = 1; d <= range.days; d++) {
    const t = new Date(year, month - 1, d).getTime();
    days.push({ day: d, key: dayKey(t), start: t, count: map.get(dayKey(t)) || 0, future: t > now });
  }
  const maxDay = days.reduce((m, d) => (!m || d.count > m.count ? d : m), null);
  const hours = countsByHour(list);
  const isCurrent = now >= range.start && now < range.end;
  const elapsedDays = isCurrent ? Math.max(1, Math.round((startOfDay(now) - range.start) / DAY_MS) + 1) : range.days;
  const total = list.length;
  return {
    year,
    month,
    label: range.label,
    isCurrent,
    days,
    total,
    prevTotal,
    diff: total - prevTotal,
    avgPerDay: total / elapsedDays,
    maxDay: maxDay && maxDay.count ? maxDay : null,
    topReasons: topReasons(list, labelOf),
    busiestHour: total ? hours.indexOf(Math.max(...hours)) : null,
    busiestPeriod: busiestPeriodOf(list),
    longestCalm: total ? calmGaps(list, Math.min(now, range.end - 1)).longest : null,
    activeDays: days.filter((d) => d.count).length,
    noteCount: list.filter((s) => s.n).length,
    longCount: list.filter((s) => s.i === 2).length,
  };
}

/** 一年裡最長的一段連續沒嘆氣（天數與起訖），從該年第一天或第一筆紀錄起算到今天／年底。 */
export function longestCalmRun(sighs, year, now = Date.now()) {
  if (!sighs.length) return { days: 0, from: null, to: null };
  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd = new Date(year + 1, 0, 1).getTime();
  const first = startOfDay(sighs[0].t);
  const from = Math.max(yearStart, first);
  const last = Math.min(startOfDay(now), yearEnd - 1);
  if (from > last) return { days: 0, from: null, to: null };
  const map = countsByDayMap(sighs);
  let best = { days: 0, from: null, to: null };
  let run = 0;
  let runStart = null;
  for (let d = from; d <= last; d = addDays(d, 1)) {
    if (map.get(dayKey(d))) {
      run = 0;
      runStart = null;
      continue;
    }
    if (!run) runStart = d;
    run++;
    if (run > best.days) best = { days: run, from: runStart, to: d };
  }
  return best;
}

/** 年度回顧。 */
export function yearSummary(sighs, year, now = Date.now(), labelOf = (r) => String(r)) {
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  const list = sighs.filter((s) => s.t >= start && s.t < end);
  const total = list.length;
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0 }));
  for (const s of list) months[new Date(s.t).getMonth()].count++;
  const busiestMonth = total ? months.reduce((m, x) => (x.count > m.count ? x : m), months[0]) : null;
  const dayMap = countsByDayMap(list);
  let maxDay = null;
  for (const [key, count] of dayMap) if (!maxDay || count > maxDay.count) maxDay = { key, count };
  const grid = weekdayPeriodGrid(list);
  const hours = countsByHour(list);
  const isCurrent = now >= start && now < end;
  const elapsedDays = isCurrent ? Math.max(1, Math.round((startOfDay(now) - start) / DAY_MS) + 1) : Math.round((end - start) / DAY_MS);
  return {
    year,
    label: `${year} 年`,
    isCurrent,
    total,
    months,
    busiestMonth,
    maxDay,
    busiestWeekday: grid.busiestWeekday,
    busiestCell: grid.busiest ? { weekday: grid.busiest.weekday, period: PERIODS.find((p) => p.key === grid.busiest.period).label } : null,
    busiestHour: total ? hours.indexOf(Math.max(...hours)) : null,
    busiestPeriod: busiestPeriodOf(list),
    topReasons: topReasons(list, labelOf),
    calmRun: longestCalmRun(sighs, year, now),
    activeDays: dayMap.size,
    avgPerDay: total / elapsedDays,
    noteCount: list.filter((s) => s.n).length,
    longCount: list.filter((s) => s.i === 2).length,
    firstKey: total ? dayKey(list[0].t) : null,
  };
}

/** 週報用的摘要：最近 7 天（含今天）對比前 7 天。 */
export function weekSummary(sighs, now = Date.now(), labelOf = (r) => String(r)) {
  const fortnight = countsByDay(sighs, 14, now);
  const days = fortnight.slice(7);
  const prev = fortnight.slice(0, 7);
  const sum = (arr) => arr.reduce((a, d) => a + d.count, 0);
  const total = sum(days);
  const prevTotal = sum(prev);
  const start = days[0].start;
  const endExclusive = addDays(days[6].start, 1);
  const inWeek = sighs.filter((s) => s.t >= start && s.t < endExclusive);
  const top = countsByReason(inWeek).find((r) => r.reason != null) || null;
  const maxDay = days.reduce((m, d) => (!m || d.count > m.count ? d : m), null);
  const hours = countsByHour(inWeek);
  return {
    rangeLabel: `${shortDate(days[0].key)} – ${shortDate(days[6].key)}`,
    days,
    total,
    prevTotal,
    diff: total - prevTotal,
    maxDay: maxDay && maxDay.count ? maxDay : null,
    topReason: top ? { reason: top.reason, label: labelOf(top.reason), count: top.count, ratio: top.ratio } : null,
    longestCalm: inWeek.length ? calmGaps(inWeek, now).longest : null,
    busiestHour: inWeek.length ? hours.indexOf(Math.max(...hours)) : null,
    activeDays: days.filter((d) => d.count).length,
    noteCount: inWeek.filter((s) => s.n).length,
  };
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
  if (s.total >= 14) {
    const g = weekdayPeriodGrid(sighs);
    if (g.busiestWeekday != null && g.weekdayTotals[g.busiestWeekday] >= (s.total / 7) * 1.4) {
      out.push(`星期${WEEKDAYS[g.busiestWeekday]}是你最常嘆氣的日子。`);
    }
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
