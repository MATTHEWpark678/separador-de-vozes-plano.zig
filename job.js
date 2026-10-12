// Ponte entre as telas e o motor: prepara o áudio, calcula estimativas, monta os resultados.
import { decodeToStereo } from './decode.js';
import { groupStems } from './mix.js';
import { SEGMENT, planWindows } from './chunker.js';
import { overlapFor, targetsFor, state } from './state.js';

const RATE = 44100;
const KEY = 'segundosPorJanela';

export async function ensureDecoded(p) {
  if (p.left && p.right) return;
  const d = await decodeToStereo(await p.file.arrayBuffer());
  p.left = d.left;
  p.right = d.right;
  p.duration = d.duration;
}

export function restoreOptions(o) {
  if (o.focus !== 'voz' || !(o.restore || o.fill)) return null;
  return { restore: o.restore, fillGaps: o.fill, strength: o.strength, sampleRate: RATE };
}

/** Parâmetros da separação (inteira ou prévia). */
export function jobFor(o) {
  return { targets: targetsFor(o.focus), overlap: overlapFor(o.quality), restore: restoreOptions(o) };
}

/** Pega 30 s do meio da música, em cópias (o motor fica com elas). */
export function previewSlice(p) {
  const n = p.left.length;
  const len = Math.min(n, 30 * RATE);
  const start = Math.max(0, Math.floor(n / 2 - len / 2));
  return { left: p.left.slice(start, start + len), right: p.right.slice(start, start + len) };
}

export function toSongStems(raw) {
  const out = {};
  for (const [name, [left, right]] of Object.entries(raw)) out[name] = { left, right };
  return out;
}

export function savedSpeed() {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}
export function rememberSpeed(seconds) {
  try {
    localStorage.setItem(KEY, String(seconds));
  } catch {
    // sem problema
  }
}

/** Estimativa em segundos para separar `duration` segundos de música, ou null se ainda não medimos. */
export function estimateSeconds(duration, quality) {
  const per = savedSpeed();
  if (!per) return null;
  const n = Math.round(duration * RATE);
  return planWindows(n, SEGMENT, overlapFor(quality)).windows.length * per;
}

export function fmtMinutes(sec) {
  if (sec < 90) return `${Math.round(sec)} s`;
  return `${Math.round(sec / 60)} min`;
}

/** Soma tudo que não é voz, para a prévia B. */
export function instrumentalOf(stems) {
  if (stems.instrumental) return stems.instrumental;
  return groupStems(stems, { instrumental: ['bateria', 'baixo', 'outros'] }).instrumental;
}

export function newSong(name, rawStems, duration) {
  const o = state.options;
  return {
    name,
    stems: toSongStems(rawStems),
    meta: { saved: false, name, focus: o.focus, quality: o.quality, createdAt: Date.now(), duration, segments: [] },
  };
}
