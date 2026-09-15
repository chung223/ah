import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEvent, spectralFlatness, movingAverage, paramsFor, profileFromSamples } from '../src/detector.js';

const frames = (dbs, flat, step = 40) => dbs.map((db, i) => ({ t: i * step, db, flat }));

test('spectralFlatness：白噪音接近 1，純音接近 0', () => {
  assert.ok(spectralFlatness(new Array(64).fill(1)) > 0.999);
  const tone = new Array(64).fill(1e-6);
  tone[10] = 1;
  assert.ok(spectralFlatness(tone) < 0.05);
  assert.equal(spectralFlatness([]), 0);
});

test('movingAverage', () => {
  assert.deepEqual(movingAverage([0, 3, 0], 3), [1.5, 1, 1.5]);
});

test('像嘆氣：快速升起、慢慢漸弱、氣音多 → sigh', () => {
  const dbs = [];
  for (let i = 0; i < 30; i++) dbs.push(i < 3 ? -20 + i * 3 : -12 - (i - 3) * 0.7);
  const r = classifyEvent(frames(dbs, 0.3));
  assert.equal(r.sigh, true, JSON.stringify(r));
  assert.equal(r.why, 'sigh');
  assert.ok(r.peakPos <= 0.6);
  assert.ok(r.peaks <= 2);
});

test('像說話：很多音節起伏而且有音高 → 不是嘆氣', () => {
  const dbs = [];
  for (let i = 0; i < 40; i++) dbs.push(-14 + 8 * Math.sin(i * 0.9));
  const r = classifyEvent(frames(dbs, 0.05));
  assert.equal(r.sigh, false);
  assert.ok(['too-bumpy', 'too-tonal', 'peak-late', 'no-decay'].includes(r.why), r.why);
});

test('持續的哼聲：沒有漸弱、太有音高 → 不是嘆氣', () => {
  const r = classifyEvent(frames(new Array(30).fill(-15), 0.02));
  assert.equal(r.sigh, false);
});

test('太短或太長都不算', () => {
  assert.equal(classifyEvent(frames([-10, -10, -10], 0.3)).why, 'too-short');
  assert.equal(classifyEvent(frames(new Array(2).fill(-10), 0.3)).why, 'too-short');
  const long = [];
  for (let i = 0; i < 200; i++) long.push(-12 - i * 0.05);
  assert.equal(classifyEvent(frames(long, 0.3)).why, 'too-long');
});

test('靈敏度愈高，門檻愈低', () => {
  const low = paramsFor(0);
  const high = paramsFor(1);
  assert.ok(low.riseDb > high.riseDb);
  assert.ok(low.minFlat > high.minFlat);
  assert.deepEqual(paramsFor('garbage'), paramsFor(0));
  assert.deepEqual(paramsFor(5), paramsFor(1));
});

test('校正：從樣本算出個人門檻，靈敏度只做微調', () => {
  assert.equal(profileFromSamples([]), null);
  assert.equal(profileFromSamples([{ meanFlat: 0.3, dur: 900, rise: 20 }]), null, '一個樣本不夠');
  const p = profileFromSamples([
    { meanFlat: 0.3, dur: 900, rise: 20 },
    { meanFlat: 0.2, dur: 1300, rise: 14 },
    { meanFlat: 0.25, dur: 100, rise: 9 }, // 太短的樣本被忽略
  ]);
  assert.ok(Math.abs(p.minFlat - 0.14) < 1e-9);
  assert.equal(p.riseDb, 7);
  assert.equal(p.minDur, 540);
  assert.equal(p.maxDur, 2600);

  const mid = paramsFor(0.5, p);
  assert.ok(Math.abs(mid.minFlat - p.minFlat) < 1e-9);
  assert.equal(mid.riseDb, p.riseDb);
  assert.equal(mid.minDur, 540);
  const high = paramsFor(1, p);
  assert.ok(high.riseDb < mid.riseDb && high.minFlat < mid.minFlat);
  assert.equal(paramsFor(0.5, { minFlat: 'x' }).minDur, 450, '壞掉的校正就用預設');
});
