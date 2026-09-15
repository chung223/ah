import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAction, stripQuickAction, quickUrl } from '../src/quick.js';

test('parseQuickAction', () => {
  assert.equal(parseQuickAction(''), null);
  assert.equal(parseQuickAction('?x=1'), null);
  assert.deepEqual(parseQuickAction('?sigh'), { reason: undefined });
  assert.deepEqual(parseQuickAction('?sigh=1'), { reason: undefined });
  assert.deepEqual(parseQuickAction('?sigh=work'), { reason: 'work' });
  assert.deepEqual(parseQuickAction('?sigh=bogus'), { reason: undefined });
});

test('stripQuickAction 只拿掉 sigh，其他保留', () => {
  assert.equal(stripQuickAction('https://a.b/ah/?sigh=1#stats'), 'https://a.b/ah/#stats');
  assert.equal(stripQuickAction('https://a.b/ah/?foo=2&sigh=work'), 'https://a.b/ah/?foo=2');
  assert.equal(stripQuickAction('https://a.b/ah/'), 'https://a.b/ah/');
});

test('quickUrl 以目前頁面位置為準', () => {
  assert.equal(quickUrl('https://chung223.github.io/ah/'), 'https://chung223.github.io/ah/?sigh=1');
  assert.equal(quickUrl('https://chung223.github.io/ah/index.html#stats'), 'https://chung223.github.io/ah/?sigh=1');
  assert.equal(quickUrl('http://localhost:8080/?foo=1'), 'http://localhost:8080/?sigh=1');
});
