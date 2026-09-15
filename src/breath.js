// 深呼吸引導：一小時內嘆太多次時，邀請使用者跟著呼吸一分鐘。
// 節奏：吸 4 秒、停 2 秒、吐 6 秒，五輪剛好一分鐘。

export const BREATH_PATTERN = [
  { phase: '吸氣', ms: 4000, scale: 1 },
  { phase: '停一下', ms: 2000, scale: 1 },
  { phase: '吐氣', ms: 6000, scale: 0.55 },
];
export const BREATH_CYCLES = 5;

/** 最近 windowMs 內的嘆氣次數是否達到 min。 */
export function shouldSuggestBreathing(sighs, now = Date.now(), { min = 5, windowMs = 3_600_000 } = {}) {
  let n = 0;
  for (let i = sighs.length - 1; i >= 0; i--) {
    if (now - sighs[i].t > windowMs) break;
    n++;
  }
  return n >= min;
}

export function recentCount(sighs, now = Date.now(), windowMs = 3_600_000) {
  let n = 0;
  for (let i = sighs.length - 1; i >= 0; i--) {
    if (now - sighs[i].t > windowMs) break;
    n++;
  }
  return n;
}

/**
 * 一段呼吸練習。onPhase({ phase, ms, scale, cycle, cycles }) 在每個階段開始時呼叫，
 * onDone() 在做完（或被 stop）時呼叫。計時器可注入，方便測試。
 */
export function createBreathSession({
  onPhase,
  onDone,
  cycles = BREATH_CYCLES,
  pattern = BREATH_PATTERN,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  let timer = null;
  let running = false;
  let cycle = 0;
  let step = 0;

  function next() {
    if (!running) return;
    if (step >= pattern.length) {
      step = 0;
      cycle++;
    }
    if (cycle >= cycles) {
      running = false;
      onDone?.({ completed: true });
      return;
    }
    const p = pattern[step];
    onPhase?.({ ...p, cycle: cycle + 1, cycles });
    step++;
    timer = setTimeoutFn(next, p.ms);
  }

  return {
    start() {
      if (running) return;
      running = true;
      cycle = 0;
      step = 0;
      next();
    },
    stop() {
      if (!running) return;
      running = false;
      if (timer != null) clearTimeoutFn(timer);
      timer = null;
      onDone?.({ completed: false });
    },
    get running() {
      return running;
    },
  };
}
