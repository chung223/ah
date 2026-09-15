import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey,
  countToday,
  countsByDay,
  countsByHour,
  countsByReason,
  calmGaps,
  summary,
  insights,
  formatDuration,
  formatTime,
  hourLabel,
  periodLabel,
  periodKey,
  weekdayPeriodGrid,
  yearGrid,
  weekSummary,
  shortDate,
  PERIODS,
  streaks,
  yesterdayReview,
  monthRange,
  monthSummary,
  longestCalmRun,
  yearSummary,
} from '../src/stats.js';

// 全部用本機時間建構，測試不依賴時區。
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const now = at(2026, 9, 15, 15, 30);
const sighs = [
  { t: at(2026, 9, 10, 9), r: 'work' },
  { t: at(2026, 9, 12, 14), r: 'work' },
  { t: at(2026, 9, 14, 22), r: null },
  { t: at(2026, 9, 15, 8, 5), r: 'money' },
  { t: at(2026, 9, 15, 14, 10), r: 'work' },
];
const label = (r) => ({ work: '工作', money: '金錢' })[r] ?? '沒為什麼';

test('dayKey 用本機日期', () => {
  assert.equal(dayKey(at(2026, 9, 5, 0, 0)), '2026-09-05');
  assert.equal(dayKey(at(2026, 9, 5, 23, 59)), '2026-09-05');
});

test('countToday 只算今天', () => {
  assert.equal(countToday(sighs, now), 2);
  assert.equal(countToday([], now), 0);
});

test('countsByDay 回傳連續天數，最後一天是今天', () => {
  const days = countsByDay(sighs, 7, now);
  assert.equal(days.length, 7);
  assert.equal(days[0].key, '2026-09-09');
  assert.equal(days[6].key, '2026-09-15');
  assert.deepEqual(
    days.map((d) => d.count),
    [0, 1, 0, 1, 0, 1, 2],
  );
  assert.equal(days[6].weekday, '二');
});

test('countsByHour', () => {
  const hours = countsByHour(sighs);
  assert.equal(hours.length, 24);
  assert.equal(hours[9], 1);
  assert.equal(hours[14], 2);
  assert.equal(hours.reduce((a, b) => a + b, 0), 5);
});

test('countsByReason 由多到少，null 也算一類', () => {
  const r = countsByReason(sighs);
  assert.equal(r[0].reason, 'work');
  assert.equal(r[0].count, 3);
  assert.equal(r[0].ratio, 0.6);
  assert.ok(r.some((x) => x.reason === null && x.count === 1));
  assert.deepEqual(countsByReason([]), []);
});

test('calmGaps：最長間隔與目前間隔', () => {
  const g = calmGaps(sighs, now);
  assert.equal(g.current, now - at(2026, 9, 15, 14, 10));
  assert.equal(g.longest, at(2026, 9, 14, 22) - at(2026, 9, 12, 14));
  assert.equal(g.longestFrom, at(2026, 9, 12, 14));

  const empty = calmGaps([], now);
  assert.equal(empty.current, null);
  assert.equal(empty.longest, 0);

  // 上一次到現在比歷史間隔都長時，longest 要跟著變成 current
  const one = calmGaps([{ t: at(2026, 9, 1) }], now);
  assert.equal(one.longest, one.current);
});

test('summary', () => {
  const s = summary(sighs, now);
  assert.equal(s.total, 5);
  assert.equal(s.today, 2);
  assert.equal(s.activeDays, 4);
  assert.equal(s.daysTracked, 6);
  assert.deepEqual(s.maxDay, { key: '2026-09-15', count: 2 });
  assert.equal(s.busiestHour, 14);
  assert.equal(s.topReason.reason, 'work');
  assert.equal(s.thisWeek, 5);
  assert.equal(s.prevWeek, 0);
  assert.ok(Math.abs(s.avgPerActiveDay - 1.25) < 1e-9);

  const e = summary([], now);
  assert.equal(e.total, 0);
  assert.equal(e.busiestHour, null);
  assert.equal(e.maxDay, null);
  assert.equal(e.currentCalm, null);
});

test('insights 依資料組出句子', () => {
  const lines = insights(sighs, now, label);
  assert.ok(lines.some((l) => l.includes('下午 2 點')), lines.join('\n'));
  assert.ok(lines.some((l) => l.includes('「工作」') && l.includes('60%')), lines.join('\n'));
  assert.ok(lines.some((l) => l.includes('2 天 8 小時')), lines.join('\n'));
  assert.equal(insights([], now).length, 1);
  // 資料太少、沒有任何規則成立時，也要有一句話
  const few = [9, 10, 11].map((h) => ({ t: at(2026, 9, 15, h), r: null }));
  assert.deepEqual(insights(few, now, label), ['才剛開始。多記幾天，這裡會慢慢出現一些觀察。']);
});

test('insights：今天特別多、週對週比較', () => {
  const base = [];
  for (let d = 1; d <= 8; d++) base.push({ t: at(2026, 9, d, 10), r: null });
  const busy = [...base, ...[9, 10, 11, 12].map((h) => ({ t: at(2026, 9, 15, h), r: null }))];
  const lines = insights(busy, now, label);
  assert.ok(lines.some((l) => l.includes('比平常多')), lines.join('\n'));
  assert.ok(lines.some((l) => l.includes('這 7 天比前 7 天')), lines.join('\n'));
});

test('formatDuration', () => {
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(3000), '剛剛');
  assert.equal(formatDuration(42_000), '42 秒');
  assert.equal(formatDuration(5 * 60_000), '5 分鐘');
  assert.equal(formatDuration(2 * 3_600_000), '2 小時');
  assert.equal(formatDuration(2 * 3_600_000 + 15 * 60_000), '2 小時 15 分');
  assert.equal(formatDuration(3 * 86_400_000), '3 天');
  assert.equal(formatDuration(3 * 86_400_000 + 4 * 3_600_000), '3 天 4 小時');
});

test('formatTime：今天、昨天、更早', () => {
  assert.equal(formatTime(at(2026, 9, 15, 8, 5), now), '08:05');
  assert.equal(formatTime(at(2026, 9, 14, 22, 0), now), '昨天 22:00');
  assert.equal(formatTime(at(2026, 9, 10, 9, 0), now), '9/10 09:00');
});

test('時段文字', () => {
  assert.equal(periodLabel(23), '深夜');
  assert.equal(periodLabel(3), '深夜');
  assert.equal(periodLabel(7), '早上');
  assert.equal(hourLabel(0), '深夜 12 點');
  assert.equal(hourLabel(12), '中午 12 點');
  assert.equal(hourLabel(13), '下午 1 點');
  assert.equal(hourLabel(19), '晚上 7 點');
});

test('periodKey 與 PERIODS 對得上', () => {
  assert.equal(periodKey(5), 'morning');
  assert.equal(periodKey(12), 'noon');
  assert.equal(periodKey(17), 'afternoon');
  assert.equal(periodKey(21), 'evening');
  assert.equal(periodKey(22), 'night');
  assert.equal(periodKey(4), 'night');
  assert.deepEqual(PERIODS.map((p) => p.key), ['morning', 'noon', 'afternoon', 'evening', 'night']);
  assert.equal(shortDate('2026-09-05'), '9/5');
});

test('weekdayPeriodGrid', () => {
  const g = weekdayPeriodGrid(sighs);
  assert.equal(g.grid.length, 7);
  assert.equal(g.grid[0].length, 5);
  assert.equal(g.grid.flat().reduce((a, b) => a + b, 0), 5);
  // 9/15 是週二：08:05 早上、14:10 下午
  assert.equal(g.grid[2][0], 1);
  assert.equal(g.grid[2][2], 1);
  assert.equal(g.busiestWeekday, 2);
  assert.equal(g.busiest.count, 1);
  assert.equal(weekdayPeriodGrid([]).busiestWeekday, null);
});

test('yearGrid：53 欄 × 7 格，最後一格之後都是未來', () => {
  const g = yearGrid(sighs, now, 53);
  assert.equal(g.columns.length, 53);
  assert.equal(g.columns.every((c) => c.length === 7), true);
  const last = g.columns.at(-1);
  assert.equal(last[2].today, true, '9/15 是週二');
  assert.equal(last[3].future, true);
  assert.equal(last[2].count, 2);
  assert.equal(g.max, 2);
  assert.equal(g.total, 5);
  assert.equal(new Date(g.firstSunday).getDay(), 0);
  assert.ok(g.months.length >= 12);
  assert.equal(g.months[0].col, 0);
});

test('weekSummary：最近 7 天對比前 7 天', () => {
  const w = weekSummary(sighs, now, label);
  assert.equal(w.days.length, 7);
  assert.equal(w.total, 5);
  assert.equal(w.prevTotal, 0);
  assert.equal(w.diff, 5);
  assert.equal(w.rangeLabel, '9/9 – 9/15');
  assert.deepEqual({ key: w.maxDay.key, count: w.maxDay.count }, { key: '2026-09-15', count: 2 });
  assert.equal(w.topReason.label, '工作');
  assert.equal(w.topReason.count, 3);
  assert.equal(w.busiestHour, 14);
  assert.equal(w.activeDays, 4);
  assert.equal(w.noteCount, 0);
  const empty = weekSummary([], now, label);
  assert.equal(empty.maxDay, null);
  assert.equal(empty.topReason, null);
  assert.equal(empty.longestCalm, null);
});

test('insights：星期幾最常嘆氣', () => {
  const many = [];
  for (let d = 0; d < 28; d++) {
    const t = at(2026, 8, 19 + d, 10); // 8/19 起 28 天，每天一次
    many.push({ t, r: null });
    if (new Date(t).getDay() === 1) many.push({ t: t + 3_600_000, r: null }, { t: t + 7_200_000, r: null }); // 週一三次
  }
  const lines = insights(many, now, label);
  assert.ok(lines.some((l) => l.includes('星期一')), lines.join('\n'));
});

test('streaks：連續沒嘆氣、連續有紀錄', () => {
  assert.deepEqual(streaks([], now), { calmDays: 0, recordDays: 0 });
  // 今天有嘆 → calm 0；9/14、9/15 連續有紀錄 → 2
  assert.deepEqual(streaks(sighs, now), { calmDays: 0, recordDays: 2 });
  // 只有 9/10 一筆：今天往回 9/15..9/11 共 5 天沒嘆；有紀錄的連續天數從昨天起算，昨天沒有 → 0
  assert.deepEqual(streaks([{ t: at(2026, 9, 10, 9) }], now), { calmDays: 5, recordDays: 0 });
  // 昨天有、今天還沒 → recordDays 從昨天算
  const four = [11, 12, 13, 14].map((d) => ({ t: at(2026, 9, d, 9) }));
  assert.deepEqual(streaks(four, now), { calmDays: 1, recordDays: 4 });
});

test('yesterdayReview', () => {
  const r = yesterdayReview(sighs, now, label);
  assert.equal(r.key, '2026-09-14');
  assert.equal(r.count, 1);
  assert.equal(r.topReason, null, '昨天那筆沒有原因');
  assert.equal(r.busiestPeriod, '深夜');
  assert.deepEqual(r.notes, []);
  assert.equal(r.weekCount, 3);

  const rich = [
    { t: at(2026, 9, 14, 9), r: 'work', n: '早上開會' },
    { t: at(2026, 9, 14, 10), r: 'work', i: 2 },
    { t: at(2026, 9, 14, 15), r: 'money', n: '帳單' },
  ];
  const r2 = yesterdayReview(rich, now, label);
  assert.equal(r2.count, 3);
  assert.equal(r2.longCount, 1);
  assert.equal(r2.topReason, '工作');
  assert.equal(r2.busiestPeriod, '早上');
  assert.deepEqual(r2.notes, ['早上開會', '帳單']);
  assert.equal(yesterdayReview([], now, label).count, 0);
});

test('summary 會數長嘆', () => {
  const s = summary([{ t: at(2026, 9, 15, 9), i: 2 }, { t: at(2026, 9, 15, 10) }], now);
  assert.equal(s.longCount, 1);
});

test('monthRange 與 monthSummary', () => {
  const r = monthRange(2026, 2);
  assert.equal(r.days, 28);
  assert.equal(r.label, '2026 年 2 月');
  assert.equal(monthRange(2024, 2).days, 29);

  const m = monthSummary(sighs, 2026, 9, now, label);
  assert.equal(m.total, 5);
  assert.equal(m.days.length, 30);
  assert.equal(m.isCurrent, true);
  assert.equal(m.days[14].count, 2, '9/15');
  assert.equal(m.days[29].future, true, '9/30 還沒到');
  assert.deepEqual({ day: m.maxDay.day, count: m.maxDay.count }, { day: 15, count: 2 });
  assert.equal(m.topReasons[0].label, '工作');
  assert.equal(m.topReasons[0].count, 3);
  assert.equal(m.prevTotal, 0);
  assert.equal(m.diff, 5);
  assert.equal(m.busiestHour, 14);
  assert.equal(m.busiestPeriod.label, '早上', '早上與下午各 2 次，平手時取順序最前面的');
  assert.equal(m.activeDays, 4);
  assert.ok(Math.abs(m.avgPerDay - 5 / 15) < 1e-9, '本月到今天為止 15 天');
  const empty = monthSummary([], 2026, 8, now, label);
  assert.equal(empty.total, 0);
  assert.equal(empty.maxDay, null);
  assert.equal(empty.longestCalm, null);
  assert.equal(empty.isCurrent, false);
  assert.ok(Math.abs(empty.avgPerDay) < 1e-9);
});

test('longestCalmRun 與 yearSummary', () => {
  // 9/10、9/12、9/14、9/15 有紀錄 → 最長空檔是 9/11 或 9/13（各 1 天）
  const run = longestCalmRun(sighs, 2026, now);
  assert.equal(run.days, 1);
  const spread = [{ t: at(2026, 3, 1, 9) }, { t: at(2026, 3, 20, 9) }, { t: at(2026, 9, 15, 9) }];
  const run2 = longestCalmRun(spread, 2026, now);
  assert.equal(run2.days, 178, '3/21 到 9/14');
  assert.equal(dayKey(run2.from), '2026-03-21');
  assert.equal(dayKey(run2.to), '2026-09-14');
  assert.equal(longestCalmRun([], 2026, now).days, 0);

  const y = yearSummary(sighs, 2026, now, label);
  assert.equal(y.total, 5);
  assert.equal(y.months.length, 12);
  assert.equal(y.months[8].count, 5, '九月');
  assert.equal(y.busiestMonth.month, 9);
  assert.deepEqual(y.maxDay, { key: '2026-09-15', count: 2 });
  assert.equal(y.busiestWeekday, 2);
  assert.equal(y.busiestCell.weekday, 1, '每格都是 1 次，平手時取順序最前面的（星期一深夜）');
  assert.equal(y.busiestCell.period, '深夜');
  assert.equal(y.topReasons[0].label, '工作');
  assert.equal(y.activeDays, 4);
  assert.equal(y.firstKey, '2026-09-10');
  assert.equal(y.isCurrent, true);
  assert.equal(yearSummary(sighs, 2025, now, label).total, 0);
  assert.equal(yearSummary([], 2026, now, label).busiestMonth, null);
});
