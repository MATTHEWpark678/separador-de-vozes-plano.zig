// Redução de chiado por espectro ("subtração espectral"), em JavaScript puro.
//
// 1) estima o perfil do chiado: para cada frequência, olha a energia em vários pontos da música
//    e usa um valor baixo (percentil 15) como "o chiado de fundo";
// 2) em cada janela, baixa as frequências que não passam muito desse chiado e mantém as fortes;
// 3) suaviza os ganhos no tempo e na frequência para não criar o "som de bolhas" típico.
//
// Limites honestos: tira chiado estável (ruído de fundo, fita, o "metálico" leve da separação).
// Não conserta uma separação que misturou instrumentos na voz. Em voz muito sustentada, o perfil
// pode superestimar o chiado; por isso existe o controle de força.

import { FFT } from './fft.js';

const FRAME = 2048;

/**
 * @param {Float32Array} x
 * @param {{strength?: number, frame?: number}} [opts] strength de 0 a 1 (padrão 0,6)
 * @returns {Float32Array} mesmo tamanho de x
 */
export function denoiseChannel(x, { strength = 0.6, frame = FRAME } = {}) {
  const total = x.length;
  const out = new Float32Array(total);
  if (total === 0) return out;
  const s = Math.min(1, Math.max(0, strength));

  const N = frame;
  const H = N / 2;
  const K = N / 2 + 1;
  const fft = new FFT(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = Math.sin((Math.PI * (i + 0.5)) / N); // w² soma 1 com 50% de sobreposição
  const T = Math.floor((total - 1) / H) + 2;
  const re = new Float64Array(N);
  const im = new Float64Array(N);

  const loadFrame = (t) => {
    const base = (t - 1) * H;
    for (let i = 0; i < N; i++) {
      const idx = base + i;
      re[i] = idx >= 0 && idx < total ? x[idx] * win[i] : 0;
      im[i] = 0;
    }
    fft.forward(re, im);
  };

  // 1) perfil do chiado em uma amostra dos quadros
  const step = Math.max(1, Math.floor(T / 1500));
  const picks = [];
  for (let t = 0; t < T; t += step) picks.push(t);
  const mags = Array.from({ length: K }, () => new Float32Array(picks.length));
  picks.forEach((t, pi) => {
    loadFrame(t);
    for (let k = 0; k < K; k++) mags[k][pi] = Math.hypot(re[k], im[k]);
  });
  const noise = new Float32Array(K);
  const NOISE_SCALE = 2.0; // o percentil 15 fica abaixo da média do chiado
  for (let k = 0; k < K; k++) {
    const sorted = mags[k].slice().sort();
    noise[k] = sorted[Math.floor(0.15 * (sorted.length - 1))] * NOISE_SCALE;
  }
  // Uma nota sustentada (ou um tom constante) aparece em todos os quadros e seria tomada por chiado.
  // O chiado de verdade é liso ao longo da frequência e a nota é um pico estreito: então, trocamos
  // cada ponto do perfil pelo mínimo da vizinhança e depois suavizamos.
  const R = 6;
  const minimal = new Float32Array(K);
  for (let k = 0; k < K; k++) {
    let m = Infinity;
    for (let j = Math.max(0, k - R); j <= Math.min(K - 1, k + R); j++) if (noise[j] < m) m = noise[j];
    minimal[k] = m;
  }
  for (let k = 0; k < K; k++) {
    let s2 = 0;
    let c = 0;
    for (let j = Math.max(0, k - R); j <= Math.min(K - 1, k + R); j++) {
      s2 += minimal[j];
      c++;
    }
    noise[k] = s2 / c;
  }

  // 2) passada principal
  const alpha = 1 + 1.5 * s; // quanto subtrair além do chiado estimado
  const floorGain = 10 ** (-(10 + 20 * s) / 20); // mínimo permitido (−10 a −30 dB)
  const prev = new Float32Array(K).fill(1);
  const raw = new Float32Array(K);
  const gain = new Float32Array(K);
  for (let t = 0; t < T; t++) {
    loadFrame(t);
    for (let k = 0; k < K; k++) {
      const m = Math.hypot(re[k], im[k]);
      raw[k] = Math.max(floorGain, 1 - (alpha * noise[k]) / (m + 1e-12));
    }
    for (let k = 0; k < K; k++) {
      const a = raw[Math.max(0, k - 1)];
      const b = raw[k];
      const c = raw[Math.min(K - 1, k + 1)];
      // suavização na frequência, sem nunca baixar um pico (a nota/voz forte fica intacta)
      const f = Math.max(b, 0.25 * a + 0.5 * b + 0.25 * c);
      // no tempo: sobe na hora (começo da voz não é engolido) e desce devagar (sem "bolhas")
      gain[k] = f > prev[k] ? f : 0.6 * f + 0.4 * prev[k];
      prev[k] = gain[k];
    }
    for (let k = 0; k < K; k++) {
      re[k] *= gain[k];
      im[k] *= gain[k];
      if (k > 0 && k < N / 2) {
        re[N - k] *= gain[k];
        im[N - k] *= gain[k];
      }
    }
    fft.inverse(re, im);
    const base = (t - 1) * H;
    for (let i = 0; i < N; i++) {
      const idx = base + i;
      if (idx >= 0 && idx < total) out[idx] += re[i] * win[i];
    }
  }
  return out;
}

export function denoise(left, right, opts) {
  return { left: denoiseChannel(left, opts), right: denoiseChannel(right, opts) };
}
