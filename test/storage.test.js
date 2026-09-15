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
  cleanNote,
  STORAGE_KEY,
  TRASH_TTL,
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
    { t: 300, r: 'work', n: '  客戶又改  需求 ' },
    { t: 100, r: 'bogus' },
    { t: 200, r: null, a: true },
  ];
  state.deleted = [50, 50, 'x', 10];
  state.settings.theme = 'light';
  state.settings.sound = true;
  state.settings.badge = false;
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
  assert.equal(loaded.sighs[2].n, '客戶又改 需求');
  assert.deepEqual(loaded.deleted, [10, 50]);
  assert.equal(loaded.settings.theme, 'light');
  assert.equal(loaded.settings.sound, true);
  assert.equal(loaded.settings.badge, false);
  assert.equal(loaded.settings.sensitivity, 0.8);
  assert.equal(loaded.settings.reason, 'money');

  store.clear();
  assert.deepEqual(store.load(), defaultState());
});

test('舊版（v1）資料載入後補上新欄位', () => {
  const st = normalizeState({ v: 1, sighs: [{ t: 5, r: 'work' }], settings: { theme: 'dark' } });
  assert.equal(st.v, 2);
  assert.deepEqual(st.deleted, []);
  assert.equal(st.trash, null);
  assert.equal(st.settings.badge, true);
  assert.equal(st.settings.reasonMode, 'manual');
  assert.deepEqual(st.settings.customReasons, []);
  assert.equal(st.settings.reasonOrder, null);
  assert.equal(st.settings.micProfile, null);
  assert.equal(st.settings.sync, null);
  assert.equal(st.settings.lastReviewDay, null);
  assert.deepEqual(Object.keys(st.settings.periodReasons), ['morning', 'noon', 'afternoon', 'evening', 'night']);
});

test('長嘆、捷徑旗標與回收桶', () => {
  const now = 1_000_000_000;
  const st = normalizeState(
    {
      sighs: [
        { t: 1, r: null, i: 2, s: 1 },
        { t: 2, r: null, i: 1, s: 0 },
      ],
      trash: { at: now - 1000, sighs: [{ t: 9, r: 'work' }, { t: 3 }] },
      settings: { lastReviewDay: '2026-09-15', sync: { token: 'x', force: true } },
    },
    now,
  );
  assert.deepEqual(st.sighs, [
    { t: 1, r: null, i: 2, s: 1 },
    { t: 2, r: null },
  ]);
  assert.deepEqual(st.trash, {
    at: now - 1000,
    sighs: [
      { t: 3, r: null },
      { t: 9, r: 'work' },
    ],
  });
  assert.equal(st.settings.lastReviewDay, '2026-09-15');
  assert.equal(st.settings.sync.force, true);

  const expired = normalizeState({ trash: { at: now - TRASH_TTL - 1, sighs: [{ t: 9 }] } }, now);
  assert.equal(expired.trash, null, '超過 24 小時就丟掉');
  assert.equal(normalizeState({ trash: { at: now, sighs: [] } }, now).trash, null);
  assert.equal(normalizeState({ settings: { lastReviewDay: 'bogus' } }).settings.lastReviewDay, null);
});

test('normalizeState 丟掉不合法的紀錄與設定', () => {
  const st = normalizeState({
    sighs: [null, 'x', { t: 'abc' }, { t: -5 }, { t: 12.6, r: 'love' }],
    settings: { theme: 'neon', sound: 'yes', sensitivity: 9, reason: 'nope', reasonMode: 'x' },
  });
  assert.deepEqual(st.sighs, [{ t: 13, r: 'love' }]);
  assert.equal(st.settings.theme, 'auto');
  assert.equal(st.settings.sound, false);
  assert.equal(st.settings.sensitivity, 1);
  assert.equal(st.settings.reason, null);
  assert.equal(st.settings.reasonMode, 'manual');
});

test('自訂標籤、時段、校正、同步設定的正規化', () => {
  const st = normalizeState({
    sighs: [{ t: 1, r: 'c_abcd12' }],
    settings: {
      customReasons: [{ id: 'c_abcd12', label: ' 房東 ' }, { id: 'bad', label: 'x' }, { id: 'c_abcd12', label: '重複' }],
      reasonOrder: ['c_abcd12', 'work', 'nope', 'c_zzzz99'],
      reason: 'c_zzzz99',
      reasonMode: 'period',
      periodReasons: { morning: 'work', night: 'c_abcd12', bogus: 'work' },
      micProfile: { minFlat: 0.1, riseDb: 8, minDur: 300 },
      sync: { token: ' tok ', gistId: 'abc', lastSync: 123 },
    },
  });
  assert.deepEqual(st.settings.customReasons, [{ id: 'c_abcd12', label: '房東' }]);
  assert.deepEqual(st.settings.reasonOrder, ['c_abcd12', 'work']);
  assert.equal(st.settings.reason, null, '指到不存在的自訂標籤 → null');
  assert.equal(st.settings.reasonMode, 'period');
  assert.deepEqual(st.settings.periodReasons, { morning: 'work', noon: null, afternoon: null, evening: null, night: 'c_abcd12' });
  assert.deepEqual(st.settings.micProfile, { minFlat: 0.1, riseDb: 8, minDur: 300, maxDur: 4500 });
  assert.deepEqual(st.settings.sync, { token: 'tok', gistId: 'abc', lastSync: 123, force: false });
  assert.equal(st.sighs[0].r, 'c_abcd12', '紀錄上的自訂代號保留');

  const bad = normalizeState({ settings: { micProfile: { minFlat: 'x' }, sync: { token: '' } } });
  assert.equal(bad.settings.micProfile, null);
  assert.equal(bad.settings.sync, null);
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

test('mergeSighs 以時間戳去重並排序，筆記與旗標不會被空的蓋掉', () => {
  const merged = mergeSighs(
    [
      { t: 100, r: null, n: '第一句', i: 2 },
      { t: 200, r: 'work' },
    ],
    [
      { t: 200, r: 'money' },
      { t: 100, r: null },
      { t: 50, r: null },
      { t: 'bad' },
    ],
  );
  assert.deepEqual(merged, [
    { t: 50, r: null },
    { t: 100, r: null, i: 2, n: '第一句' },
    { t: 200, r: 'money' },
  ]);
});

test('parseImport 接受整份匯出或純陣列，會帶回自訂標籤，拒絕其他東西', () => {
  const state = defaultState();
  state.sighs = [{ t: 5, r: 'work' }];
  state.settings.customReasons = [{ id: 'c_abcd12', label: '房東' }];
  const full = exportJSON(state, 0);
  assert.deepEqual(parseImport(full), { sighs: [{ t: 5, r: 'work' }], customReasons: [{ id: 'c_abcd12', label: '房東' }] });
  assert.deepEqual(parseImport('[{"t":7}]'), { sighs: [{ t: 7, r: null }], customReasons: [] });
  assert.throws(() => parseImport('{"foo":1}'));
  assert.throws(() => parseImport('not json'));
});

test('exportJSON 帶有識別欄位', () => {
  const obj = JSON.parse(exportJSON({ sighs: [{ t: 1, r: null }], settings: { customReasons: [] } }, 0));
  assert.equal(obj.app, 'ah-sigh-counter');
  assert.equal(obj.v, 2);
  assert.equal(typeof obj.exportedAt, 'string');
  assert.deepEqual(obj.sighs, [{ t: 1, r: null }]);
});

test('toCSV 有標題列（含筆記、長嘆、捷徑），會跳脫逗號與引號', () => {
  const csv = toCSV([{ t: 1000, r: 'work', a: 1, n: '他說"再等等"', i: 2, s: 1 }], (r) => (r === 'work' ? '工作, "加班"' : '沒為什麼'));
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'timestamp,datetime,reason,reason_label,auto,note,long,shortcut');
  assert.ok(lines[1].startsWith('1000,'));
  assert.ok(lines[1].endsWith(',work,"工作, ""加班""",1,"他說""再等等""",1,1'), lines[1]);
  assert.equal(toCSV([]).trim().split('\n').length, 1);
});

test('cleanNote 去空白、截長度', () => {
  assert.equal(cleanNote('  a   b  '), 'a b');
  assert.equal(cleanNote('x'.repeat(500)).length, 200);
  assert.equal(cleanNote(null), '');
});
