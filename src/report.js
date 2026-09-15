// 嘆氣週報：把最近 7 天畫成一張可以分享的圖（1080 × 1350，適合手機）。
// 只負責畫 canvas；資料由 stats.weekSummary 提供。

import { formatDuration, hourLabel, shortDate } from './stats.js';

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

/**
 * data 來自 stats.weekSummary；opts: { theme: 'dark' | 'light', url, quote }
 */
export async function drawReport(canvas, data, opts = {}) {
  const { theme = 'dark', url = '', quote = '' } = opts;
  const C = PALETTE[theme] || PALETTE.dark;
  const W = REPORT_W;
  const H = REPORT_H;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  await ensureFonts();

  // 背景
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, C.bg0);
  bg.addColorStop(1, C.bg1);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  glow(ctx, 140, H - 40, 760, C.glowA);
  glow(ctx, W - 60, 40, 640, C.glowB);

  // 頁首
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = C.ink;
  ctx.font = `600 84px ${SERIF}`;
  ctx.fillText('唉。', 80, 160);
  ctx.fillStyle = C.ink3;
  ctx.font = `400 26px ${SANS}`;
  spacedText(ctx, '嘆氣週報', 236, 156, 9);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.ink2;
  ctx.font = `400 32px ${SANS}`;
  ctx.fillText(data.rangeLabel, W - 80, 156);
  ctx.textAlign = 'left';

  // 大數字
  ctx.fillStyle = C.ink;
  ctx.font = `300 300px ${NUM}`;
  const numText = String(data.total);
  ctx.fillText(numText, 66, 500);
  const numW = ctx.measureText(numText).width;
  ctx.fillStyle = C.ink2;
  ctx.font = `400 60px ${SERIF}`;
  ctx.fillText('次', 66 + numW + 26, 500);

  ctx.fillStyle = C.ink3;
  ctx.font = `400 28px ${SANS}`;
  let diffText = '這 7 天';
  if (data.prevTotal || data.total) {
    if (data.diff < 0) diffText += `　比前 7 天少 ${-data.diff} 次`;
    else if (data.diff > 0) diffText += `　比前 7 天多 ${data.diff} 次`;
    else diffText += '　和前 7 天一樣';
  }
  ctx.fillText(diffText, 80, 560);

  // 長條
  const chart = { x: 80, y: 620, w: W - 160, h: 250 };
  const max = Math.max(1, ...data.days.map((d) => d.count));
  const slot = chart.w / 7;
  const bw = Math.min(slot * 0.5, 64);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(chart.x, chart.y + chart.h + 0.5);
  ctx.lineTo(chart.x + chart.w, chart.y + chart.h + 0.5);
  ctx.stroke();
  data.days.forEach((d, i) => {
    const x = chart.x + i * slot + (slot - bw) / 2;
    const h = d.count ? Math.max(6, (d.count / max) * (chart.h - 40)) : 4;
    const y = chart.y + chart.h - h;
    ctx.fillStyle = i === 6 ? C.amber : d.count ? C.amberDim : C.line;
    roundRect(ctx, x, y, bw, h, 8);
    ctx.fill();
    ctx.textAlign = 'center';
    if (d.count) {
      ctx.fillStyle = C.ink2;
      ctx.font = `500 26px ${NUM}`;
      ctx.fillText(String(d.count), x + bw / 2, y - 14);
    }
    ctx.fillStyle = C.ink3;
    ctx.font = `400 24px ${SANS}`;
    ctx.fillText(d.weekday, x + bw / 2, chart.y + chart.h + 40);
    ctx.textAlign = 'left';
  });

  // 幾個數字
  const stats = [
    ['最多的一天', data.maxDay ? `${shortDate(data.maxDay.key)} · ${data.maxDay.count} 次` : '—'],
    ['最常的原因', data.topReason ? `${data.topReason.label} · ${Math.round(data.topReason.ratio * 100)}%` : '—'],
    ['最常的時段', data.busiestHour != null ? hourLabel(data.busiestHour) : '—'],
    ['最長平靜', data.longestCalm != null ? formatDuration(data.longestCalm) : '—'],
  ];
  const gridTop = 960;
  stats.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 80 + col * ((W - 160) / 2);
    const y = gridTop + row * 110;
    ctx.fillStyle = C.ink3;
    ctx.font = `400 24px ${SANS}`;
    spacedText(ctx, label, x, y, 4);
    ctx.fillStyle = C.ink;
    ctx.font = `500 40px ${SERIF}`;
    ctx.fillText(value, x, y + 52);
  });

  // 一句話（最多兩行，留出頁尾的空間）
  if (quote) {
    ctx.fillStyle = C.ink2;
    ctx.font = `400 36px ${SERIF}`;
    const lines = wrapChars(ctx, `「${quote}」`, W - 160, 2);
    lines.forEach((line, i) => ctx.fillText(line, 80, 1178 + i * 52));
  }

  // 頁尾
  ctx.fillStyle = C.ink3;
  ctx.font = `400 22px ${SANS}`;
  ctx.fillText(url, 80, H - 60);
  ctx.textAlign = 'right';
  ctx.fillText('紀錄只存在我的裝置上', W - 80, H - 60);
  ctx.textAlign = 'left';
  return canvas;
}

export function reportFilename(data, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `sigh-report-${stamp}.png`;
}
