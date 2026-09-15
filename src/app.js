// 主程式：把資料層（storage）、統計（stats）、偵測器（detector）接到畫面上。
// 所有 DOM 操作都集中在這裡；其他模組不碰畫面。

import { createStore, mergeSighs, parseImport, toCSV, exportJSON } from './storage.js';
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
  WEEKDAYS,
} from './stats.js';
import { pickQuote, pickIdleLine, milestoneMessage } from './quotes.js';
import { SighListener } from './detector.js';
import { playExhale } from './sound.js';
import { parseQuickAction, stripQuickAction, quickUrl } from './quick.js';

/** 原因清單。id 為 null 代表「沒為什麼」，也是預設值。 */
export const REASONS = [
  { id: null, label: '沒為什麼' },
  { id: 'work', label: '工作' },
  { id: 'study', label: '課業' },
  { id: 'love', label: '感情' },
  { id: 'family', label: '家庭' },
  { id: 'money', label: '金錢' },
  { id: 'health', label: '身體' },
  { id: 'weather', label: '天氣' },
  { id: 'people', label: '人際' },
  { id: 'other', label: '其他' },
];

const FLOAT_WORDS = ['唉', '唉～', '呼…', '哎', '嗯…', '唉。'];
const THEME_COLORS = { dark: '#0d1120', light: '#f4eee3' };

const labelOf = (id) => (REASONS.find((r) => r.id === (id ?? null)) || REASONS[0]).label;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const store = createStore(window.localStorage);
let state = store.load();
let currentView = 'record';
let statsRange = 7;
let listener = null;
let toastTimer = null;
let todayStamp = dayKey(Date.now());

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

  weekChart: $('#week-chart'),
  weekTotal: $('#week-total'),
  calmNow: $('#calm-now'),
  calmLongest: $('#calm-longest'),
  totalCount: $('#total-count'),
  shareBtn: $('#share-btn'),

  micCard: $('#card-mic'),
  micToggle: $('#mic-toggle'),
  micBody: $('#mic-body'),
  micMeterFill: $('#mic-meter-fill'),
  micStatus: $('#mic-status'),
  micSens: $('#mic-sens'),
  micLast: $('#mic-last'),

  recentList: $('#recent-list'),
  recentEmpty: $('#recent-empty'),

  rangeSeg: $('#range-seg'),
  dayChart: $('#day-chart'),
  daySummary: $('#day-summary'),
  hourChart: $('#hour-chart'),
  hourSummary: $('#hour-summary'),
  reasonList: $('#reason-list'),
  records: $('#records'),
  insightList: $('#insight-list'),

  themeSeg: $('#theme-seg'),
  soundToggle: $('#sound-toggle'),
  quickUrl: $('#quick-url'),
  copyQuick: $('#copy-quick'),
  exportJson: $('#export-json'),
  exportCsv: $('#export-csv'),
  importFile: $('#import-file'),
  clearAll: $('#clear-all'),

  toast: $('#toast'),
};

/* ---------- 小工具 ---------- */

function toast(text, ms = 2600) {
  ui.toast.textContent = text;
  ui.toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('is-on'), ms);
}

function persist() {
  if (!store.save(state)) toast('存不進去，瀏覽器的儲存空間可能滿了');
}

function shortDate(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${m}/${d}`;
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 產生長條圖 SVG。data: [{ count, ... }]
 * 所有文字都來自程式內部的固定字串或數字，不含使用者輸入。
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
  // 以容器的實際像素寬度當座標系，文字與長條才不會隨卡片寬度放大。
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
      `<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}" rx="${Math.min(3, bw / 2)}" style="--i:${i}"><title>${d.title || ''}</title></rect>`,
    );
    if (valueLabels && d.count) {
      parts.push(`<text class="val" x="${(x + bw / 2).toFixed(2)}" y="${(y - 5).toFixed(2)}" text-anchor="middle">${d.count}</text>`);
    }
    if (labelAt(i, n)) {
      parts.push(`<text class="lbl" x="${(x + bw / 2).toFixed(2)}" y="${H - 4}" text-anchor="middle">${label(d, i)}</text>`);
    }
  });
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="chart${animate ? '' : ' no-anim'}" role="img" aria-label="${aria}">${parts.join('')}</svg>`;
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

/* ---------- 畫面 ---------- */

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

function renderReasons() {
  ui.reasons.innerHTML = REASONS.map(
    (r) =>
      `<button type="button" class="chip" data-reason="${r.id ?? ''}" aria-pressed="${(r.id ?? null) === state.settings.reason}">${r.label}</button>`,
  ).join('');
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
}

function renderRecent() {
  const items = state.sighs.slice(-8).reverse();
  ui.recentEmpty.hidden = items.length > 0;
  ui.recentList.innerHTML = items
    .map(
      (s) => `
      <li class="recent-item" data-t="${s.t}">
        <span class="recent-time">${formatTime(s.t)}</span>
        <select class="recent-reason" aria-label="這次嘆氣的原因">
          ${REASONS.map(
            (r) => `<option value="${r.id ?? ''}"${(r.id ?? null) === (s.r ?? null) ? ' selected' : ''}>${r.label}</option>`,
          ).join('')}
        </select>
        ${s.a ? '<span class="recent-auto" title="麥克風自動偵測">自動</span>' : ''}
        <button class="recent-del" type="button" aria-label="刪除這筆紀錄">×</button>
      </li>`,
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
  ui.reasonList.innerHTML = reasons.length
    ? reasons
        .map(
          (r, i) =>
            `<li style="--i:${i}"><span class="reason-name">${labelOf(r.reason)}</span><span class="reason-bar"><i style="width:${(r.ratio * 100).toFixed(1)}%"></i></span><span class="reason-n">${r.count}</span></li>`,
        )
        .join('')
    : '<li class="muted">還沒有資料</li>';

  const tile = (label, val, unit = '') =>
    `<div class="tile"><div class="t-label">${label}</div><div class="t-val">${val}${unit ? `<small>${unit}</small>` : ''}</div></div>`;
  ui.records.innerHTML = [
    tile('總計', s.total, '次'),
    tile('有紀錄的天數', s.activeDays, '天'),
    tile('平均每天', s.daysTracked ? s.avgPerDay.toFixed(1) : '—', s.daysTracked ? '次' : ''),
    tile('最多的一天', s.maxDay ? s.maxDay.count : '—', s.maxDay ? `次 · ${shortDate(s.maxDay.key)}` : ''),
    tile('最長平靜', s.total ? formatDuration(s.longestCalm) : '—'),
    tile('目前已平靜', s.total ? formatDuration(s.currentCalm) : '—'),
  ].join('');

  ui.insightList.innerHTML = insights(state.sighs, Date.now(), labelOf)
    .map((t, i) => `<li style="--i:${i}">${t}</li>`)
    .join('');
}

function renderSettings() {
  ui.soundToggle.checked = state.settings.sound;
  ui.micSens.value = String(state.settings.sensitivity);
  ui.quickUrl.textContent = quickUrl(location.href);
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

function spawnFloat() {
  if (reduceMotion()) return;
  const el = document.createElement('span');
  el.className = 'float';
  el.textContent = FLOAT_WORDS[Math.floor(Math.random() * FLOAT_WORDS.length)];
  el.style.setProperty('--dx', `${Math.round(Math.random() * 90 - 45)}px`);
  el.style.setProperty('--rot', `${Math.round(Math.random() * 30 - 15)}deg`);
  ui.floatLayer.appendChild(el);
  const remove = () => el.remove();
  el.addEventListener('animationend', remove);
  setTimeout(remove, 2500);
}

function spawnRing() {
  if (reduceMotion()) return;
  const el = document.createElement('i');
  el.className = 'ring';
  ui.stage.appendChild(el);
  const remove = () => el.remove();
  el.addEventListener('animationend', remove);
  setTimeout(remove, 2000);
}

function pressVisual() {
  ui.sighBtn.classList.add('is-pressed');
  setTimeout(() => ui.sighBtn.classList.remove('is-pressed'), 160);
}

/* ---------- 資料操作 ---------- */

function addSigh({ auto = false, reason } = {}) {
  const t = Date.now();
  const sigh = { t, r: reason === undefined ? state.settings.reason : reason };
  if (auto) sigh.a = 1;
  state.sighs.push(sigh);
  const prev = state.sighs[state.sighs.length - 2];
  if (prev && prev.t > t) state.sighs.sort((a, b) => a.t - b.t);
  persist();
  renderAll();

  bumpCount();
  spawnRing();
  spawnFloat();
  ui.quote.textContent = pickQuote();
  const milestone = milestoneMessage(state.sighs.length);
  if (milestone) toast(milestone, 4200);
  // 音效與震動只在使用者碰過頁面之後才做；用快速網址開頁時瀏覽器會擋。
  const interacted = !navigator.userActivation || navigator.userActivation.hasBeenActive;
  if (state.settings.sound && interacted) playExhale();
  if (!auto && interacted && navigator.vibrate) navigator.vibrate(12);
}

function undoLast() {
  if (!state.sighs.length) return;
  state.sighs.pop();
  persist();
  renderAll();
  if (!countToday(state.sighs)) ui.quote.textContent = pickIdleLine();
  toast('已撤銷上一次');
}

function deleteSigh(t) {
  const i = state.sighs.findIndex((s) => s.t === t);
  if (i < 0) return;
  state.sighs.splice(i, 1);
  persist();
  renderAll();
}

function setReasonOf(t, reason) {
  const s = state.sighs.find((x) => x.t === t);
  if (!s) return;
  s.r = reason;
  persist();
  if (currentView === 'stats') renderStats();
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
  const ok = window.confirm(`確定要清除全部 ${state.sighs.length} 筆紀錄嗎？這無法復原。`);
  if (!ok) return;
  state.sighs = [];
  persist();
  renderAll();
  ui.quote.textContent = pickIdleLine();
  toast('已清除所有紀錄');
}

async function importFromFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const incoming = parseImport(text);
    const before = state.sighs.length;
    state.sighs = mergeSighs(state.sighs, incoming);
    persist();
    renderAll();
    toast(`匯入 ${incoming.length} 筆，新增了 ${state.sighs.length - before} 筆`);
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

async function startMic() {
  if (!SighListener.supported) {
    ui.micToggle.checked = false;
    toast('這個瀏覽器不支援麥克風偵測');
    return;
  }
  listener = new SighListener({
    sensitivity: state.settings.sensitivity,
    onSigh: () => {
      addSigh({ auto: true });
      setMicStatus('聽到了，記錄一次');
    },
    onLevel: ({ level, active }) => {
      ui.micMeterFill.style.transform = `scaleX(${level.toFixed(3)})`;
      ui.micMeterFill.classList.toggle('is-active', active);
      if (active) setMicStatus('有聲音…');
    },
    onEvent: (e) => {
      if (e.type === 'ended') {
        stopMic();
        toast('麥克風被中斷了');
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
  ui.micToggle.checked = false;
  ui.micBody.hidden = true;
  ui.micCard.classList.remove('is-on');
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

function bindEvents() {
  ui.sighBtn.addEventListener('click', () => addSigh());
  ui.undoBtn.addEventListener('click', undoLast);
  ui.shareBtn.addEventListener('click', share);

  ui.reasons.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    setCurrentReason(chip.dataset.reason || null);
  });

  ui.recentList.addEventListener('click', (e) => {
    const del = e.target.closest('.recent-del');
    if (!del) return;
    deleteSigh(Number(del.closest('.recent-item').dataset.t));
  });
  ui.recentList.addEventListener('change', (e) => {
    const sel = e.target.closest('.recent-reason');
    if (!sel) return;
    setReasonOf(Number(sel.closest('.recent-item').dataset.t), sel.value || null);
  });

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

  ui.rangeSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-range]');
    if (!b) return;
    statsRange = Number(b.dataset.range);
    $$('button', ui.rangeSeg).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderStats();
  });

  ui.micToggle.addEventListener('change', () => {
    if (ui.micToggle.checked) startMic();
    else stopMic();
  });
  ui.micSens.addEventListener('input', () => {
    state.settings.sensitivity = Number(ui.micSens.value);
    if (listener) listener.setSensitivity(state.settings.sensitivity);
  });
  ui.micSens.addEventListener('change', persist);

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

  // 空白鍵：焦點不在任何控制項上時，等同按下大按鈕。
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || e.repeat) return;
    const active = document.activeElement;
    const onBody = !active || active === document.body || active === document.documentElement;
    if (!onBody || currentView !== 'record') return;
    e.preventDefault();
    pressVisual();
    addSigh();
  });

  // 回到前景或跨過午夜時，把「今天」相關的畫面重畫。
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkDayChange(true);
  });
  setInterval(() => checkDayChange(false), 30_000);
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
  if (changed && !countToday(state.sighs)) ui.quote.textContent = pickIdleLine();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!secure) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

/* ---------- 啟動 ---------- */

function handleQuickAction() {
  const quick = parseQuickAction(location.search);
  if (!quick) return;
  // 先把參數拿掉，重新整理或返回時才不會再記一次。
  history.replaceState(null, '', stripQuickAction(location.href));
  showView('record');
  addSigh({ reason: quick.reason });
  if (!milestoneMessage(state.sighs.length)) {
    toast(`記錄了，今天第 ${countToday(state.sighs)} 次`, 3200);
  }
}

function init() {
  applyTheme();
  renderAll();
  ui.quote.textContent = countToday(state.sighs) ? pickQuote() : pickIdleLine();
  bindEvents();
  showView(location.hash.slice(1) || 'record');
  handleQuickAction();
  registerServiceWorker();
  document.body.classList.add('is-ready');
}

init();
