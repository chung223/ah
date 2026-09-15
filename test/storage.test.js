import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore,
  defaultState,
  normalizeState,
  mergeSighs,
  parseImport,
  toCSV,
  exportJSON,
  STORAGE_KEY,
} from '../src/storage.js';

function memStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('空的或壞掉的儲存 → 預設狀態', () => {
  const s = memStorage();
  const store = createStore(s);
  assert.deepEqual(store.load(), defaultState());
  s.setItem(STORAGE_KEY, '{not json');
  assert.deepEqual(store.load(), defaultState());
  s.setItem(STORAGE_KEY, '"a string"');
  assert.deepEqual(store.load(), defaultState());
});

test('save / load 來回，會排序並正規化', () => {
  const s = memStorage();
  const store = createStore(s);
  const state = defaultState();
  state.sighs = [
    { t: 300, r: 'work' },
    { t: 100, r: 'bogus' },
    { t: 200, r: null, a: true },
  ];
  state.settings.theme = 'light';
  state.settings.sound = true;
  state.settings.sensitivity = 0.8;
  state.settings.reason = 'money';
  assert.equal(store.save(state), true);

  const loaded = store.load();
  assert.deepEqual(
    loaded.sighs.map((x) => x.t),
    [100, 200, 300],
  );
  assert.equal(loaded.sighs[0].r, null, '未知的原因代號變成 null');
  assert.equal(loaded.sighs[1].a, 1);
  assert.equal(loaded.sighs[2].a, undefined);
  assert.deepEqual(loaded.settings, { theme: 'light', sound: true, sensitivity: 0.8, reason: 'money' });

  store.clear();
  assert.deepEqual(store.load(), defaultState());
});

test('normalizeState 丟掉不合法的紀錄與設定', () => {
  const st = normalizeState({
    sighs: [null, 'x', { t: 'abc' }, { t: -5 }, { t: 12.6, r: 'love' }],
    settings: { theme: 'neon', sound: 'yes', sensitivity: 9, reason: 'nope' },
  });
  assert.deepEqual(st.sighs, [{ t: 13, r: 'love' }]);
  assert.deepEqual(st.settings, { theme: 'auto', sound: false, sensitivity: 1, reason: null });
});

test('儲存失敗（例如空間不足）回傳 false 而不丟錯', () => {
  const store = createStore({
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  });
  assert.equal(store.save(defaultState()), false);
});

test('mergeSighs 以時間戳去重並排序', () => {
  const merged = mergeSighs(
    [
      { t: 100, r: null },
      { t: 200, r: 'work' },
    ],
    [
      { t: 200, r: 'money' },
      { t: 50, r: null },
      { t: 'bad' },
    ],
  );
  assert.deepEqual(merged, [
    { t: 50, r: null },
    { t: 100, r: null },
    { t: 200, r: 'money' },
  ]);
});

test('parseImport 接受整份匯出或純陣列，拒絕其他東西', () => {
  const full = exportJSON({ sighs: [{ t: 5, r: 'work' }] }, 0);
  assert.deepEqual(parseImport(full), [{ t: 5, r: 'work' }]);
  assert.deepEqual(parseImport('[{"t":7}]'), [{ t: 7, r: null }]);
  assert.throws(() => parseImport('{"foo":1}'));
  assert.throws(() => parseImport('not json'));
});

test('exportJSON 帶有識別欄位', () => {
  const obj = JSON.parse(exportJSON({ sighs: [{ t: 1, r: null }] }, 0));
  assert.equal(obj.app, 'ah-sigh-counter');
  assert.equal(obj.v, 1);
  assert.equal(typeof obj.exportedAt, 'string');
  assert.deepEqual(obj.sighs, [{ t: 1, r: null }]);
});

test('toCSV 有標題列，會跳脫逗號與引號', () => {
  const csv = toCSV([{ t: 1000, r: 'work', a: 1 }], (r) => (r === 'work' ? '工作, "加班"' : '沒為什麼'));
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'timestamp,datetime,reason,reason_label,auto');
  assert.ok(lines[1].startsWith('1000,'));
  assert.ok(lines[1].endsWith(',work,"工作, ""加班""",1'), lines[1]);
  assert.equal(toCSV([]).trim().split('\n').length, 1);
});
