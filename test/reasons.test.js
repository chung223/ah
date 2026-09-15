import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isReasonId,
  orderedReasons,
  labelFor,
  addCustomReason,
  renameCustomReason,
  removeCustomReason,
  moveReason,
  makeCustomId,
  normalizeCustomReasons,
  BUILTIN_IDS,
} from '../src/reasons.js';

const fresh = () => ({ reason: null, periodReasons: { morning: null }, customReasons: [], reasonOrder: null });
const seq = (...vals) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

test('isReasonId', () => {
  assert.equal(isReasonId('work'), true);
  assert.equal(isReasonId('c_abc123'), true);
  assert.equal(isReasonId('c_ab'), false);
  assert.equal(isReasonId('nope'), false);
  assert.equal(isReasonId(null), false);
});

test('makeCustomId 格式', () => {
  assert.match(makeCustomId(seq(0.1, 0.5, 0.9)), /^c_[a-z0-9]{6}$/);
});

test('orderedReasons：預設順序、沒為什麼永遠第一', () => {
  const list = orderedReasons(fresh());
  assert.equal(list[0].id, null);
  assert.deepEqual(
    list.slice(1).map((r) => r.id),
    BUILTIN_IDS,
  );
});

test('新增、改名、排序、刪除自訂標籤', () => {
  const s = fresh();
  const added = addCustomReason(s, '  房東 ', seq(0.2));
  assert.ok(added.id.startsWith('c_'));
  assert.deepEqual(s.customReasons, [{ id: added.id, label: '房東' }]);
  assert.equal(labelFor(s, added.id), '房東');
  assert.equal(orderedReasons(s).at(-1).id, added.id, '新標籤排在最後');

  assert.deepEqual(addCustomReason(s, '房東'), { error: '已經有這個標籤了' });
  assert.deepEqual(addCustomReason(s, '   '), { error: '請輸入名稱' });
  assert.deepEqual(addCustomReason(s, '工作'), { error: '已經有這個標籤了' }, '和內建同名也不行');

  assert.deepEqual(renameCustomReason(s, added.id, '房東太太'), { id: added.id });
  assert.equal(labelFor(s, added.id), '房東太太');
  assert.ok(renameCustomReason(s, 'work', 'x').error, '內建的不能改名');

  assert.equal(moveReason(s, added.id, -1), true);
  const ids = orderedReasons(s).map((r) => r.id);
  assert.equal(ids.at(-2), added.id);
  assert.equal(ids.at(-1), 'other');
  assert.equal(moveReason(s, 'work', -1), false, '已經在最前面');

  s.reason = added.id;
  s.periodReasons.morning = added.id;
  removeCustomReason(s, added.id);
  assert.deepEqual(s.customReasons, []);
  assert.equal(s.reason, null);
  assert.equal(s.periodReasons.morning, null);
  assert.equal(labelFor(s, added.id), '（已移除）');
});

test('normalizeCustomReasons 去掉壞的與重複的', () => {
  assert.deepEqual(
    normalizeCustomReasons([{ id: 'c_abc123', label: ' a ' }, { id: 'c_abc123', label: 'b' }, { id: 'x', label: 'c' }, null]),
    [{ id: 'c_abc123', label: 'a' }],
  );
  assert.deepEqual(normalizeCustomReasons('nope'), []);
});
