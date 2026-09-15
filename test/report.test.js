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
