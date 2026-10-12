// Toca as faixas pelo Web Audio, com volume/mudo/solo e tom/velocidade independentes.
import { Pitcher } from './stretch.js';
import { MixSource } from './mix.js';
import { encodeWav16 } from './wav.js';

export const RATE = 44100;

/** O Pitcher estica o tempo e depois reamostra; para a velocidade final ser s, o esticamento é s / razão do tom. */
function applyTempoPitch(p, speed, semitones) {
  p.setSemitones(semitones);
  p.setTempo(speed / 2 ** (semitones / 12));
}

export class Player {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.mix = null;
    this.pitcher = null;
    this.playing = false;
    this.speed = 1;
    this.semitones = 0;
    this.onEnded = null;
  }

  get duration() {
    return this.mix ? this.mix.length / RATE : 0;
  }

  get position() {
    return this.pitcher ? this.pitcher.pos / RATE : 0;
  }

  _ensureContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ sampleRate: RATE });
    this.node = this.ctx.createScriptProcessor(4096, 0, 2);
    this.node.onaudioprocess = (e) => this._process(e);
    this.node.connect(this.ctx.destination);
  }

  _process(e) {
    const L = e.outputBuffer.getChannelData(0);
    const R = e.outputBuffer.getChannelData(1);
    if (!this.playing || !this.pitcher) {
      L.fill(0);
      R.fill(0);
      return;
    }
    const real = this.pitcher.process(L, R, L.length);
    if (real < L.length) {
      this.playing = false;
      this.pitcher.seek(0);
      this.onEnded?.();
    }
  }

  /** stems: [{ id, left, right, volume?, muted?, solo? }]. Mantém tom e velocidade atuais. */
  load(stems, keepPosition = false) {
    const pos = keepPosition ? this.position : 0;
    const was = this.playing;
    this.playing = false;
    const n = stems.reduce((m, s) => Math.max(m, s.left.length), 0);
    const padded = stems.map((s) => {
      if (s.left.length === n) return s;
      const l = new Float32Array(n);
      const r = new Float32Array(n);
      l.set(s.left);
      r.set(s.right);
      return { ...s, left: l, right: r };
    });
    this.mix = new MixSource(padded);
    this.pitcher = new Pitcher(this.mix);
    applyTempoPitch(this.pitcher, this.speed, this.semitones);
    if (pos) this.pitcher.seek(pos * RATE);
    this.playing = was;
  }

  async play() {
    if (!this.mix) return;
    this._ensureContext();
    await this.ctx.resume();
    this.playing = true;
  }

  pause() {
    this.playing = false;
  }

  seek(seconds) {
    this.pitcher?.seek(Math.max(0, Math.min(this.duration, seconds)) * RATE);
  }

  setVolume(id, v) {
    this.mix.setVolume(id, v);
  }
  setMuted(id, on) {
    this.mix.setMuted(id, on);
  }
  setSolo(id, on) {
    this.mix.setSolo(id, on);
  }
  setSpeed(s) {
    this.speed = s;
    if (this.pitcher) applyTempoPitch(this.pitcher, this.speed, this.semitones);
  }
  setSemitones(n) {
    this.semitones = n;
    if (this.pitcher) applyTempoPitch(this.pitcher, this.speed, this.semitones);
  }

  dispose() {
    this.playing = false;
    this.mix = null;
    this.pitcher = null;
  }
}

/** Gera a mixagem final (com volumes, mudo, solo, tom e velocidade) e devolve um WAV 16 bits. */
export async function renderMix(stems, { speed = 1, semitones = 0 }, onProgress) {
  const n = stems.reduce((m, s) => Math.max(m, s.left.length), 0);
  const padded = stems.map((s) => {
    if (s.left.length === n) return s;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    l.set(s.left);
    r.set(s.right);
    return { ...s, left: l, right: r };
  });
  const p = new Pitcher(new MixSource(padded));
  applyTempoPitch(p, speed, semitones);
  const BLOCK = 8192;
  const lefts = [];
  const rights = [];
  let total = 0;
  for (let i = 0; ; i++) {
    const l = new Float32Array(BLOCK);
    const r = new Float32Array(BLOCK);
    const real = p.process(l, r, BLOCK);
    lefts.push(real < BLOCK ? l.subarray(0, real) : l);
    rights.push(real < BLOCK ? r.subarray(0, real) : r);
    total += real;
    if (real < BLOCK) break;
    if (i % 32 === 0) {
      onProgress?.(Math.min(1, p.pos / n));
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  let o = 0;
  for (let i = 0; i < lefts.length; i++) {
    L.set(lefts[i], o);
    R.set(rights[i], o);
    o += lefts[i].length;
  }
  onProgress?.(1);
  return encodeWav16(L, R, RATE);
}

/** Desloca uma faixa no tempo (ms positivo = atrasa o começo; negativo = adianta). */
export function shiftTrack(track, ms) {
  const k = Math.round((ms / 1000) * RATE);
  if (k === 0) return track;
  const n = track.left.length;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  if (k > 0) {
    left.set(track.left.subarray(0, Math.max(0, n - k)), k);
    right.set(track.right.subarray(0, Math.max(0, n - k)), k);
  } else {
    left.set(track.left.subarray(-k));
    right.set(track.right.subarray(-k));
  }
  return { left, right };
}

/** Grava o microfone (sem filtros que estragam o canto). Devolve { stop(): Promise<Blob> }. */
export async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Este navegador não consegue gravar o microfone.');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    const err = new Error('Sem permissão para usar o microfone. Libere nas configurações do navegador.');
    err.name = 'NotAllowedError';
    throw err;
  }
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks, { type: rec.mimeType }));
        };
        rec.stop();
      }),
  };
}
