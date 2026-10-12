// Junta as duas modalidades da voz. Primeiro conserta os cortes curtos, depois limpa o chiado
// (nessa ordem, para a limpeza não "espalhar" as bordas dos cortes).
import { fillGaps } from './gapfill.js';
import { denoise } from './denoise.js';

/**
 * @param {{left: Float32Array, right: Float32Array}} voice
 * @param {{restore?: boolean, fillGaps?: boolean, strength?: number, sampleRate?: number, maxGapMs?: number}} opts
 * @returns {{left: Float32Array, right: Float32Array, report: {gapsFound: number, gapsFilled: number, denoised: boolean}}}
 */
export function restoreVoice(voice, opts = {}) {
  let { left, right } = voice;
  const report = { gapsFound: 0, gapsFilled: 0, denoised: false };
  if (opts.fillGaps) {
    const r = fillGaps(left, right, { sampleRate: opts.sampleRate ?? 44100, maxMs: opts.maxGapMs ?? 10 });
    left = r.left;
    right = r.right;
    report.gapsFound = r.found;
    report.gapsFilled = r.filled;
  }
  if (opts.restore) {
    const d = denoise(left, right, { strength: opts.strength ?? 0.6 });
    left = d.left;
    right = d.right;
    report.denoised = true;
  }
  return { left, right, report };
}
