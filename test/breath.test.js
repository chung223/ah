import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSuggestBreathing, recentCount, createBreathSession, BREATH_PATTERN } from '../src/breath.js';

test('一小時內 5 次才建議', () => {
  const now = 10_000_000;
  const mk = (n, spread) => Array.from({ length: n }, (_, i) => ({ t: now - i * spread })).reverse();
  assert.equal(shouldSuggestBreathing(mk(4, 60_000), now), false);
  assert.equal(shouldSuggestBreathing(mk(5, 60_000), now), true);
  assert.equal(shouldSuggestBreathing(mk(5, 20 * 60_000), now), false, '拉太開就不算');
  assert.equal(recentCount(mk(7, 5 * 60_000), now), 7);
  assert.equal(recentCount([], now), 0);
});

test('呼吸練習：五輪、每輪三個階段，最後 onDone', () => {
  const timers = [];
  const setTimeoutFn = (fn, ms) => {
    timers.push({ fn, ms });
    return timers.length;
  };
  const phases = [];
  let done = null;
  const session = createBreathSession({
    onPhase: (p) => phases.push(p),
    onDone: (d) => (done = d),
    cycles: 2,
    setTimeoutFn,
    clearTimeoutFn: () => {},
  });
  session.start();
  while (timers.length && !done) timers.shift().fn();
  assert.equal(phases.length, 2 * BREATH_PATTERN.length);
  assert.equal(phases[0].phase, '吸氣');
  assert.equal(phases[0].cycle, 1);
  assert.equal(phases.at(-1).phase, '吐氣');
  assert.equal(phases.at(-1).cycle, 2);
  assert.deepEqual(done, { completed: true });
  assert.equal(session.running, false);
});

test('中途 stop 會清掉計時器並回報未完成', () => {
  let cleared = null;
  let done = null;
  const session = createBreathSession({
    onDone: (d) => (done = d),
    setTimeoutFn: () => 42,
    clearTimeoutFn: (id) => (cleared = id),
  });
  session.start();
  assert.equal(session.running, true);
  session.stop();
  assert.equal(cleared, 42);
  assert.deepEqual(done, { completed: false });
  session.stop();
  assert.deepEqual(done, { completed: false }, '重複 stop 不會再回呼');
});
