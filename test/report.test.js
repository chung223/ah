import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapChars, reportFilename } from '../src/report.js';

const ctx = { measureText: (s) => ({ width: [...s].length * 10 }) };

test('wrapChars 逐字換行、最多幾行', () => {
  assert.deepEqual(wrapChars(ctx, '一二三四五六七', 30), ['一二三', '四五六']);
  assert.deepEqual(wrapChars(ctx, '一二三四五六七', 30, 3), ['一二三', '四五六', '七']);
  assert.deepEqual(wrapChars(ctx, '短', 30), ['短']);
  assert.deepEqual(wrapChars(ctx, '', 30), []);
});

test('reportFilename 帶日期', () => {
  assert.equal(reportFilename({}, new Date(2026, 8, 15)), 'sigh-report-2026-09-15.png');
});

test('reportFilename 依種類命名', () => {
  assert.equal(reportFilename({ kind: 'month', year: 2026, month: 9 }), 'sigh-report-2026-09.png');
  assert.equal(reportFilename({ kind: 'year', year: 2026 }), 'sigh-report-2026.png');
});

test('fitText 超出寬度時截斷加省略號', async () => {
  const { fitText } = await import('../src/report.js');
  assert.equal(fitText(ctx, '一二三', 100), '一二三');
  assert.equal(fitText(ctx, '一二三四五六七八九十', 55), '一二三四…');
});
