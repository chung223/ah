import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeData, parseRemote, syncOnce, createGistClient, GIST_FILE, SyncError, parseInboxComment, inboxToSighs, inspectInbox } from '../src/sync.js';

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

function fakeClient(initial = null, comments = []) {
  const store = { gist: initial, calls: [], comments: [...comments] };
  return {
    store,
    async listComments(id) {
      store.calls.push(`comments:${id}`);
      return store.comments;
    },
    async deleteComment(id, commentId) {
      store.calls.push(`delc:${commentId}`);
      store.comments = store.comments.filter((c) => c.id !== commentId);
    },
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
  assert.ok(client.store.calls.includes('read:gist123'));
  assert.ok(!client.store.calls.some((c) => c.startsWith('update')), '沒有上傳');
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

const REASONS = [
  { id: null, label: '沒為什麼' },
  { id: 'work', label: '工作' },
  { id: 'c_abc123', label: '房東' },
];

test('parseInboxComment：觸發詞、原因（代號或名稱）、筆記', () => {
  assert.deepEqual(parseInboxComment('唉', REASONS), { r: null, n: '' });
  assert.deepEqual(parseInboxComment('sigh work', REASONS), { r: 'work', n: '' });
  assert.deepEqual(parseInboxComment('唉 工作 客戶又改需求', REASONS), { r: 'work', n: '客戶又改需求' });
  assert.deepEqual(parseInboxComment('唉 房東 又漲租', REASONS), { r: 'c_abc123', n: '又漲租' });
  assert.deepEqual(parseInboxComment('唉 沒為什麼 就是想嘆', REASONS), { r: null, n: '就是想嘆' });
  assert.deepEqual(parseInboxComment('今天好累', REASONS), { r: null, n: '今天好累' });
  assert.deepEqual(parseInboxComment('', REASONS), { r: null, n: '' });
});

test('inboxToSighs：時間來自留言、id 錯開毫秒、墓碑跳過', () => {
  const comments = [
    { id: 10, body: '唉 work', created_at: '2026-09-15T01:02:03Z' },
    { id: 11, body: '唉', created_at: '2026-09-15T01:02:03Z' },
    { id: 12, body: 'x', created_at: 'garbage' },
  ];
  const out = inboxToSighs(comments, REASONS, []);
  assert.equal(out.length, 2);
  assert.notEqual(out[0].sigh.t, out[1].sigh.t, '同一秒的兩則留言時間不同');
  assert.equal(out[0].sigh.r, 'work');
  assert.equal(out[0].sigh.s, 1);
  assert.equal(inboxToSighs(comments, REASONS, [out[0].sigh.t]).length, 1);
});

test('syncOnce：捷徑留言會變成紀錄、上傳、然後刪掉留言', async () => {
  const content = JSON.stringify({ sighs: [{ t: 1, r: null }], deleted: [], customReasons: [], reasonOrder: null });
  const client = fakeClient({ id: 'gist123', content }, [{ id: 7, body: '唉 工作 捷徑來的', created_at: '2026-09-15T01:02:03Z' }]);
  const state = stateWith([{ t: 1, r: null }], { sync: { token: 't', gistId: 'gist123', lastSync: 0 } });
  const res = await syncOnce(state, client, 9, { reasons: REASONS });
  assert.equal(res.inbox, 1);
  assert.equal(res.status, 'both');
  assert.equal(state.sighs.length, 2);
  const added = state.sighs.find((s) => s.s === 1);
  assert.equal(added.r, 'work');
  assert.equal(added.n, '捷徑來的');
  assert.equal(JSON.parse(client.store.gist.content).sighs.length, 2, '雲端也有了');
  assert.deepEqual(client.store.comments, [], '留言刪掉了');
  assert.ok(client.store.calls.includes('delc:7'));
});

test('syncOnce：force 會整份覆蓋雲端（復原清除用）', async () => {
  const content = JSON.stringify({ sighs: [], deleted: [1, 2], customReasons: [], reasonOrder: null });
  const client = fakeClient({ id: 'gist123', content });
  const state = stateWith(
    [
      { t: 1, r: null },
      { t: 2, r: null },
    ],
    { sync: { token: 't', gistId: 'gist123', lastSync: 0, force: true } },
  );
  const res = await syncOnce(state, client, 9);
  assert.equal(res.status, 'pushed');
  assert.equal(state.sighs.length, 2, '本機的沒被雲端墓碑刪掉');
  const remote = JSON.parse(client.store.gist.content);
  assert.equal(remote.sighs.length, 2);
  assert.deepEqual(remote.deleted, []);
  assert.equal(state.settings.sync.force, false, '用過就關掉');
});

test('syncOnce：留言讀取失敗時同步照常完成，並回報 inboxError', async () => {
  const content = JSON.stringify({ sighs: [{ t: 1, r: null }], deleted: [], customReasons: [], reasonOrder: null });
  const client = fakeClient({ id: 'gist123', content });
  client.listComments = async () => {
    throw new SyncError('auth', 'token 無效或權限不足');
  };
  const state = stateWith([{ t: 1, r: null }, { t: 2, r: 'work' }], { sync: { token: 't', gistId: 'gist123', lastSync: 0 } });
  const res = await syncOnce(state, client, 9);
  assert.equal(res.status, 'pushed');
  assert.equal(res.inbox, 0);
  assert.equal(res.inboxSeen, 0);
  assert.equal(res.inboxError, 'token 無效或權限不足');
  assert.equal(res.total, 2);
  assert.equal(JSON.parse(client.store.gist.content).sighs.length, 2);
});

test('syncOnce：回報看到幾則留言', async () => {
  const content = JSON.stringify({ sighs: [], deleted: [], customReasons: [], reasonOrder: null });
  const client = fakeClient({ id: 'gist123', content }, [
    { id: 1, body: '唉', created_at: '2026-09-15T01:02:03Z' },
    { id: 2, body: '', created_at: 'garbage' },
  ]);
  const state = stateWith([], { sync: { token: 't', gistId: 'gist123', lastSync: 0 } });
  const res = await syncOnce(state, client, 9);
  assert.equal(res.inboxSeen, 2);
  assert.equal(res.inbox, 1);
  assert.equal(res.inboxError, null);
});

test('刪不掉的留言會記住 id，下次不再收；inspectInbox 標出狀態', async () => {
  const content = JSON.stringify({ sighs: [], deleted: [], customReasons: [], reasonOrder: null });
  const client = fakeClient({ id: 'gist123', content }, [{ id: 77, body: '唉 工作', created_at: '2026-09-15T01:02:03Z' }]);
  client.deleteComment = async () => {
    throw new SyncError('http', 'GitHub 回應 403');
  };
  const state = stateWith([], { sync: { token: 't', gistId: 'gist123', lastSync: 0, processed: [] } });
  const res1 = await syncOnce(state, client, 9, { reasons: REASONS });
  assert.equal(res1.inbox, 1);
  assert.equal(res1.deleteError, 'GitHub 回應 403');
  assert.deepEqual(state.settings.sync.processed, [77]);
  assert.equal(state.sighs.length, 1);

  const res2 = await syncOnce(state, client, 10, { reasons: REASONS });
  assert.equal(res2.inbox, 0, '同一則留言不會再收');
  assert.equal(res2.inboxSeen, 1);
  assert.equal(state.sighs.length, 1);

  const items = await inspectInbox(state, client, REASONS);
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'done');
  assert.equal(items[0].parsed.r, 'work');

  // 使用者把那筆刪掉（墓碑）→ 狀態變成 deleted
  state.deleted = [state.sighs[0].t];
  state.sighs = [];
  assert.equal((await inspectInbox(state, client, REASONS))[0].status, 'deleted');

  // 全新的留言 → new
  client.store.comments.push({ id: 78, body: '唉', created_at: '2026-09-15T02:00:00Z' });
  const items2 = await inspectInbox(state, client, REASONS);
  assert.equal(items2.find((c) => c.id === 78).status, 'new');
  assert.equal(items2.find((c) => c.id === 79 || c.id === 'x'), undefined);
  assert.equal((await inspectInbox(state, client, REASONS)).some((c) => c.status === 'bad-time'), false);
});
