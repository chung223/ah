// 跨裝置同步：把紀錄存到使用者自己的 GitHub 私密 Gist。
// 沒有伺服器，瀏覽器直接呼叫 GitHub API；token 只存在使用者的裝置上。
// 合併規則：紀錄以時間戳為鍵取聯集，刪除用墓碑（deleted）傳播；
// 標籤以代號取聯集，名稱與排序以本機為準。

export const GIST_FILE = 'ah-sigh-counter.json';
export const GIST_DESCRIPTION = '唉 · 嘆氣計數器 的資料備份（由 App 自動維護）';
const API = 'https://api.github.com';

function sighKey(s) {
  return s.t;
}

/** 把本機與遠端的資料合併成一份。回傳合併結果與「本機／遠端是否需要更新」。 */
export function mergeData(local, remote) {
  const deleted = new Set([...(local.deleted || []), ...(remote.deleted || [])]);
  const map = new Map();
  for (const s of remote.sighs || []) map.set(sighKey(s), { ...s });
  for (const s of local.sighs || []) {
    const prev = map.get(sighKey(s));
    const merged = { ...s };
    if (prev && prev.n && !merged.n) merged.n = prev.n;
    if (prev && prev.a && !merged.a) merged.a = 1;
    map.set(sighKey(s), merged);
  }
  const sighs = [...map.values()].filter((s) => !deleted.has(s.t)).sort((a, b) => a.t - b.t);

  const customMap = new Map();
  for (const c of remote.customReasons || []) customMap.set(c.id, { ...c });
  for (const c of local.customReasons || []) customMap.set(c.id, { ...c });
  const customReasons = [...customMap.values()];

  const reasonOrder = local.reasonOrder && local.reasonOrder.length ? local.reasonOrder : remote.reasonOrder || null;

  const merged = { sighs, deleted: [...deleted].sort((a, b) => a - b), customReasons, reasonOrder };
  return {
    merged,
    localChanged: serialize(merged) !== serialize(local),
    remoteChanged: serialize(merged) !== serialize(remote),
  };
}

export function serialize(data) {
  return JSON.stringify({
    sighs: (data.sighs || []).map((s) => [s.t, s.r ?? null, s.a ? 1 : 0, s.n || '']),
    deleted: [...(data.deleted || [])].sort((a, b) => a - b),
    customReasons: (data.customReasons || []).map((c) => [c.id, c.label]),
    reasonOrder: data.reasonOrder || null,
  });
}

export function payloadFromState(state) {
  return {
    sighs: state.sighs,
    deleted: state.deleted || [],
    customReasons: state.settings.customReasons || [],
    reasonOrder: state.settings.reasonOrder || null,
  };
}

export function parseRemote(text) {
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object') return null;
    return {
      sighs: Array.isArray(raw.sighs) ? raw.sighs : [],
      deleted: Array.isArray(raw.deleted) ? raw.deleted : [],
      customReasons: Array.isArray(raw.customReasons) ? raw.customReasons : [],
      reasonOrder: Array.isArray(raw.reasonOrder) ? raw.reasonOrder : null,
    };
  } catch {
    return null;
  }
}

export class SyncError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

/** 極簡的 Gist 客戶端。fetchFn 可注入（測試用）。 */
export function createGistClient(token, fetchFn = globalThis.fetch) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  async function call(method, path, body) {
    let res;
    try {
      res = await fetchFn(`${API}${path}`, {
        method,
        headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new SyncError('network', '連不上 GitHub');
    }
    if (res.status === 401 || res.status === 403) throw new SyncError('auth', 'token 無效或權限不足');
    if (res.status === 404) throw new SyncError('notfound', '找不到 Gist');
    if (!res.ok) throw new SyncError('http', `GitHub 回應 ${res.status}`);
    return res.json();
  }
  return {
    async findGist() {
      const list = await call('GET', '/gists?per_page=100');
      const hit = (list || []).find((g) => g.files && g.files[GIST_FILE]);
      return hit ? hit.id : null;
    },
    async createGist(content) {
      const g = await call('POST', '/gists', {
        description: GIST_DESCRIPTION,
        public: false,
        files: { [GIST_FILE]: { content } },
      });
      return g.id;
    },
    async readGist(id) {
      const g = await call('GET', `/gists/${id}`);
      const f = g.files && g.files[GIST_FILE];
      if (!f) throw new SyncError('notfound', 'Gist 裡沒有資料檔');
      if (f.truncated && f.raw_url) {
        const res = await fetchFn(f.raw_url);
        return res.text();
      }
      return f.content;
    },
    async updateGist(id, content) {
      await call('PATCH', `/gists/${id}`, { files: { [GIST_FILE]: { content } } });
    },
  };
}

function contentFor(data, now) {
  return JSON.stringify({ app: 'ah-sigh-counter', v: 2, updatedAt: now, ...data }, null, 1);
}

/**
 * 跑一次同步。會直接修改 state（sighs、deleted、customReasons、reasonOrder、sync.gistId、sync.lastSync）。
 * 回傳 { status: 'created' | 'pushed' | 'pulled' | 'both' | 'unchanged' }。
 */
export async function syncOnce(state, client, now = Date.now()) {
  const sync = state.settings.sync;
  if (!sync || !sync.token) throw new SyncError('noauth', '還沒設定 token');
  const local = payloadFromState(state);

  let gistId = sync.gistId || (await client.findGist());
  if (!gistId) {
    gistId = await client.createGist(contentFor(local, now));
    sync.gistId = gistId;
    sync.lastSync = now;
    return { status: 'created', gistId };
  }

  let remoteText;
  try {
    remoteText = await client.readGist(gistId);
  } catch (err) {
    if (err.code !== 'notfound') throw err;
    // 記著的 Gist 不見了：重新找或重建
    const found = await client.findGist();
    gistId = found || (await client.createGist(contentFor(local, now)));
    sync.gistId = gistId;
    if (!found) {
      sync.lastSync = now;
      return { status: 'created', gistId };
    }
    remoteText = await client.readGist(gistId);
  }

  const remote = parseRemote(remoteText) || { sighs: [], deleted: [], customReasons: [], reasonOrder: null };
  const { merged, localChanged, remoteChanged } = mergeData(local, remote);

  if (localChanged) {
    state.sighs = merged.sighs;
    state.deleted = merged.deleted;
    state.settings.customReasons = merged.customReasons;
    state.settings.reasonOrder = merged.reasonOrder;
  }
  if (remoteChanged) await client.updateGist(gistId, contentFor(merged, now));

  sync.gistId = gistId;
  sync.lastSync = now;
  const status = localChanged && remoteChanged ? 'both' : localChanged ? 'pulled' : remoteChanged ? 'pushed' : 'unchanged';
  return { status, gistId };
}
