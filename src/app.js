// 主程式：把資料層（storage）、統計（stats）、偵測器（detector）等接到畫面上。
// 所有 DOM 操作都集中在這裡；其他模組不碰畫面。

import { createStore, mergeSighs, parseImport, toCSV, exportJSON, cleanNote, TRASH_TTL } from './storage.js';
import {
  countToday,
  countsByDay,
  countsByHour,
  countsByReason,
  calmGaps,
  summary,
  insights,
  formatDuration,
  formatTime,
  formatDateLabel,
  hourLabel,
  dayKey,
  shortDate,
  periodKey,
  PERIODS,
  WEEKDAYS,
  weekdayPeriodGrid,
  yearGrid,
  weekSummary,
  streaks,
  yesterdayReview,
} from './stats.js';
import { pickQuote, pickIdleLine, milestoneMessage } from './quotes.js';
import { SighListener, profileFromSamples } from './detector.js';
import { playExhale } from './sound.js';
import { parseQuickAction, stripQuickAction, quickUrl } from './quick.js';
import {
  orderedReasons,
  labelFor,
  addCustomReason,
  renameCustomReason,
  removeCustomReason,
  moveReason,
} from './reasons.js';
import { shouldSuggestBreathing, recentCount, createBreathSession } from './breath.js';
import { createGistClient, syncOnce } from './sync.js';
import { drawReport, reportFilename } from './report.js';

const FLOAT_WORDS = ['唉', '唉～', '呼…', '哎', '嗯…', '唉。'];
const LONG_FLOAT_WORDS = ['唉～～～', '呼……', '唉……'];
const LONG_PRESS_MS = 450;
const THEME_COLORS = { dark: '#0d1120', light: '#f4eee3' };
const HOUR = 3_600_000;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const store = createStore(window.localStorage);
let state = store.load();
let currentView = 'record';
let statsRange = 7;
let listener = null;
let calibration = null;
let toastTimer = null;
let todayStamp = dayKey(Date.now());
let lastPeriod = null;
let breathDismissedAt = 0;
let breathPromptTimer = null;
let breathSession = null;
let syncTimer = null;
let syncing = false;
let reportCanvas = null;
let reportBlob = null;
let updateOffered = false;
let pressTimer = null;
let longPressed = false;
let suppressClick = false;

const labelOf = (id) => labelFor(state.settings, id);
const reasonList = () => orderedReasons(state.settings);

const ui = {
  tabs: $$('.tabs [role="tab"]'),
  views: $$('.view'),
  themeToggle: $('#theme-toggle'),

  todayDate: $('#today-date'),
  todayCount: $('#today-count'),
  quote: $('#quote'),
  stage: $('#sigh-stage'),
  sighBtn: $('#sigh-btn'),
  sighBtnReason: $('#sigh-btn-reason'),
  floatLayer: $('#float-layer'),
  undoBtn: $('#undo-btn'),
  reasons: $('#reasons'),
  breathPrompt: $('#breath-prompt'),
  breathPromptText: $('#breath-prompt-text'),
  breathYes: $('#breath-yes'),
  breathNo: $('#breath-no'),

  weekChart: $('#week-chart'),
  weekTotal: $('#week-total'),
  calmNow: $('#calm-now'),
  calmLongest: $('#calm-longest'),
  calmStreak: $('#calm-streak'),
  reviewCard: $('#review-card'),
  reviewMain: $('#review-main'),
  reviewNotes: $('#review-notes'),
  reviewOk: $('#review-ok'),
  totalCount: $('#total-count'),
  shareBtn: $('#share-btn'),

  micCard: $('#card-mic'),
  micToggle: $('#mic-toggle'),
  micBody: $('#mic-body'),
  micMeterFill: $('#mic-meter-fill'),
  micStatus: $('#mic-status'),
  micSens: $('#mic-sens'),
  micLast: $('#mic-last'),
  micCal: $('#mic-cal'),
  micCalReset: $('#mic-cal-reset'),
  micCalStatus: $('#mic-cal-status'),

  recentList: $('#recent-list'),
  recentEmpty: $('#recent-empty'),

  rangeSeg: $('#range-seg'),
  dayChart: $('#day-chart'),
  daySummary: $('#day-summary'),
  hourChart: $('#hour-chart'),
  hourSummary: $('#hour-summary'),
  reasonListEl: $('#reason-list'),
  records: $('#records'),
  insightList: $('#insight-list'),
  yearHeat: $('#year-heat'),
  yearSummary: $('#year-summary'),
  weekPeriod: $('#week-period'),
  weekPeriodSummary: $('#week-period-summary'),
  reportMake: $('#report-make'),
  reportPreview: $('#report-preview'),
  reportImg: $('#report-img'),
  reportShare: $('#report-share'),
  reportSave: $('#report-save'),
  reportStatus: $('#report-status'),
  noteSearch: $('#note-search'),
  noteList: $('#note-list'),
  noteEmpty: $('#note-empty'),

  themeSeg: $('#theme-seg'),
  soundToggle: $('#sound-toggle'),
  badgeToggle: $('#badge-toggle'),
  badgeNote: $('#badge-note'),
  quickUrl: $('#quick-url'),
  copyQuick: $('#copy-quick'),
  exportJson: $('#export-json'),
  exportCsv: $('#export-csv'),
  importFile: $('#import-file'),
  clearAll: $('#clear-all'),
  restoreTrash: $('#restore-trash'),
  restoreHint: $('#restore-hint'),
  reasonManage: $('#reason-manage'),
  reasonNew: $('#reason-new'),
  reasonAdd: $('#reason-add'),
  periodToggle: $('#period-toggle'),
  periodList: $('#period-list'),
  syncSetup: $('#sync-setup'),
  syncConnected: $('#sync-connected'),
  syncToken: $('#sync-token'),
  syncConnect: $('#sync-connect'),
  syncStatus: $('#sync-status'),
  syncNow: $('#sync-now'),
  syncDisconnect: $('#sync-disconnect'),
  shortcutHelp: $('#shortcut-help'),
  scUrl: $('#sc-url'),
  copyScUrl: $('#copy-sc-url'),
  copyScToken: $('#copy-sc-token'),
  scTest: $('#sc-test'),
  scStatus: $('#sc-status'),

  quickOverlay: $('#quick-overlay'),
  quickCount: $('#quick-count'),
  quickUndo: $('#quick-undo'),
  quickClose: $('#quick-close'),
  breathOverlay: $('#breath-overlay'),
  breathCircle: $('#breath-circle'),
  breathPhase: $('#breath-phase'),
  breathCycle: $('#breath-cycle'),
  breathStop: $('#breath-stop'),

  toast: $('#toast'),
  toastText: $('#toast-text'),
  toastActions: $('#toast-actions'),
};

/* ---------- 小工具 ---------- */

function hideToast() {
  ui.toast.classList.remove('is-on');
}

/** 顯示提示；actions: [{ label, onClick }] 會變成可以點的按鈕。 */
function toast(text, opts = {}) {
  const { ms = 2600, actions = [] } = typeof opts === 'number' ? { ms: opts } : opts;
  ui.toastText.textContent = text;
  ui.toastActions.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-btn';
    b.textContent = a.label;
    b.addEventListener('click', () => {
      hideToast();
      a.onClick();
    });
    ui.toastActions.appendChild(b);
  }
  ui.toast.classList.toggle('has-actions', actions.length > 0);
  ui.toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}

function persist() {
  if (!store.save(state)) toast('存不進去，瀏覽器的儲存空間可能滿了');
}

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fullTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 產生長條圖 SVG，直接放進 box。data: [{ count, ... }]
 * 以容器的實際像素寬度當座標系，文字與長條才不會隨卡片寬度放大。
 */
function barChart(box, data, opts = {}) {
  const {
    H = 120,
    valueLabels = true,
    label = (d) => d.label ?? '',
    labelAt = () => true,
    highlight = (d, i) => i === data.length - 1,
    aria = '',
    animate = true,
  } = opts;
  const W = Math.max(120, Math.round(box.clientWidth) || 300);
  box.dataset.w = String(W);
  const n = data.length || 1;
  const padT = valueLabels ? 18 : 8;
  const padB = 18;
  const slot = W / n;
  const bw = Math.min(slot * 0.62, 28);
  const max = Math.max(1, ...data.map((d) => d.count));
  const parts = [`<line class="axis" x1="0" x2="${W}" y1="${H - padB + 0.5}" y2="${H - padB + 0.5}"/>`];
  data.forEach((d, i) => {
    const h = d.count ? Math.max(3, (d.count / max) * (H - padT - padB)) : 2;
    const x = i * slot + (slot - bw) / 2;
    const y = H - padB - h;
    const cls = !d.count ? 'bar is-zero' : highlight(d, i) ? 'bar is-hi' : 'bar';
    parts.push(
      `<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}" rx="${Math.min(3, bw / 2)}" style="--i:${i}"><title>${esc(d.title || '')}</title></rect>`,
    );
    if (valueLabels && d.count) {
      parts.push(`<text class="val" x="${(x + bw / 2).toFixed(2)}" y="${(y - 5).toFixed(2)}" text-anchor="middle">${d.count}</text>`);
    }
    if (labelAt(i, n)) {
      parts.push(`<text class="lbl" x="${(x + bw / 2).toFixed(2)}" y="${H - 4}" text-anchor="middle">${esc(label(d, i))}</text>`);
    }
  });
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="chart${animate ? '' : ' no-anim'}" role="img" aria-label="${esc(aria)}">${parts.join('')}</svg>`;
}

/* ---------- 主題 ---------- */

function effectiveTheme() {
  if (state.settings.theme !== 'auto') return state.settings.theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme() {
  const root = document.documentElement;
  if (state.settings.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = state.settings.theme;
  const eff = effectiveTheme();
  $$('meta[name="theme-color"]').forEach((m) => {
    m.content = THEME_COLORS[eff];
  });
  ui.themeToggle.dataset.mode = eff;
  ui.themeToggle.setAttribute('aria-label', eff === 'dark' ? '切換成淺色' : '切換成深色');
  $$('#theme-seg button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.themeChoice === state.settings.theme));
  });
}

/* ---------- 記錄頁 ---------- */

function renderCount() {
  const today = countToday(state.sighs);
  ui.todayCount.textContent = String(today);
  ui.todayCount.classList.toggle('is-big', today >= 100);
  const d = new Date();
  ui.todayDate.textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 週${WEEKDAYS[d.getDay()]}`;
  ui.undoBtn.disabled = state.sighs.length === 0;
}

function bumpCount() {
  ui.todayCount.classList.remove('bump');
  void ui.todayCount.offsetWidth; // 重新觸發動畫
  ui.todayCount.classList.add('bump');
}

function reasonOptions(selected) {
  return reasonList()
    .map(
      (r) =>
        `<option value="${r.id ?? ''}"${(r.id ?? null) === (selected ?? null) ? ' selected' : ''}>${esc(r.label)}</option>`,
    )
    .join('');
}

function renderReasons() {
  ui.reasons.innerHTML = reasonList()
    .map(
      (r) =>
        `<button type="button" class="chip" data-reason="${r.id ?? ''}" aria-pressed="${(r.id ?? null) === (state.settings.reason ?? null)}">${esc(r.label)}</button>`,
    )
    .join('');
  ui.sighBtnReason.textContent = state.settings.reason ? `因為${labelOf(state.settings.reason)}` : '沒為什麼';
}

function renderWeek({ animate = true } = {}) {
  const days = countsByDay(state.sighs, 7);
  const total = days.reduce((a, d) => a + d.count, 0);
  barChart(
    ui.weekChart,
    days.map((d) => ({ ...d, title: `${formatDateLabel(d.key)}：${d.count} 次` })),
    { H: 110, label: (d) => d.weekday, aria: '最近七天每天的嘆氣次數', animate },
  );
  ui.weekTotal.textContent = total ? `這 7 天共 ${total} 次` : '這 7 天還沒有紀錄';
}

function renderCalm() {
  const { current, longest } = calmGaps(state.sighs);
  ui.calmNow.textContent = current == null ? '—' : formatDuration(current);
  ui.calmLongest.textContent = state.sighs.length ? formatDuration(longest) : '—';
  ui.totalCount.textContent = String(state.sighs.length);
  const st = streaks(state.sighs);
  ui.calmStreak.textContent = state.sighs.length ? `${st.calmDays} 天` : '—';
}

function renderRecent() {
  const items = state.sighs.slice(-8).reverse();
  ui.recentEmpty.hidden = items.length > 0;
  ui.recentList.innerHTML = items
    .map(
      (s) => `
      <li class="recent-item" data-t="${s.t}">
        <span class="recent-time">${formatTime(s.t)}</span>
        <select class="select recent-reason" aria-label="這次嘆氣的原因">${reasonOptions(s.r)}</select>
        ${s.i === 2 ? '<span class="recent-auto is-long" title="長嘆">長嘆</span>' : ''}${s.a ? '<span class="recent-auto" title="麥克風自動偵測">自動</span>' : ''}${s.s ? '<span class="recent-auto is-sc" title="從捷徑寫入">捷徑</span>' : ''}
        <button class="recent-del" type="button" aria-label="刪除這筆紀錄">×</button>
        <div class="recent-note">
          <button type="button" class="note-edit${s.n ? ' has-note' : ''}">${s.n ? `「${esc(s.n)}」` : '加一句'}</button>
        </div>
      </li>`,
    )
    .join('');
}

/** 把某一筆的筆記欄變成輸入框。 */
function openNoteEditor(t) {
  const item = ui.recentList.querySelector(`.recent-item[data-t="${t}"]`);
  if (!item) return;
  const holder = item.querySelector('.recent-note');
  const sigh = state.sighs.find((x) => x.t === t);
  holder.innerHTML = `<input type="text" class="note-input" maxlength="200" placeholder="一句話就好" value="${esc(sigh?.n || '')}" aria-label="這次嘆氣的筆記">`;
  const input = holder.querySelector('input');
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save) setNoteOf(t, input.value);
    else renderRecent();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  item.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  input.focus();
}

/* ---------- 統計頁 ---------- */

function renderYearHeat() {
  const g = yearGrid(state.sighs, Date.now(), 53);
  const cell = 12;
  const gap = 3;
  const left = 26;
  const top = 18;
  const step = cell + gap;
  const W = left + g.columns.length * step;
  const H = top + 7 * step;
  const level = (c) => (c === 0 ? 0 : Math.max(1, Math.ceil((c / g.max) * 4)));
  const parts = [];
  for (const m of g.months) {
    parts.push(`<text class="mo" x="${left + m.col * step}" y="11">${m.label}</text>`);
  }
  [1, 3, 5].forEach((d) => {
    parts.push(`<text class="wd" x="0" y="${top + d * step + cell - 2}">${WEEKDAYS[d]}</text>`);
  });
  g.columns.forEach((col, w) => {
    col.forEach((c, d) => {
      const cls = c.future ? 'cell future' : `cell l${level(c.count)}${c.today ? ' today' : ''}`;
      parts.push(
        `<rect class="${cls}" x="${left + w * step}" y="${top + d * step}" width="${cell}" height="${cell}" rx="3"><title>${formatDateLabel(c.key)}：${c.count} 次</title></rect>`,
      );
    });
  });
  ui.yearHeat.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="heat" role="img" aria-label="最近一年每天的嘆氣次數">${parts.join('')}</svg>`;
  ui.yearHeat.scrollLeft = ui.yearHeat.scrollWidth;
  ui.yearSummary.textContent = g.total
    ? `這 ${g.columns.length} 週共 ${g.total} 次，最多的一天 ${g.max} 次`
    : '這一年還沒有紀錄';
}

function renderWeekPeriod() {
  const g = weekdayPeriodGrid(state.sighs);
  const head = `<div class="wp-head"></div>${PERIODS.map((p) => `<div class="wp-head">${p.label}</div>`).join('')}`;
  const rows = g.grid
    .map(
      (row, r) =>
        `<div class="wp-row-label">${WEEKDAYS[r]}</div>${row
          .map((v) => {
            const a = g.max ? (0.12 + (v / g.max) * 0.88).toFixed(2) : 0;
            return v
              ? `<div class="wp-cell" style="--a:${a}" title="星期${WEEKDAYS[r]} ${v} 次">${v}</div>`
              : '<div class="wp-cell is-zero"></div>';
          })
          .join('')}`,
    )
    .join('');
  ui.weekPeriod.innerHTML = head + rows;
  ui.weekPeriodSummary.textContent = g.busiest
    ? `星期${WEEKDAYS[g.busiest.weekday]}的${PERIODS.find((p) => p.key === g.busiest.period).label}最常嘆氣`
    : '還沒有資料';
}

function renderNotes() {
  if (!ui.noteList) return;
  const q = ui.noteSearch.value.trim().toLowerCase();
  const items = state.sighs.filter((s) => s.n && (!q || s.n.toLowerCase().includes(q))).slice(-60).reverse();
  ui.noteEmpty.hidden = items.length > 0;
  ui.noteEmpty.textContent = q ? '沒有符合的筆記。' : '還沒有筆記。在「最近」清單裡點「加一句」就可以寫。';
  ui.noteList.innerHTML = items
    .map(
      (s) =>
        `<li><span class="note-when">${fullTime(s.t)}</span><span class="note-reason">${esc(labelOf(s.r))}</span><span class="note-text">${esc(s.n)}</span></li>`,
    )
    .join('');
}

function renderStats({ animate = true } = {}) {
  const s = summary(state.sighs);

  const days = countsByDay(state.sighs, statsRange);
  const total = days.reduce((a, d) => a + d.count, 0);
  barChart(
    ui.dayChart,
    days.map((d) => ({ ...d, title: `${formatDateLabel(d.key)}：${d.count} 次` })),
    {
      H: 150,
      valueLabels: statsRange === 7,
      // 30 天時從今天往回每 5 天標一次日期
      labelAt: (i, n) => statsRange === 7 || (n - 1 - i) % 5 === 0,
      label: (d) => (statsRange === 7 ? d.weekday : shortDate(d.key)),
      aria: `最近 ${statsRange} 天每天的嘆氣次數`,
      animate,
    },
  );
  ui.daySummary.textContent = total
    ? `近 ${statsRange} 天共 ${total} 次，平均每天 ${(total / statsRange).toFixed(1)} 次`
    : `近 ${statsRange} 天沒有紀錄`;

  const hours = countsByHour(state.sighs);
  barChart(
    ui.hourChart,
    hours.map((count, h) => ({ count, h, title: `${h} 點：${count} 次` })),
    {
      H: 150,
      valueLabels: false,
      labelAt: (i) => i % 6 === 0,
      label: (d) => `${d.h} 時`,
      highlight: (d) => s.busiestHour != null && d.h === s.busiestHour && d.count > 0,
      aria: '一天 24 小時的嘆氣分布',
      animate,
    },
  );
  ui.hourSummary.textContent = s.total ? `最常在${hourLabel(s.busiestHour)}左右` : '還沒有資料';

  const reasons = countsByReason(state.sighs);
  ui.reasonListEl.innerHTML = reasons.length
    ? reasons
        .map(
          (r, i) =>
            `<li style="--i:${i}"><span class="reason-name">${esc(labelOf(r.reason))}</span><span class="reason-bar"><i style="width:${(r.ratio * 100).toFixed(1)}%"></i></span><span class="reason-n">${r.count}</span></li>`,
        )
        .join('')
    : '<li class="muted">還沒有資料</li>';

  const st = streaks(state.sighs);
  const tile = (label, val, unit = '') =>
    `<div class="tile"><div class="t-label">${label}</div><div class="t-val">${val}${unit ? `<small>${unit}</small>` : ''}</div></div>`;
  ui.records.innerHTML = [
    tile('總計', s.total, '次'),
    tile('有紀錄的天數', s.activeDays, '天'),
    tile('平均每天', s.daysTracked ? s.avgPerDay.toFixed(1) : '—', s.daysTracked ? '次' : ''),
    tile('最多的一天', s.maxDay ? s.maxDay.count : '—', s.maxDay ? `次 · ${shortDate(s.maxDay.key)}` : ''),
    tile('最長平靜', s.total ? formatDuration(s.longestCalm) : '—'),
    tile('目前已平靜', s.total ? formatDuration(s.currentCalm) : '—'),
    tile('連續沒嘆氣', s.total ? st.calmDays : '—', s.total ? '天' : ''),
    tile('連續記錄', s.total ? st.recordDays : '—', s.total ? '天' : ''),
    tile('長嘆', s.longCount, '次'),
  ].join('');

  ui.insightList.innerHTML = insights(state.sighs, Date.now(), labelOf)
    .map((t, i) => `<li style="--i:${i}">${esc(t)}</li>`)
    .join('');

  renderYearHeat();
  renderWeekPeriod();
  renderNotes();
}

/* ---------- 設定頁 ---------- */

function renderReasonManage() {
  const list = reasonList().filter((r) => r.id);
  ui.reasonManage.innerHTML = list
    .map(
      (r, i) => `
      <li class="rm-item" data-id="${r.id}">
        <span class="rm-label">${esc(r.label)}${r.custom ? '' : '<small>內建</small>'}</span>
        <span class="rm-actions">
          <button type="button" class="icon-mini" data-act="up" aria-label="上移"${i === 0 ? ' disabled' : ''}>↑</button>
          <button type="button" class="icon-mini" data-act="down" aria-label="下移"${i === list.length - 1 ? ' disabled' : ''}>↓</button>
          ${r.custom ? '<button type="button" class="icon-mini" data-act="rename">改名</button><button type="button" class="icon-mini danger" data-act="remove">刪除</button>' : ''}
        </span>
      </li>`,
    )
    .join('');
}

function renderPeriodList() {
  ui.periodToggle.checked = state.settings.reasonMode === 'period';
  ui.periodList.hidden = state.settings.reasonMode !== 'period';
  ui.periodList.innerHTML = PERIODS.map(
    (p) => `
    <label class="period-row">
      <span>${p.label}<small>${p.hours}</small></span>
      <select class="select" data-period="${p.key}">${reasonOptions(state.settings.periodReasons[p.key])}</select>
    </label>`,
  ).join('');
}

function setSyncStatus(text) {
  if (text != null) {
    ui.syncStatus.textContent = text;
    return;
  }
  const cfg = state.settings.sync;
  if (!cfg) {
    ui.syncStatus.textContent = '';
    return;
  }
  ui.syncStatus.textContent = cfg.lastSync
    ? `上次同步：${fullTime(cfg.lastSync)}${cfg.gistId ? ` · Gist ${cfg.gistId.slice(0, 8)}…` : ''}`
    : '尚未同步';
}

function renderSyncCard() {
  const cfg = state.settings.sync;
  ui.syncSetup.hidden = !!cfg;
  ui.syncConnected.hidden = !cfg;
  setSyncStatus();
  ui.scUrl.textContent = cfg && cfg.gistId ? `https://api.github.com/gists/${cfg.gistId}/comments` : '（第一次同步完成後會出現）';
  ui.scTest.disabled = !(cfg && cfg.gistId);
}

function renderTrash() {
  const tr = state.trash;
  const alive = tr && Date.now() - tr.at < TRASH_TTL;
  ui.restoreTrash.hidden = !alive;
  ui.restoreHint.hidden = !alive;
  if (alive) {
    const left = Math.max(1, Math.round((TRASH_TTL - (Date.now() - tr.at)) / 3_600_000));
    ui.restoreHint.textContent = `剛清掉的 ${tr.sighs.length} 筆還留著，${left} 小時內可以復原。`;
  }
}

function renderSettings() {
  ui.soundToggle.checked = state.settings.sound;
  ui.badgeToggle.checked = state.settings.badge;
  ui.badgeNote.hidden = 'setAppBadge' in navigator;
  ui.micSens.value = String(state.settings.sensitivity);
  ui.micCalReset.hidden = !state.settings.micProfile;
  ui.quickUrl.textContent = quickUrl(location.href);
  renderReasonManage();
  renderPeriodList();
  renderSyncCard();
  renderTrash();
}

function renderAll() {
  renderCount();
  renderReasons();
  renderWeek();
  renderCalm();
  renderRecent();
  renderSettings();
  if (currentView === 'stats') renderStats();
}

/* ---------- 動畫效果 ---------- */

function spawnFloat(long = false) {
  if (reduceMotion()) return;
  const el = document.createElement('span');
  el.className = long ? 'float big' : 'float';
  const words = long ? LONG_FLOAT_WORDS : FLOAT_WORDS;
  el.textContent = words[Math.floor(Math.random() * words.length)];
  el.style.setProperty('--dx', `${Math.round(Math.random() * 90 - 45)}px`);
  el.style.setProperty('--rot', `${Math.round(Math.random() * 30 - 15)}deg`);
  ui.floatLayer.appendChild(el);
  const remove = () => el.remove();
  el.addEventListener('animationend', remove);
  setTimeout(remove, 2500);
}

function spawnRing(long = false) {
  if (reduceMotion()) return;
  const el = document.createElement('i');
  el.className = long ? 'ring long' : 'ring';
  ui.stage.appendChild(el);
  const remove = () => el.remove();
  el.addEventListener('animationend', remove);
  setTimeout(remove, 2000);
}

function pressVisual() {
  ui.sighBtn.classList.add('is-pressed');
  setTimeout(() => ui.sighBtn.classList.remove('is-pressed'), 160);
}

/* ---------- App 圖示徽章 ---------- */

function updateBadge() {
  if (!('setAppBadge' in navigator)) return;
  const n = state.settings.badge ? countToday(state.sighs) : 0;
  try {
    const p = n ? navigator.setAppBadge(n) : navigator.clearAppBadge();
    if (p && p.catch) p.catch(() => {});
  } catch {
    /* 不支援就算了 */
  }
}

/* ---------- 資料操作 ---------- */

function tombstone(t) {
  if (state.deleted.includes(t)) return;
  state.deleted.push(t);
  state.deleted.sort((a, b) => a - b);
  if (state.deleted.length > 5000) state.deleted.splice(0, state.deleted.length - 5000);
}

/** 資料變動後的固定流程：存檔、重畫、徽章、排程同步。 */
function afterChange() {
  persist();
  renderAll();
  updateBadge();
  scheduleSync();
}

function addSigh({ auto = false, reason, quiet = false, intensity = 1 } = {}) {
  const t = Date.now();
  const sigh = { t, r: reason === undefined ? state.settings.reason : reason };
  if (auto) sigh.a = 1;
  if (intensity === 2) sigh.i = 2;
  state.sighs.push(sigh);
  const prev = state.sighs[state.sighs.length - 2];
  if (prev && prev.t > t) state.sighs.sort((a, b) => a.t - b.t);
  afterChange();

  bumpCount();
  spawnRing(intensity === 2);
  spawnFloat(intensity === 2);
  ui.quote.textContent = pickQuote();
  const milestone = milestoneMessage(state.sighs.length);
  if (milestone) toast(milestone, { ms: 4200 });
  else if (!quiet) {
    toast(`今天第 ${countToday(state.sighs)} 次${intensity === 2 ? '，長嘆' : ''}`, {
      ms: 3200,
      actions: [
        { label: '撤銷', onClick: undoLast },
        { label: '加一句', onClick: () => openNoteEditor(t) },
      ],
    });
  }
  // 音效與震動只在使用者碰過頁面之後才做；用快速網址開頁時瀏覽器會擋。
  const interacted = !navigator.userActivation || navigator.userActivation.hasBeenActive;
  if (state.settings.sound && interacted) playExhale();
  if (!auto && interacted && navigator.vibrate) navigator.vibrate(intensity === 2 ? [20, 40, 30] : 12);
  maybeSuggestBreathing();
  return sigh;
}

function undoLast() {
  if (!state.sighs.length) return;
  const removed = state.sighs.pop();
  tombstone(removed.t);
  afterChange();
  if (!countToday(state.sighs)) ui.quote.textContent = pickIdleLine();
  toast('已撤銷上一次');
}

function deleteSigh(t) {
  const i = state.sighs.findIndex((s) => s.t === t);
  if (i < 0) return;
  state.sighs.splice(i, 1);
  tombstone(t);
  afterChange();
}

function setReasonOf(t, reason) {
  const s = state.sighs.find((x) => x.t === t);
  if (!s) return;
  s.r = reason;
  persist();
  scheduleSync();
  if (currentView === 'stats') renderStats();
}

function setNoteOf(t, note) {
  const s = state.sighs.find((x) => x.t === t);
  if (!s) return;
  const n = cleanNote(note);
  if (n) s.n = n;
  else delete s.n;
  persist();
  scheduleSync();
  renderRecent();
  if (currentView === 'stats') renderNotes();
}

function setCurrentReason(reason) {
  state.settings.reason = reason;
  persist();
  renderReasons();
}

function clearAll() {
  if (!state.sighs.length) {
    toast('本來就沒有紀錄');
    return;
  }
  const extra = state.settings.sync ? '雲端備份也會跟著清空。' : '';
  const ok = window.confirm(`確定要清除全部 ${state.sighs.length} 筆紀錄嗎？這無法復原。${extra}`);
  if (!ok) return;
  const n = state.sighs.length;
  state.trash = { at: Date.now(), sighs: state.sighs };
  for (const s of state.sighs) tombstone(s.t);
  state.sighs = [];
  afterChange();
  ui.quote.textContent = pickIdleLine();
  toast(`已清除 ${n} 筆`, { ms: 10000, actions: [{ label: '復原', onClick: restoreTrash }] });
}

function restoreTrash() {
  const tr = state.trash;
  if (!tr || Date.now() - tr.at > TRASH_TTL) {
    toast('已經超過可以復原的時間');
    state.trash = null;
    persist();
    renderTrash();
    return;
  }
  const ts = new Set(tr.sighs.map((s) => s.t));
  state.deleted = state.deleted.filter((t) => !ts.has(t));
  state.sighs = mergeSighs(state.sighs, tr.sighs);
  state.trash = null;
  // 雲端可能已經收到墓碑，下一次同步整份以本機為準
  if (state.settings.sync) state.settings.sync.force = true;
  afterChange();
  if (countToday(state.sighs)) ui.quote.textContent = pickQuote();
  toast(`已復原 ${tr.sighs.length} 筆`);
}

/* ---------- 昨天回顧 ---------- */

function maybeShowReview() {
  const today = dayKey(Date.now());
  if (state.settings.lastReviewDay === today || !state.sighs.length) {
    ui.reviewCard.hidden = true;
    return;
  }
  const r = yesterdayReview(state.sighs, Date.now(), labelOf);
  if (!r.count && !r.weekCount) {
    ui.reviewCard.hidden = true;
    return;
  }
  const st = streaks(state.sighs);
  let text;
  if (r.count) {
    text = `昨天嘆了 ${r.count} 次${r.longCount ? `，其中 ${r.longCount} 次是長嘆` : ''}。`;
    if (r.topReason) text += `最常因為「${r.topReason}」`;
    if (r.busiestPeriod) text += `${r.topReason ? '，' : ''}多半在${r.busiestPeriod}`;
    if (r.topReason || r.busiestPeriod) text += '。';
  } else {
    text = st.calmDays > 1 ? `昨天一次都沒嘆，已經連續 ${st.calmDays} 天了。` : '昨天一次都沒嘆。';
  }
  ui.reviewMain.textContent = text;
  ui.reviewNotes.innerHTML = r.notes.map((n) => `<li>「${esc(n)}」</li>`).join('');
  ui.reviewCard.hidden = false;
}

function dismissReview() {
  state.settings.lastReviewDay = dayKey(Date.now());
  persist();
  ui.reviewCard.hidden = true;
}

async function importFromFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const incoming = parseImport(text);
    const before = state.sighs.length;
    state.sighs = mergeSighs(state.sighs, incoming.sighs);
    const known = new Set((state.settings.customReasons || []).map((c) => c.id));
    for (const c of incoming.customReasons) {
      if (!known.has(c.id)) state.settings.customReasons.push(c);
    }
    afterChange();
    toast(`匯入 ${incoming.sighs.length} 筆，新增了 ${state.sighs.length - before} 筆`);
  } catch (err) {
    toast(`匯入失敗：${err && err.message ? err.message : '檔案格式不對'}`);
  }
}

async function share() {
  const s = summary(state.sighs);
  const line = s.today ? `我今天嘆了 ${s.today} 次氣（累計 ${s.total} 次）。` : `我今天還沒嘆氣（累計 ${s.total} 次）。`;
  const text = `${line} 唉 · 嘆氣計數器 ${location.origin}${location.pathname}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: '唉 · 嘆氣計數器', text });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('已複製到剪貼簿');
  } catch {
    toast('這個瀏覽器不支援分享');
  }
}

/* ---------- 時段預設原因 ---------- */

function applyPeriodReason(force = false) {
  if (state.settings.reasonMode !== 'period') return;
  const key = periodKey(new Date().getHours());
  if (!force && key === lastPeriod) return;
  lastPeriod = key;
  const r = state.settings.periodReasons[key] ?? null;
  if ((state.settings.reason ?? null) !== r) {
    state.settings.reason = r;
    persist();
    renderReasons();
  }
}

/* ---------- 深呼吸 ---------- */

function maybeSuggestBreathing() {
  const now = Date.now();
  if (!shouldSuggestBreathing(state.sighs, now)) return;
  if (now - breathDismissedAt < HOUR) return;
  if (!ui.breathOverlay.hidden) return;
  ui.breathPromptText.textContent = `這一小時已經 ${recentCount(state.sighs, now)} 次了。要不要跟著呼吸一分鐘？`;
  ui.breathPrompt.hidden = false;
  // 沒理會的話 45 秒後自己收起來，一小時內不再問。
  clearTimeout(breathPromptTimer);
  breathPromptTimer = setTimeout(dismissBreathing, 45_000);
}

function dismissBreathing() {
  clearTimeout(breathPromptTimer);
  breathDismissedAt = Date.now();
  ui.breathPrompt.hidden = true;
}

function startBreathing() {
  dismissBreathing();
  ui.breathOverlay.hidden = false;
  ui.breathCircle.style.transitionDuration = '0ms';
  ui.breathCircle.style.transform = 'scale(0.55)';
  ui.breathPhase.textContent = '準備';
  ui.breathCycle.textContent = '';
  breathSession = createBreathSession({
    onPhase: ({ phase, ms, scale, cycle, cycles }) => {
      ui.breathPhase.textContent = phase;
      ui.breathCycle.textContent = `第 ${cycle} / ${cycles} 輪`;
      ui.breathCircle.style.transitionDuration = reduceMotion() ? '0ms' : `${ms}ms`;
      ui.breathCircle.style.transform = `scale(${scale})`;
    },
    onDone: ({ completed }) => {
      ui.breathOverlay.hidden = true;
      breathSession = null;
      if (completed) toast('做完了。肩膀放下來，慢慢來。', { ms: 3600 });
    },
  });
  requestAnimationFrame(() => requestAnimationFrame(() => breathSession && breathSession.start()));
}

function stopBreathing() {
  if (breathSession) breathSession.stop();
  else ui.breathOverlay.hidden = true;
}

/* ---------- 麥克風 ---------- */

const WHY_TEXT = {
  sigh: '像嘆氣，記錄了',
  'too-short': '太短',
  'too-long': '太長',
  'peak-late': '高峰太晚',
  'too-bumpy': '起伏太多，像在說話',
  'too-tonal': '太有音高，像說話或哼歌',
  'no-decay': '沒有漸弱',
};

function setMicStatus(text) {
  ui.micStatus.textContent = text;
}

function setCalStatus(text) {
  ui.micCalStatus.textContent = text;
}

function handleSample(e) {
  if (!calibration) return;
  const n = calibration.samples.length;
  if (e.dur < 250 || e.why === 'too-long') {
    setCalStatus(`${e.dur < 250 ? '太短了' : '太長了'}，再嘆一次（第 ${n + 1} / 3 次）`);
    return;
  }
  calibration.samples.push({ meanFlat: e.meanFlat, dur: e.dur, rise: e.rise });
  if (calibration.samples.length < 3) {
    setCalStatus(`收到了，再一次（第 ${calibration.samples.length + 1} / 3 次）`);
    return;
  }
  const profile = profileFromSamples(calibration.samples);
  calibration = null;
  listener.setCalibrating(false);
  ui.micCal.disabled = false;
  if (profile) {
    state.settings.micProfile = profile;
    listener.setProfile(profile);
    persist();
    ui.micCalReset.hidden = false;
    setCalStatus('校正完成，已依你的聲音調整門檻。');
    setMicStatus('聆聽中');
  } else {
    setCalStatus('樣本不太像嘆氣，再試一次。');
  }
}

function startCalibration() {
  if (!listener) return;
  calibration = { samples: [] };
  listener.setCalibrating(true);
  ui.micCal.disabled = true;
  setCalStatus('請自然地嘆一口氣（第 1 / 3 次）');
  setMicStatus('校正中');
}

function resetCalibration() {
  state.settings.micProfile = null;
  if (listener) listener.setProfile(null);
  persist();
  ui.micCalReset.hidden = true;
  setCalStatus('已回到預設門檻。');
}

async function startMic() {
  if (!SighListener.supported) {
    ui.micToggle.checked = false;
    toast('這個瀏覽器不支援麥克風偵測');
    return;
  }
  listener = new SighListener({
    sensitivity: state.settings.sensitivity,
    profile: state.settings.micProfile,
    onSigh: () => {
      addSigh({ auto: true, quiet: true });
      setMicStatus('聽到了，記錄一次');
    },
    onLevel: ({ level, active }) => {
      ui.micMeterFill.style.transform = `scaleX(${level.toFixed(3)})`;
      ui.micMeterFill.classList.toggle('is-active', active);
      if (active && !calibration) setMicStatus('有聲音…');
    },
    onEvent: (e) => {
      if (e.type === 'ended') {
        stopMic();
        toast('麥克風被中斷了');
        return;
      }
      if (e.type === 'sample') {
        handleSample(e);
        return;
      }
      const sec = (e.dur / 1000).toFixed(1);
      const flat = e.meanFlat != null ? `，氣音程度 ${e.meanFlat.toFixed(2)}` : '';
      ui.micLast.textContent = `上一段聲音 ${sec} 秒：${WHY_TEXT[e.why] || e.why}${flat}`;
      if (!e.sigh) setMicStatus('聆聽中');
    },
  });
  try {
    await listener.start();
    ui.micBody.hidden = false;
    ui.micCard.classList.add('is-on');
    ui.micLast.textContent = '';
    setCalStatus(state.settings.micProfile ? '已用你的聲音校正過。' : '');
    setMicStatus('聆聽中');
  } catch (err) {
    listener = null;
    ui.micToggle.checked = false;
    toast(err && err.name === 'NotAllowedError' ? '沒有取得麥克風權限' : '無法啟動麥克風');
  }
}

function stopMic() {
  if (listener) listener.stop();
  listener = null;
  calibration = null;
  ui.micCal.disabled = false;
  ui.micToggle.checked = false;
  ui.micBody.hidden = true;
  ui.micCard.classList.remove('is-on');
}

/* ---------- 同步 ---------- */

function scheduleSync() {
  if (!state.settings.sync) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync({ silent: true }), 4000);
}

async function runSync({ silent = false } = {}) {
  const cfg = state.settings.sync;
  if (!cfg || syncing) return;
  if (!navigator.onLine) {
    if (!silent) toast('目前離線，連上網之後會再試');
    return;
  }
  syncing = true;
  setSyncStatus('同步中…');
  try {
    const res = await syncOnce(state, createGistClient(cfg.token), Date.now(), { reasons: reasonList() });
    persist();
    renderAll();
    updateBadge();
    if (res.inbox) toast(`從捷徑收到 ${res.inbox} 筆`);
    else if (!silent) {
      toast(
        {
          created: '已建立雲端備份',
          pushed: '已上傳到雲端',
          pulled: '已從雲端更新',
          both: '已和雲端合併',
          unchanged: '已是最新',
        }[res.status] || '同步完成',
      );
    }
  } catch (err) {
    if (err && err.code === 'auth') {
      state.settings.sync = null;
      persist();
      renderSyncCard();
      toast('token 無效或沒有 Gist 權限，請重新設定', { ms: 4000 });
    } else {
      setSyncStatus(`上次同步失敗：${err && err.message ? err.message : '未知錯誤'}`);
      if (!silent) toast(`同步失敗：${err && err.message ? err.message : '未知錯誤'}`);
    }
  } finally {
    syncing = false;
  }
}

async function connectSync() {
  const token = ui.syncToken.value.trim();
  if (!token) {
    toast('請先貼上 token');
    return;
  }
  state.settings.sync = { token, gistId: '', lastSync: 0 };
  persist();
  renderSyncCard();
  await runSync();
  if (state.settings.sync) ui.syncToken.value = '';
}

async function sendShortcutTest() {
  const cfg = state.settings.sync;
  if (!cfg || !cfg.gistId) return;
  ui.scTest.disabled = true;
  ui.scStatus.textContent = '送出中…';
  try {
    await createGistClient(cfg.token).createComment(cfg.gistId, '唉 測試 從設定頁送的');
    ui.scStatus.textContent = '已送出，正在同步回來…';
    await runSync({ silent: true });
    ui.scStatus.textContent = '完成。「最近」清單裡應該多了一筆「捷徑」。';
  } catch (err) {
    ui.scStatus.textContent = `失敗：${err && err.message ? err.message : '未知錯誤'}`;
  } finally {
    ui.scTest.disabled = !(state.settings.sync && state.settings.sync.gistId);
  }
}

function disconnectSync() {
  state.settings.sync = null;
  persist();
  renderSyncCard();
  toast('已移除 token，紀錄仍留在這台裝置上');
}

/* ---------- 週報 ---------- */

async function makeReport() {
  ui.reportStatus.textContent = '產生中…';
  ui.reportMake.disabled = true;
  try {
    const data = weekSummary(state.sighs, Date.now(), labelOf);
    reportCanvas = reportCanvas || document.createElement('canvas');
    await drawReport(reportCanvas, data, {
      theme: effectiveTheme(),
      url: `${location.origin}${location.pathname}`,
      quote: pickQuote(),
    });
    reportBlob = await new Promise((resolve) => reportCanvas.toBlob(resolve, 'image/png'));
    ui.reportImg.src = reportCanvas.toDataURL('image/png');
    ui.reportPreview.hidden = false;
    let canShareFile = false;
    try {
      canShareFile =
        !!navigator.canShare &&
        navigator.canShare({ files: [new File([reportBlob], 'report.png', { type: 'image/png' })] });
    } catch {
      canShareFile = false;
    }
    ui.reportShare.hidden = !canShareFile;
    ui.reportStatus.textContent = '';
  } catch (err) {
    ui.reportStatus.textContent = `產生失敗：${err && err.message ? err.message : '未知錯誤'}`;
  } finally {
    ui.reportMake.disabled = false;
  }
}

async function shareReport() {
  if (!reportBlob) return;
  const file = new File([reportBlob], reportFilename(), { type: 'image/png' });
  try {
    await navigator.share({ files: [file], title: '嘆氣週報' });
  } catch (err) {
    if (!err || err.name !== 'AbortError') toast('分享失敗，改用「儲存圖片」吧');
  }
}

function saveReport() {
  if (!reportBlob) return;
  download(reportFilename(), reportBlob, 'image/png');
}

/* ---------- 分頁 ---------- */

function showView(name) {
  if (!['record', 'stats', 'settings'].includes(name)) name = 'record';
  currentView = name;
  ui.tabs.forEach((tab) => {
    const on = tab.dataset.view === name;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  });
  ui.views.forEach((v) => {
    v.hidden = v.id !== `view-${name}`;
  });
  if (name === 'stats') renderStats();
  if (name === 'record') renderWeek();
  const hash = name === 'record' ? '' : `#${name}`;
  if (location.hash !== hash) {
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  }
  window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

/* ---------- 事件 ---------- */

function cancelPress() {
  clearTimeout(pressTimer);
  pressTimer = null;
  longPressed = false;
  ui.sighBtn.classList.remove('is-long');
}

function bindEvents() {
  // 按一下＝嘆氣；長按＝長嘆
  ui.sighBtn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelPress();
    pressTimer = setTimeout(() => {
      longPressed = true;
      ui.sighBtn.classList.add('is-long');
      if (navigator.vibrate) navigator.vibrate(25);
    }, LONG_PRESS_MS);
  });
  ui.sighBtn.addEventListener('pointerup', () => {
    clearTimeout(pressTimer);
    pressTimer = null;
    if (!longPressed) return;
    longPressed = false;
    ui.sighBtn.classList.remove('is-long');
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 500);
    addSigh({ intensity: 2 });
  });
  ui.sighBtn.addEventListener('pointercancel', cancelPress);
  ui.sighBtn.addEventListener('pointerleave', cancelPress);
  ui.sighBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  ui.sighBtn.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    addSigh();
  });
  ui.undoBtn.addEventListener('click', undoLast);
  ui.reviewOk.addEventListener('click', dismissReview);
  ui.restoreTrash.addEventListener('click', restoreTrash);
  ui.shareBtn.addEventListener('click', share);

  ui.reasons.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    setCurrentReason(chip.dataset.reason || null);
  });

  ui.recentList.addEventListener('click', (e) => {
    const item = e.target.closest('.recent-item');
    if (!item) return;
    const t = Number(item.dataset.t);
    if (e.target.closest('.recent-del')) deleteSigh(t);
    else if (e.target.closest('.note-edit')) openNoteEditor(t);
  });
  ui.recentList.addEventListener('change', (e) => {
    const sel = e.target.closest('.recent-reason');
    if (!sel) return;
    setReasonOf(Number(sel.closest('.recent-item').dataset.t), sel.value || null);
  });

  ui.breathYes.addEventListener('click', startBreathing);
  ui.breathNo.addEventListener('click', dismissBreathing);
  ui.breathStop.addEventListener('click', stopBreathing);

  ui.tabs.forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));
  $('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = ui.tabs.findIndex((t) => t.dataset.view === currentView);
    const next = ui.tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + ui.tabs.length) % ui.tabs.length];
    next.focus();
    showView(next.dataset.view);
  });
  window.addEventListener('hashchange', () => showView(location.hash.slice(1) || 'record'));

  ui.themeToggle.addEventListener('click', () => {
    state.settings.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
    persist();
    applyTheme();
  });
  ui.themeSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-theme-choice]');
    if (!b) return;
    state.settings.theme = b.dataset.themeChoice;
    persist();
    applyTheme();
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

  ui.soundToggle.addEventListener('change', () => {
    state.settings.sound = ui.soundToggle.checked;
    persist();
    if (state.settings.sound) playExhale();
  });
  ui.badgeToggle.addEventListener('change', () => {
    state.settings.badge = ui.badgeToggle.checked;
    persist();
    updateBadge();
  });

  ui.rangeSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-range]');
    if (!b) return;
    statsRange = Number(b.dataset.range);
    $$('button', ui.rangeSeg).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderStats();
  });
  ui.noteSearch.addEventListener('input', renderNotes);
  ui.reportMake.addEventListener('click', makeReport);
  ui.reportShare.addEventListener('click', shareReport);
  ui.reportSave.addEventListener('click', saveReport);

  ui.micToggle.addEventListener('change', () => {
    if (ui.micToggle.checked) startMic();
    else stopMic();
  });
  ui.micSens.addEventListener('input', () => {
    state.settings.sensitivity = Number(ui.micSens.value);
    if (listener) listener.setSensitivity(state.settings.sensitivity);
  });
  ui.micSens.addEventListener('change', persist);
  ui.micCal.addEventListener('click', startCalibration);
  ui.micCalReset.addEventListener('click', resetCalibration);

  ui.exportJson.addEventListener('click', () => {
    download(`sighs-${dayKey(Date.now())}.json`, exportJSON(state), 'application/json');
  });
  ui.exportCsv.addEventListener('click', () => {
    download(`sighs-${dayKey(Date.now())}.csv`, '﻿' + toCSV(state.sighs, labelOf), 'text/csv;charset=utf-8');
  });
  ui.importFile.addEventListener('change', async () => {
    await importFromFile(ui.importFile.files && ui.importFile.files[0]);
    ui.importFile.value = '';
  });
  ui.clearAll.addEventListener('click', clearAll);
  ui.copyQuick.addEventListener('click', async () => {
    const url = quickUrl(location.href);
    try {
      await navigator.clipboard.writeText(url);
      toast('已複製快速記錄網址');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(ui.quickUrl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast('已選取網址，長按可以複製');
    }
  });

  // 原因標籤管理
  const addReason = () => {
    const res = addCustomReason(state.settings, ui.reasonNew.value);
    if (res.error) {
      toast(res.error);
      return;
    }
    ui.reasonNew.value = '';
    persist();
    renderAll();
    scheduleSync();
    toast('已新增標籤');
  };
  ui.reasonAdd.addEventListener('click', addReason);
  ui.reasonNew.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addReason();
    }
  });
  ui.reasonManage.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.rm-item').dataset.id;
    const act = btn.dataset.act;
    if (act === 'up' || act === 'down') {
      if (moveReason(state.settings, id, act === 'up' ? -1 : 1)) {
        persist();
        renderAll();
        scheduleSync();
      }
      return;
    }
    if (act === 'rename') {
      const name = window.prompt('新的名稱', labelOf(id));
      if (name == null) return;
      const res = renameCustomReason(state.settings, id, name);
      if (res.error) toast(res.error);
      else {
        persist();
        renderAll();
        scheduleSync();
      }
      return;
    }
    if (act === 'remove') {
      const used = state.sighs.filter((s) => s.r === id).length;
      const msg = used
        ? `確定刪除「${labelOf(id)}」？有 ${used} 筆紀錄用這個標籤，會改成「沒為什麼」。`
        : `確定刪除「${labelOf(id)}」？`;
      if (!window.confirm(msg)) return;
      for (const s of state.sighs) if (s.r === id) s.r = null;
      removeCustomReason(state.settings, id);
      afterChange();
      toast('已刪除標籤');
    }
  });

  // 時段預設原因
  ui.periodToggle.addEventListener('change', () => {
    state.settings.reasonMode = ui.periodToggle.checked ? 'period' : 'manual';
    persist();
    renderPeriodList();
    lastPeriod = null;
    applyPeriodReason(true);
  });
  ui.periodList.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-period]');
    if (!sel) return;
    state.settings.periodReasons[sel.dataset.period] = sel.value || null;
    persist();
    lastPeriod = null;
    applyPeriodReason(true);
  });

  // 同步
  ui.syncConnect.addEventListener('click', connectSync);
  ui.syncToken.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectSync();
  });
  ui.syncNow.addEventListener('click', () => runSync());
  ui.syncDisconnect.addEventListener('click', disconnectSync);
  ui.scTest.addEventListener('click', sendShortcutTest);
  const copyText = async (text, okMsg) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch {
      toast('無法存取剪貼簿，請長按選取');
    }
  };
  ui.copyScUrl.addEventListener('click', () => copyText(ui.scUrl.textContent, '已複製網址'));
  ui.copyScToken.addEventListener('click', () => {
    if (state.settings.sync) copyText(state.settings.sync.token, '已複製 token，貼到捷徑的 Authorization 標頭');
  });
  window.addEventListener('online', () => scheduleSync());

  // 快速記錄的確認畫面
  ui.quickUndo.addEventListener('click', () => {
    undoLast();
    ui.quickOverlay.hidden = true;
  });
  ui.quickClose.addEventListener('click', () => {
    ui.quickOverlay.hidden = true;
  });

  // 空白鍵：焦點不在任何控制項上時，等同按下大按鈕。
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!ui.breathOverlay.hidden) stopBreathing();
      if (!ui.quickOverlay.hidden) ui.quickOverlay.hidden = true;
      hideToast();
      return;
    }
    if (e.key !== ' ' || e.repeat) return;
    const active = document.activeElement;
    const onBody = !active || active === document.body || active === document.documentElement;
    if (!onBody || currentView !== 'record' || !ui.quickOverlay.hidden || !ui.breathOverlay.hidden) return;
    e.preventDefault();
    pressVisual();
    addSigh({ intensity: e.shiftKey ? 2 : 1 });
  });

  // 回到前景或跨過午夜時，把「今天」相關的畫面重畫。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    checkDayChange(true);
    applyPeriodReason();
    scheduleSync();
  });
  setInterval(() => {
    checkDayChange(false);
    applyPeriodReason();
  }, 30_000);
  setInterval(renderCalm, 1000);

  // 卡片寬度改變（轉向、調整視窗）時，用新的寬度重畫圖表；這種重畫不播動畫。
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver((entries) => {
      let stats = false;
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        if (!w || w === Number(entry.target.dataset.w)) continue;
        if (entry.target === ui.weekChart) renderWeek({ animate: false });
        else stats = true;
      }
      if (stats && currentView === 'stats') renderStats({ animate: false });
    });
    [ui.weekChart, ui.dayChart, ui.hourChart].forEach((el) => ro.observe(el));
  }
}

function checkDayChange(force) {
  const key = dayKey(Date.now());
  if (key === todayStamp && !force) return;
  const changed = key !== todayStamp;
  todayStamp = key;
  renderAll();
  updateBadge();
  maybeShowReview();
  if (changed && !countToday(state.sighs)) ui.quote.textContent = pickIdleLine();
}

function handleQuickAction() {
  const quick = parseQuickAction(location.search);
  if (!quick) return;
  // 先把參數拿掉，重新整理或返回時才不會再記一次。
  history.replaceState(null, '', stripQuickAction(location.href));
  showView('record');
  addSigh({ reason: quick.reason, quiet: true });
  ui.quickCount.textContent = String(countToday(state.sighs));
  ui.quickOverlay.hidden = false;
}

function offerUpdate() {
  if (updateOffered) return;
  updateOffered = true;
  toast('新版本已就緒', { ms: 15000, actions: [{ label: '更新', onClick: () => location.reload() }] });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!secure) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      const watch = (worker) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate();
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate();
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      // 回到前景時順便看看有沒有新版
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    } catch {
      /* 註冊失敗就當作沒有離線功能 */
    }
  });
}

/* ---------- 啟動 ---------- */

function init() {
  applyTheme();
  applyPeriodReason(true);
  renderAll();
  ui.quote.textContent = countToday(state.sighs) ? pickQuote() : pickIdleLine();
  bindEvents();
  maybeShowReview();
  showView(location.hash.slice(1) || 'record');
  handleQuickAction();
  updateBadge();
  registerServiceWorker();
  if (state.settings.sync) setTimeout(() => runSync({ silent: true }), 1500);
  document.body.classList.add('is-ready');
}

init();
