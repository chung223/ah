// 報告圖卡：週報、月報、年度回顧，都是 1080 × 1350 的 canvas（適合手機分享）。
// 這裡只負責畫；資料由 stats.weekSummary / monthSummary / yearSummary 提供。

import { formatDuration, hourLabel, shortDate, formatDateLabel, WEEKDAYS } from './stats.js';

export const REPORT_W = 1080;
export const REPORT_H = 1350;

const PALETTE = {
  dark: {
    bg0: '#1c2242',
    bg1: '#0c101d',
    ink: '#f1e9da',
    ink2: '#b8b2a7',
    ink3: '#8b8995',
    amber: '#f0b365',
    amberDim: 'rgba(240, 179, 101, 0.42)',
    line: 'rgba(241, 233, 218, 0.16)',
    glowA: 'rgba(240, 179, 101, 0.30)',
    glowB: 'rgba(106, 74, 140, 0.55)',
  },
  light: {
    bg0: '#f6f0e5',
    bg1: '#ebe2d3',
    ink: '#1d1a2b',
    ink2: '#5a5666',
    ink3: '#8a8694',
    amber: '#e29a3f',
    amberDim: 'rgba(226, 154, 63, 0.45)',
    line: 'rgba(29, 26, 43, 0.16)',
    glowA: 'rgba(240, 179, 101, 0.45)',
    glowB: 'rgba(183, 155, 214, 0.5)',
  },
};

const SERIF = '"Noto Serif TC", "Songti TC", "PMingLiU", serif';
const SANS = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
const NUM = '"Fraunces", "Noto Serif TC", Georgia, serif';
const W = REPORT_W;
const H = REPORT_H;
const M = 80; // 左右邊界

function glow(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function spacedText(ctx, text, x, y, spacing) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  return cx - x;
}

/** 逐字換行（中文沒有空格可以斷）。回傳最多 maxLines 行。 */
export function wrapChars(ctx, text, maxWidth, maxLines = 2) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) return lines;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

async function ensureFonts() {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
  try {
    await Promise.all([
      document.fonts.load(`300 300px ${NUM}`),
      document.fonts.load(`600 84px ${SERIF}`),
      document.fonts.load(`400 40px ${SERIF}`),
      document.fonts.load(`400 28px ${SANS}`),
      document.fonts.load(`500 30px ${SANS}`),
    ]);
  } catch {
    /* 字型載不到就用系統字型 */
  }
}

/* ---------- 共用的畫法 ---------- */

async function begin(canvas, theme) {
  const C = PALETTE[theme] || PALETTE.dark;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  await ensureFonts();
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, C.bg0);
  bg.addColorStop(1, C.bg1);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  glow(ctx, 140, H - 40, 760, C.glowA);
  glow(ctx, W - 60, 40, 640, C.glowB);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  return { ctx, C };
}

function header(ctx, C, subtitle, right) {
  ctx.fillStyle = C.ink;
  ctx.font = `600 84px ${SERIF}`;
  ctx.fillText('唉。', M, 160);
  ctx.fillStyle = C.ink3;
  ctx.font = `400 26px ${SANS}`;
  spacedText(ctx, subtitle, 236, 156, 9);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.ink2;
  ctx.font = `400 32px ${SANS}`;
  ctx.fillText(right, W - M, 156);
  ctx.textAlign = 'left';
}

function bigNumber(ctx, C, value, caption, y = 500) {
  ctx.fillStyle = C.ink;
  ctx.font = `300 300px ${NUM}`;
  const text = String(value);
  ctx.fillText(text, M - 14, y);
  const w = ctx.measureText(text).width;
  ctx.fillStyle = C.ink2;
  ctx.font = `400 60px ${SERIF}`;
  ctx.fillText('次', M - 14 + w + 26, y);
  if (caption) {
    ctx.fillStyle = C.ink3;
    ctx.font = `400 28px ${SANS}`;
    ctx.fillText(caption, M, y + 60);
  }
}

function bars(ctx, C, items, opts) {
  const { x = M, y, w = W - M * 2, h, valueLabels = false, labelAt = () => true, label = () => '', highlight = () => false, maxBar = 64 } = opts;
  const n = items.length || 1;
  const max = Math.max(1, ...items.map((d) => d.count));
  const slot = w / n;
  const bw = Math.min(slot * 0.62, maxBar);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + h + 0.5);
  ctx.lineTo(x + w, y + h + 0.5);
  ctx.stroke();
  const labelFont = n > 12 ? 22 : 24;
  items.forEach((d, i) => {
    const bx = x + i * slot + (slot - bw) / 2;
    const bh = d.count ? Math.max(6, (d.count / max) * (h - 40)) : 4;
    const by = y + h - bh;
    ctx.fillStyle = d.future ? 'rgba(0,0,0,0)' : highlight(d, i) ? C.amber : d.count ? C.amberDim : C.line;
    if (d.future) {
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      roundRect(ctx, bx, by, bw, bh, Math.min(8, bw / 2));
      ctx.stroke();
    } else {
      roundRect(ctx, bx, by, bw, bh, Math.min(8, bw / 2));
      ctx.fill();
    }
    ctx.textAlign = 'center';
    if (valueLabels && d.count) {
      ctx.fillStyle = C.ink2;
      ctx.font = `500 26px ${NUM}`;
      ctx.fillText(String(d.count), bx + bw / 2, by - 14);
    }
    if (labelAt(d, i, n)) {
      ctx.fillStyle = C.ink3;
      ctx.font = `400 ${labelFont}px ${SANS}`;
      ctx.fillText(label(d, i), bx + bw / 2, y + h + 40);
    }
    ctx.textAlign = 'left';
  });
}

/** 塞不下的文字尾巴改成「…」。 */
export function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = [...text];
  while (chars.length && ctx.measureText(chars.join('') + '…').width > maxWidth) chars.pop();
  return chars.join('') + '…';
}

function statGrid(ctx, C, rows, top, rowGap = 110) {
  const colW = (W - M * 2) / 2;
  rows.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * colW;
    const y = top + row * rowGap;
    ctx.fillStyle = C.ink3;
    ctx.font = `400 24px ${SANS}`;
    spacedText(ctx, label, x, y, 4);
    ctx.fillStyle = C.ink;
    ctx.font = `500 40px ${SERIF}`;
    ctx.fillText(fitText(ctx, value, colW - 36), x, y + 52);
  });
}

/** 大字的句子，每句前面一個琥珀色的破折號；最多 maxLines 行（含換行）。 */
function statements(ctx, C, lines, top, lineHeight = 58, maxLines = 5) {
  let y = top;
  let used = 0;
  ctx.font = `400 38px ${SERIF}`;
  for (const text of lines) {
    const wrapped = wrapChars(ctx, text, W - M * 2 - 48, 2);
    if (used + wrapped.length > maxLines) break;
    ctx.fillStyle = C.amber;
    ctx.fillText('—', M, y);
    ctx.fillStyle = C.ink;
    wrapped.forEach((l, i) => ctx.fillText(l, M + 48, y + i * lineHeight));
    y += wrapped.length * lineHeight + 6;
    used += wrapped.length;
  }
}

function quoteLine(ctx, C, quote, y) {
  if (!quote) return;
  ctx.fillStyle = C.ink2;
  ctx.font = `400 36px ${SERIF}`;
  const lines = wrapChars(ctx, `「${quote}」`, W - M * 2, 2);
  lines.forEach((line, i) => ctx.fillText(line, M, y + i * 52));
}

function footer(ctx, C, url) {
  ctx.fillStyle = C.ink3;
  ctx.font = `400 22px ${SANS}`;
  ctx.fillText(url, M, H - 60);
  ctx.textAlign = 'right';
  ctx.fillText('紀錄只存在我的裝置上', W - M, H - 60);
  ctx.textAlign = 'left';
}

function pct(ratio) {
  return `${Math.round(ratio * 100)}%`;
}

/* ---------- 週報 ---------- */

/** data 來自 stats.weekSummary；opts: { theme, url, quote } */
export async function drawReport(canvas, data, opts = {}) {
  const { theme = 'dark', url = '', quote = '' } = opts;
  const { ctx, C } = await begin(canvas, theme);
  header(ctx, C, '嘆氣週報', data.rangeLabel);

  let caption = '這 7 天';
  if (data.prevTotal || data.total) {
    if (data.diff < 0) caption += `　比前 7 天少 ${-data.diff} 次`;
    else if (data.diff > 0) caption += `　比前 7 天多 ${data.diff} 次`;
    else caption += '　和前 7 天一樣';
  }
  bigNumber(ctx, C, data.total, caption);

  bars(ctx, C, data.days, {
    y: 620,
    h: 250,
    valueLabels: true,
    label: (d) => d.weekday,
    highlight: (d, i) => i === data.days.length - 1,
  });

  statGrid(
    ctx,
    C,
    [
      ['最多的一天', data.maxDay ? `${shortDate(data.maxDay.key)} · ${data.maxDay.count} 次` : '—'],
      ['最常的原因', data.topReason ? `${data.topReason.label} · ${pct(data.topReason.ratio)}` : '—'],
      ['最常的時段', data.busiestHour != null ? hourLabel(data.busiestHour) : '—'],
      ['最長平靜', data.longestCalm != null ? formatDuration(data.longestCalm) : '—'],
    ],
    960,
  );
  quoteLine(ctx, C, quote, 1178);
  footer(ctx, C, url);
  return canvas;
}

/* ---------- 月報 ---------- */

/** data 來自 stats.monthSummary */
export async function drawMonthReport(canvas, data, opts = {}) {
  const { theme = 'dark', url = '', quote = '' } = opts;
  const { ctx, C } = await begin(canvas, theme);
  header(ctx, C, '嘆氣月報', data.label);

  let caption = data.isCurrent ? '這個月到今天' : '這個月';
  caption += `　平均每天 ${data.avgPerDay.toFixed(1)} 次`;
  if (data.prevTotal || data.total) {
    if (data.diff < 0) caption += `　比上個月少 ${-data.diff} 次`;
    else if (data.diff > 0) caption += `　比上個月多 ${data.diff} 次`;
    else caption += '　和上個月一樣';
  }
  bigNumber(ctx, C, data.total, caption);

  bars(ctx, C, data.days, {
    y: 620,
    h: 230,
    valueLabels: false,
    maxBar: 20,
    labelAt: (d) => d.day === 1 || d.day % 5 === 0,
    label: (d) => String(d.day),
    highlight: (d) => data.maxDay && d.day === data.maxDay.day && d.count > 0,
  });

  const reasons = data.topReasons
    .slice(0, 2)
    .map((r) => `${r.label} ${pct(r.ratio)}`)
    .join('、');
  statGrid(
    ctx,
    C,
    [
      ['最多的一天', data.maxDay ? `${data.month}/${data.maxDay.day} · ${data.maxDay.count} 次` : '—'],
      ['最常的時段', data.busiestHour != null ? hourLabel(data.busiestHour) : '—'],
      ['最常的原因', reasons || '—'],
      ['最長平靜', data.longestCalm != null ? formatDuration(data.longestCalm) : '—'],
    ],
    940,
  );
  ctx.fillStyle = C.ink3;
  ctx.font = `400 26px ${SANS}`;
  ctx.fillText(`有紀錄 ${data.activeDays} 天 · 長嘆 ${data.longCount} 次 · 筆記 ${data.noteCount} 則`, M, 1150);
  quoteLine(ctx, C, quote, 1215);
  footer(ctx, C, url);
  return canvas;
}

/* ---------- 年度回顧 ---------- */

/** data 來自 stats.yearSummary */
export async function drawYearReport(canvas, data, opts = {}) {
  const { theme = 'dark', url = '' } = opts;
  const { ctx, C } = await begin(canvas, theme);
  header(ctx, C, '年度回顧', data.label);

  const caption = `${data.isCurrent ? '今年到目前為止' : '這一年'}　平均每天 ${data.avgPerDay.toFixed(1)} 次`;
  bigNumber(ctx, C, data.total, caption);

  bars(ctx, C, data.months, {
    y: 600,
    h: 200,
    valueLabels: true,
    maxBar: 44,
    label: (d) => `${d.month}月`,
    highlight: (d) => data.busiestMonth && d.month === data.busiestMonth.month && d.count > 0,
  });

  const lines = [];
  if (!data.total) {
    lines.push('這一年還沒有紀錄。');
  } else {
    if (data.busiestCell) lines.push(`最常在星期${WEEKDAYS[data.busiestCell.weekday]}的${data.busiestCell.period}嘆氣。`);
    if (data.topReasons[0]) lines.push(`最常因為「${data.topReasons[0].label}」，佔了 ${pct(data.topReasons[0].ratio)}。`);
    if (data.maxDay) lines.push(`最忙的一天是 ${formatDateLabel(data.maxDay.key)}，${data.maxDay.count} 次。`);
    if (data.calmRun.days >= 2) lines.push(`最平靜的一段：連續 ${data.calmRun.days} 天沒嘆氣。`);
    lines.push(`有紀錄的日子 ${data.activeDays} 天，長嘆 ${data.longCount} 次，筆記 ${data.noteCount} 則。`);
  }
  statements(ctx, C, lines, 920);
  footer(ctx, C, url);
  return canvas;
}

export function reportFilename(data = {}, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  if (data.kind === 'month') return `sigh-report-${data.year}-${pad(data.month)}.png`;
  if (data.kind === 'year') return `sigh-report-${data.year}.png`;
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `sigh-report-${stamp}.png`;
}
