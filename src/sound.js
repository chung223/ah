// 用 Web Audio 合成一聲輕輕的吐氣：粉紅噪音 → 帶通濾波往下滑 → 音量包絡。
// 不需要任何音檔。

let ctx = null;

function getContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx) ctx = new Ctx();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function playExhale() {
  const ac = getContext();
  if (!ac) return;

  const dur = 1.4;
  const sr = ac.sampleRate;
  const buffer = ac.createBuffer(1, Math.floor(sr * dur), sr);
  const data = buffer.getChannelData(0);

  // Paul Kellet 的粉紅噪音近似（economy 版）
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11;
  }

  const t0 = ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = buffer;

  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(900, t0);
  filter.frequency.exponentialRampToValueAtTime(240, t0 + dur);

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.6, t0 + 0.12);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(filter).connect(gain).connect(ac.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}
