// 熱血音效（Web Audio 即時合成，不用音檔）＋ 震動；音效開關記在這支手機
import { h, icon } from './ui.js';

const SFX_KEY = 'sharing-sfx-v1';
let sfxOn = (() => { try { return localStorage.getItem(SFX_KEY) !== 'off'; } catch { return true; } })();
let sfxCtx = null, sfxOut = null, sfxNoiseBuf = null;

function sfxAc() {
  if (!sfxOn) return null;
  if (!sfxCtx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    sfxCtx = new C();
    // 柔性削峰：小聲時幾乎不變，好幾個聲音疊在一起時圓滑壓住不爆音（順便多一點衝勁）
    const clip = sfxCtx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(1.2 * x) / Math.tanh(1.2); }
    clip.curve = curve;
    clip.oversample = '2x';
    sfxOut = sfxCtx.createGain();
    sfxOut.gain.value = 0.85;
    sfxOut.connect(clip).connect(sfxCtx.destination);
    sfxNoiseBuf = sfxCtx.createBuffer(1, sfxCtx.sampleRate, sfxCtx.sampleRate);
    const d = sfxNoiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (sfxCtx.state !== 'running') sfxCtx.resume().catch(() => {});
  return sfxCtx;
}

/** 要在使用者點擊的當下呼叫（iOS 規定），之後計時器裡的音效才出得來 */
export function sfxUnlock() {
  const c = sfxAc();
  if (!c) return;
  const s = c.createBufferSource();
  s.buffer = c.createBuffer(1, 1, 22050);
  s.connect(c.destination);
  s.start(0);
}

function sfxTone(freq, { at = 0, dur = 0.12, type = 'square', vol = 0.2, to = 0, attack = 0.005 } = {}) {
  const c = sfxAc();
  if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(sfxOut);
  o.start(t);
  o.stop(t + dur + 0.03);
}

function sfxNoise({ at = 0, dur = 0.3, vol = 0.25, type = 'bandpass', from = 800, to = 0, q = 1 } = {}) {
  const c = sfxAc();
  if (!c) return;
  const t = c.currentTime + at;
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = sfxNoiseBuf;
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(sfxOut);
  s.start(t);
  s.stop(t + dur + 0.03);
}

const SFX_SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];
const sfxNote = (i, base = 523.25) => base * 2 ** (SFX_SCALE[((i % SFX_SCALE.length) + SFX_SCALE.length) % SFX_SCALE.length] / 12);

export const sfx = {
  /** 喀一聲：轉盤經過一格、梯子橫線、亮點亂跳 */
  tick(i = 0) { sfxTone(1700 + (i % 6) * 110, { dur: 0.035, vol: 0.28 }); sfxTone(850 + (i % 6) * 55, { type: 'triangle', dur: 0.03, vol: 0.2 }); },
  /** 啵：手指放上、揭曉一格（i 越大音越高） */
  pop(i = 0) { const f = sfxNote(i, 440); sfxTone(f, { type: 'sine', dur: 0.16, vol: 0.6, to: f * 1.5 }); sfxTone(f * 2, { type: 'triangle', dur: 0.1, vol: 0.2 }); },
  /** 倒數 3、2、1 */
  beep() { sfxTone(660, { dur: 0.16, vol: 0.4 }); sfxTone(1320, { type: 'sine', dur: 0.12, vol: 0.25 }); },
  /** GO！ */
  go() {
    sfxTone(1320, { dur: 0.36, vol: 0.35 });
    sfxTone(990, { type: 'triangle', dur: 0.36, vol: 0.3 });
    sfxTone(660, { type: 'sawtooth', dur: 0.3, vol: 0.2, to: 1320 });
    sfxNoise({ dur: 0.5, vol: 0.7, from: 500, to: 5000, q: 0.8 });
  },
  /** 咻：開始轉 */
  whoosh() { sfxNoise({ dur: 0.55, vol: 1.4, from: 300, to: 3200, q: 0.9 }); sfxTone(220, { type: 'sawtooth', dur: 0.4, vol: 0.12, to: 660 }); },
  /** 越來越緊張的上升音 */
  riser(sec = 2) {
    sfxTone(160, { type: 'sawtooth', dur: sec, vol: 0.14, to: 880, attack: sec * 0.8 });
    sfxTone(163, { type: 'sawtooth', dur: sec, vol: 0.14, to: 890, attack: sec * 0.8 });
    sfxNoise({ dur: sec, vol: 0.1, type: 'highpass', from: 2000, to: 8000 });
  },
  /** 碰！鎖定、選中 */
  hit() {
    sfxTone(150, { type: 'sine', dur: 0.42, vol: 0.95, to: 42 });
    sfxTone(110, { dur: 0.14, vol: 0.25 });
    sfxNoise({ dur: 0.25, vol: 0.8, type: 'lowpass', from: 2400, to: 300 });
  },
  /** 勝利號角 */
  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { sfxTone(f, { at: i * 0.09, dur: 0.14, vol: 0.22 }); sfxTone(f, { at: i * 0.09, type: 'triangle', dur: 0.14, vol: 0.25 }); });
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => { sfxTone(f, { at: 0.38, type: 'sawtooth', dur: 0.8, vol: 0.07, attack: 0.02 }); sfxTone(f, { at: 0.38, type: 'triangle', dur: 0.8, vol: 0.12, attack: 0.02 }); });
    sfxNoise({ at: 0.38, dur: 0.6, vol: 0.3, type: 'highpass', from: 5000 });
  },
};

// ---- 震動：Android 用 navigator.vibrate；iPhone 不支援，改用 iOS 18 起「切換開關」會輕震的特性
const sfxIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let sfxSwitch = null;
function sfxIosTap() {
  if (!sfxSwitch || !sfxSwitch.isConnected) {
    const id = 'sfx-haptic';
    sfxSwitch = h('label', { for: id, class: 'sfx-haptic', 'aria-hidden': 'true' }, h('input', { id, type: 'checkbox', switch: true, tabindex: '-1' }));
    document.body.append(sfxSwitch);
  }
  sfxSwitch.click();
}
/** 震動；pattern 同 navigator.vibrate（毫秒或 [震, 停, 震…]） */
export function buzz(pattern) {
  try {
    if (navigator.vibrate) { navigator.vibrate(pattern); return; }
    if (!sfxIOS) return;
    const p = Array.isArray(pattern) ? pattern : [pattern];
    let t = 0;
    p.forEach((ms, i) => { if (i % 2 === 0) { const at = t; setTimeout(sfxIosTap, at); if (ms >= 100) setTimeout(sfxIosTap, at + 60); } t += ms; });
  } catch { /* 不支援震動 */ }
}

/** 遊戲畫面右上角的音效開關 */
export function sfxToggle() {
  const b = h('button', { class: 'icon-btn sfx-btn', onclick: () => {
    sfxOn = !sfxOn;
    try { localStorage.setItem(SFX_KEY, sfxOn ? 'on' : 'off'); } catch { /* 無痕模式 */ }
    if (sfxOn) { sfxUnlock(); sfx.pop(4); } else if (sfxCtx) sfxCtx.suspend().catch(() => {});
    draw();
  } });
  const draw = () => { b.setAttribute('aria-label', sfxOn ? '關閉音效' : '開啟音效'); b.setAttribute('aria-pressed', String(sfxOn)); b.replaceChildren(icon(sfxOn ? 'sound' : 'mute')); };
  draw();
  return b;
}
