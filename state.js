// Estado compartilhado entre as telas.
import { Player } from './player.js';

export const player = new Player();

export const state = {
  pending: null, // música escolhida e ainda não separada: { file, name, duration, left, right }
  options: { focus: 'voz', quality: 'rapida', restore: false, fill: false, strength: 0.6 },
  song: null, // música aberta: { name, stems: {nome:{left,right}}, meta: {id?, saved, focus, segments} }
  preview: null,
  screen: 'library',
  params: {},
};

let renderer = () => {};
export function setRenderer(fn) {
  renderer = fn;
}
export function go(screen, params = {}) {
  state.screen = screen;
  state.params = params;
  renderer();
}

export const STEM_LABEL = {
  voz: 'Voz',
  instrumental: 'Instrumental',
  bateria: 'Bateria',
  baixo: 'Baixo',
  outros: 'Outros instrumentos',
  voz_a: 'Voz A',
  voz_b: 'Voz B',
  voz_sem: 'Voz (sem marcação)',
  gravacao: 'Minha voz',
};
export const STEM_COLOR = {
  voz: 'var(--color-stem-voz)',
  instrumental: 'var(--color-stem-instrumental)',
  bateria: 'var(--color-stem-bateria)',
  baixo: 'var(--color-stem-baixo)',
  outros: 'var(--color-stem-outros)',
  voz_a: 'var(--color-stem-voz)',
  voz_b: 'var(--color-stem-coros)',
  voz_sem: 'var(--color-stem-outros)',
  gravacao: 'var(--color-warning)',
};

/** Alvos do modelo (ordem do HT-Demucs: 0 bateria, 1 baixo, 2 outros, 3 voz). */
export function targetsFor(focus) {
  return focus === 'voz' ? { voz: [3], instrumental: [0, 1, 2] } : { voz: [3], bateria: [0], baixo: [1], outros: [2] };
}
export const overlapFor = (quality) => (quality === 'maxima' ? 0.5 : 0.15);
