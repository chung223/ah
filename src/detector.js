// 麥克風嘆氣偵測（實驗性）。
//
// 分成兩層：
// - classifyEvent(frames)：純函式，判斷「一段超過環境音量的聲音」像不像嘆氣。
// - SighListener：負責麥克風、AnalyserNode、自適應噪音地板與狀態機，
//   把一段段聲音丟給 classifyEvent，像嘆氣就回呼 onSigh。
//
// 判斷嘆氣的依據（都是很粗的啟發式，所以叫實驗性）：
// 1. 長度：0.45 ~ 4.5 秒。太短是敲桌子、太長是講話或音樂。
// 2. 波形：音量高峰在前 60%，之後漸弱；只有一兩個起伏。講話會有很多音節起伏。
// 3. 頻譜平坦度（spectral flatness）：吐氣是氣音，接近雜訊、平坦度高；
//    說話和哼歌是有音高的聲音，平坦度低。
// 聲音只在裝置上分析，不會離開瀏覽器。

/** 線性功率頻譜的平坦度：幾何平均 / 算術平均，0（純音）~ 1（白噪音）。 */
export function spectralFlatness(power) {
  let logSum = 0;
  let sum = 0;
  let n = 0;
  for (const p of power) {
    const v = p + 1e-12;
    logSum += Math.log(v);
    sum += v;
    n++;
  }
  if (!n) return 0;
  return Math.exp(logSum / n) / (sum / n);
}

export function movingAverage(arr, w = 3) {
  const half = Math.floor(w / 2);
  return arr.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < arr.length) {
        s += arr[j];
        c++;
      }
    }
    return s / c;
  });
}

/**
 * frames: [{ t: 毫秒, db: 音量(dBFS), flat: 頻譜平坦度 }]，只包含超過門檻的那段。
 * 回傳 { sigh, why, dur, peakPos, peaks, meanFlat, tail }。
 */
export function classifyEvent(frames, opts = {}) {
  const { minDur = 450, maxDur = 4500, minFlat = 0.13, maxPeaks = 2, maxTail = 0.75 } = opts;
  if (!frames || frames.length < 3) return { sigh: false, why: 'too-short', dur: 0 };

  const dur = frames[frames.length - 1].t - frames[0].t;
  if (dur < minDur) return { sigh: false, why: 'too-short', dur };
  if (dur > maxDur) return { sigh: false, why: 'too-long', dur };

  const amp = frames.map((f) => Math.pow(10, f.db / 20));
  let peak = 0;
  let peakIdx = 0;
  amp.forEach((a, i) => {
    if (a > peak) {
      peak = a;
      peakIdx = i;
    }
  });
  const peakPos = peakIdx / Math.max(1, amp.length - 1);

  const sm = movingAverage(amp, 3);
  let peaks = 0;
  for (let i = 1; i < sm.length - 1; i++) {
    if (sm[i] > sm[i - 1] && sm[i] >= sm[i + 1] && sm[i] > peak * 0.4) peaks++;
  }

  const tailN = Math.max(1, Math.floor(amp.length / 4));
  const tail = amp.slice(-tailN).reduce((a, b) => a + b, 0) / tailN / (peak || 1);
  const meanFlat = frames.reduce((a, f) => a + f.flat, 0) / frames.length;

  const checks = {
    'peak-late': peakPos <= 0.6,
    'too-bumpy': peaks <= maxPeaks,
    'too-tonal': meanFlat >= minFlat,
    'no-decay': tail <= maxTail,
  };
  const failed = Object.keys(checks).find((k) => !checks[k]);
  return {
    sigh: !failed,
    why: failed || 'sigh',
    dur,
    peakPos,
    peaks,
    meanFlat,
    tail,
  };
}

const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * 靈敏度 0~1 → 偵測參數。愈高愈容易被判成嘆氣。
 * 有校正結果（profile）時以它為基準，靈敏度只做小幅微調。
 */
export function paramsFor(sensitivity, profile = null) {
  const s = Math.min(1, Math.max(0, Number(sensitivity) || 0));
  if (profile && Number.isFinite(profile.minFlat) && Number.isFinite(profile.riseDb)) {
    return {
      riseDb: clampNum(profile.riseDb + (0.5 - s) * 6, 3, 20),
      minFlat: clampNum(profile.minFlat + (0.5 - s) * 0.08, 0.02, 0.5),
      minDur: profile.minDur ?? 450,
      maxDur: profile.maxDur ?? 4500,
    };
  }
  return {
    riseDb: 16 - 10 * s, // 超過噪音地板多少 dB 算「有聲音」：6 ~ 16 dB
    minFlat: 0.2 - 0.14 * s, // 0.06 ~ 0.2
    minDur: 450,
    maxDur: 4500,
  };
}

/**
 * 校正：使用者刻意嘆幾次氣，從這些樣本算出適合他聲音的門檻。
 * samples: [{ meanFlat, dur, rise }]；至少要兩個合理的樣本，否則回傳 null。
 */
export function profileFromSamples(samples) {
  const ok = (samples || []).filter(
    (x) => x && Number.isFinite(x.meanFlat) && Number.isFinite(x.dur) && x.dur >= 250,
  );
  if (ok.length < 2) return null;
  const minFlat = Math.min(...ok.map((x) => x.meanFlat));
  const minDur = Math.min(...ok.map((x) => x.dur));
  const maxDur = Math.max(...ok.map((x) => x.dur));
  const rises = ok.map((x) => x.rise).filter((v) => Number.isFinite(v));
  return {
    minFlat: clampNum(minFlat * 0.7, 0.02, 0.5),
    riseDb: rises.length ? clampNum(Math.min(...rises) * 0.5, 3, 20) : 10,
    minDur: clampNum(minDur * 0.6, 200, 1500),
    maxDur: clampNum(maxDur * 2, 1500, 10000),
  };
}

export class SighListener {
  constructor({ onSigh, onLevel, onEvent, sensitivity = 0.5, profile = null, interval = 40 } = {}) {
    this.onSigh = onSigh;
    this.onLevel = onLevel;
    this.onEvent = onEvent;
    this.sensitivity = sensitivity;
    this.profile = profile;
    this.calibrating = false;
    this.interval = interval;
    this.timer = null;
    this.stream = null;
    this.ctx = null;
  }

  setProfile(profile) {
    this.profile = profile || null;
  }

  /** 校正模式：每段聲音都當成樣本回報（type: 'sample'），不會記錄嘆氣。 */
  setCalibrating(on) {
    this.calibrating = !!on;
  }

  get running() {
    return this.timer != null;
  }

  setSensitivity(v) {
    this.sensitivity = Math.min(1, Math.max(0, Number(v) || 0));
  }

  static get supported() {
    return !!(
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      (window.AudioContext || window.webkitAudioContext)
    );
  }

  async start() {
    if (!SighListener.supported) throw new Error('unsupported');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.4;
    this.source.connect(this.analyser);

    this.timeBuf = new Float32Array(this.analyser.fftSize);
    this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    this.binLo = Math.max(1, Math.round(150 / binHz));
    this.binHi = Math.min(this.freqBuf.length - 1, Math.round(6000 / binHz));

    this.floor = null;
    this.state = 'idle';
    this.frames = [];
    this.lastAbove = 0;
    this.refractoryUntil = 0;
    this.eventFloor = 0;
    this.peakDb = -100;

    for (const track of this.stream.getTracks()) {
      track.addEventListener('ended', () => {
        this.stop();
        this.onEvent?.({ type: 'ended' });
      });
    }
    this.timer = setInterval(() => this.tick(), this.interval);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.state = 'idle';
    this.frames = [];
  }

  tick() {
    const now = performance.now();
    const an = this.analyser;

    an.getFloatTimeDomainData(this.timeBuf);
    let sum = 0;
    for (let i = 0; i < this.timeBuf.length; i++) sum += this.timeBuf[i] * this.timeBuf[i];
    const rms = Math.sqrt(sum / this.timeBuf.length);
    const db = Math.max(-100, 20 * Math.log10(rms + 1e-8));

    an.getFloatFrequencyData(this.freqBuf);
    const power = [];
    for (let i = this.binLo; i <= this.binHi; i++) power.push(Math.pow(10, this.freqBuf[i] / 10));
    const flat = spectralFlatness(power);

    // 噪音地板：往下追得快、往上追得慢，而且只有沒在事件中才往上追。
    if (this.floor == null) this.floor = db;
    else if (db < this.floor) this.floor += (db - this.floor) * 0.3;
    else if (this.state === 'idle') this.floor += (db - this.floor) * 0.01;

    const params = paramsFor(this.sensitivity, this.calibrating ? null : this.profile);
    const { riseDb, minFlat, minDur, maxDur } = params;
    const threshold = this.floor + riseDb;
    const above = db > threshold;
    const stillLoud = db > this.floor + riseDb * 0.5; // 事件延續用的較低門檻（遲滯）
    const level = Math.min(1, Math.max(0, (db - this.floor) / 30));

    this.onLevel?.({ db, floor: this.floor, threshold, level, flat, active: this.state === 'active' });

    if (this.state === 'idle') {
      if (above && now >= this.refractoryUntil) {
        this.state = 'active';
        this.frames = [{ t: now, db, flat }];
        this.lastAbove = now;
        this.eventFloor = this.floor;
        this.peakDb = db;
      }
      return;
    }

    this.frames.push({ t: now, db, flat });
    if (db > this.peakDb) this.peakDb = db;
    if (stillLoud) this.lastAbove = now;

    const hangMs = 220;
    const tooLong = now - this.frames[0].t > Math.max(5000, maxDur + 500);
    if (now - this.lastAbove > hangMs || tooLong) {
      const cut = this.frames.filter((f) => f.t <= this.lastAbove);
      const result = classifyEvent(cut, { minFlat, minDur, maxDur });
      const rise = this.peakDb - this.eventFloor;
      this.state = 'idle';
      this.frames = [];
      if (this.calibrating) {
        this.onEvent?.({ type: 'sample', ...result, rise });
        return;
      }
      this.onEvent?.({ type: 'event', ...result, rise });
      if (result.sigh) {
        this.refractoryUntil = now + 1500;
        this.onSigh?.(result);
      }
    }
  }
}
