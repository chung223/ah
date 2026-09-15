import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeData, parseRemote, syncOnce, createGistClient, GIST_FILE, SyncError } from '../src/sync.js';

test('mergeData：聯集、墓碑、筆記保留、標籤合併', () => {
  const local = {
    sighs: [
      { t: 1, r: 'work' },
      { t: 3, r: null, n: '本機的筆記' },
    ],
    deleted: [2],
    customReasons: [{ id: 'c_aaaaaa', label: '本機名' }],
    reasonOrder: ['work'],
  };
  const remote = {
    sighs: [
      { t: 2, r: null },
      { t: 3, r: 'money', n: '遠端的筆記' },
      { t: 4, r: 'love' },
    ],
    deleted: [1],
    customReasons: [{ id: 'c_aaaaaa', label: '遠端名' }, { id: 'c_bbbbbb', label: '只在遠端' }],
    reasonOrder: null,
  };
  const { merged, localChanged, remoteChanged } = mergeData(local, remote);
  assert.deepEqual(
    merged.sighs.map((s) => s.t),
    [3, 4],
    '1 與 2 都被墓碑刪掉',
  );
  assert.equal(merged.sighs[0].r, null, '同一筆以本機為準');
  assert.equal(merged.sighs[0].n, '本機的筆記');
  assert.deepEqual(merged.deleted, [1, 2]);
  assert.deepEqual(merged.customReasons, [{ id: 'c_aaaaaa', label: '本機名' }, { id: 'c_bbbbbb', label: '只在遠端' }]);
  assert.deepEqual(merged.reasonOrder, ['work']);
  assert.equal(localChanged, true);
  assert.equal(remoteChanged, true);

  const same = mergeData(merged, merged);
  assert.equal(same.localChanged, false);
  assert.equal(same.remoteChanged, false);
});

test('parseRemote 容錯', () => {
  assert.equal(parseRemote('garbage'), null);
  assert.deepEqual(parseRemote('{"sighs":[{"t":1}]}'), { sighs: [{ t: 1 }], deleted: [], customReasons: [], reasonOrder: null });
});

function fakeClient(initial = null) {
  const store = { gist: initial, calls: [] };
  return {
    store,
    async findGist() {
      store.calls.push('find');
      return store.gist ? store.gist.id : null;
    },
    async createGist(content) {
      store.calls.push('create');
      store.gist = { id: 'gist123', content };
      return 'gist123';
    },
    async readGist(id) {
      store.calls.push(`read:${id}`);
      if (!store.gist || store.gist.id !== id) throw new SyncError('notfound');
      return store.gist.content;
    },
    async updateGist(id, content) {
      store.calls.push(`update:${id}`);
      store.gist = { id, content };
    },
  };
}

function stateWith(sighs, extra = {}) {
  return {
    sighs,
    deleted: [],
    settings: { customReasons: [], reasonOrder: null, sync: { token: 't', gistId: '', lastSync: 0 }, ...extra },
  };
}

test('syncOnce：第一次沒有 Gist 就建立', async () => {
  const client = fakeClient();
  const state = stateWith([{ t: 1, r: null }]);
  const res = await syncOnce(state, client, 999);
  assert.equal(res.status, 'created');
  assert.equal(state.settings.sync.gistId, 'gist123');
  assert.equal(state.settings.sync.lastSync, 999);
  assert.deepEqual(client.store.calls, ['find', 'create']);
  assert.deepEqual(JSON.parse(client.store.gist.content).sighs, [{ t: 1, r: null }]);
});

test('syncOnce：兩邊都有東西時合併，本機與遠端都更新', async () => {
  const client = fakeClient({
    id: 'gist123',
    content: JSON.stringify({ sighs: [{ t: 2, r: 'love' }], deleted: [], customReasons: [], reasonOrder: null }),
  });
  const state = stateWith([{ t: 1, r: null }]);
  const res = await syncOnce(state, client, 5);
  assert.equal(res.status, 'both');
  assert.deepEqual(
    state.sighs.map((s) => s.t),
    [1, 2],
  );
  assert.equal(state.settings.sync.gistId, 'gist123');
  assert.ok(client.store.calls.includes('update:gist123'));
  assert.deepEqual(JSON.parse(client.store.gist.content).sighs.map((s) => s.t), [1, 2]);
});

test('syncOnce：沒有變化時不上傳', async () => {
  const content = JSON.stringify({ sighs: [{ t: 1, r: null }], deleted: [], customReasons: [], reasonOrder: null });
  const client = fakeClient({ id: 'gist123', content });
  const state = stateWith([{ t: 1, r: null }], { sync: { token: 't', gistId: 'gist123', lastSync: 0 } });
  const res = await syncOnce(state, client, 7);
  assert.equal(res.status, 'unchanged');
  assert.deepEqual(client.store.calls, ['read:gist123']);
});

test('syncOnce：記著的 Gist 被刪掉時重建', async () => {
  const client = fakeClient();
  const state = stateWith([{ t: 1, r: null }], { sync: { token: 't', gistId: 'gone', lastSync: 0 } });
  const res = await syncOnce(state, client, 7);
  assert.equal(res.status, 'created');
  assert.equal(state.settings.sync.gistId, 'gist123');
});

test('syncOnce：本機刪除會透過墓碑傳到遠端', async () => {
  const content = JSON.stringify({ sighs: [{ t: 1, r: null }, { t: 2, r: null }], deleted: [], customReasons: [], reasonOrder: null });
  const client = fakeClient({ id: 'gist123', content });
  const state = stateWith([{ t: 1, r: null }], { sync: { token: 't', gistId: 'gist123', lastSync: 0 } });
  state.deleted = [2];
  const res = await syncOnce(state, client, 7);
  assert.equal(res.status, 'pushed');
  assert.deepEqual(JSON.parse(client.store.gist.content).sighs.map((s) => s.t), [1]);
  assert.deepEqual(JSON.parse(client.store.gist.content).deleted, [2]);
});

test('createGistClient：帶 token、處理 401 與截斷', async () => {
  const seen = [];
  const fetchFn = async (url, init = {}) => {
    seen.push({ url, method: init.method, auth: init.headers && init.headers.Authorization });
    if (url.endsWith('/gists?per_page=100')) return { ok: true, status: 200, json: async () => [{ id: 'g1', files: { [GIST_FILE]: {} } }] };
    if (url.endsWith('/gists/g1')) return { ok: true, status: 200, json: async () => ({ files: { [GIST_FILE]: { truncated: true, raw_url: 'https://raw/x' } } }) };
    if (url === 'https://raw/x') return { ok: true, status: 200, text: async () => '{"sighs":[]}' };
    if (url.endsWith('/gists/bad')) return { ok: false, status: 401, json: async () => ({}) };
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const client = createGistClient('TOKEN', fetchFn);
  assert.equal(await client.findGist(), 'g1');
  assert.equal(seen[0].auth, 'Bearer TOKEN');
  assert.equal(await client.readGist('g1'), '{"sighs":[]}');
  await assert.rejects(() => client.readGist('bad'), (e) => e.code === 'auth');
  await assert.rejects(() => client.updateGist('zzz', '{}'), (e) => e.code === 'http');
});
