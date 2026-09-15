// 快速記錄網址：打開 ./?sigh=1 就直接記一筆，?sigh=work 則帶原因。
// 給手機捷徑（Siri、輕點背面、Android 桌面捷徑）用的。

import { isReasonId } from './reasons.js';

/** 回傳 null（沒有快速動作）或 { reason }：reason 為 undefined 代表用目前選的原因。 */
export function parseQuickAction(search) {
  const params = new URLSearchParams(search || '');
  if (!params.has('sigh')) return null;
  const v = params.get('sigh');
  return { reason: isReasonId(v) ? v : undefined };
}

/** 把 sigh 參數拿掉，重新整理才不會又記一次。 */
export function stripQuickAction(href) {
  const url = new URL(href);
  url.searchParams.delete('sigh');
  return url.href;
}

/** 這個部署位置的快速記錄網址。 */
export function quickUrl(href) {
  return new URL('./?sigh=1', href).href;
}
