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
