// Monta a lista de faixas do mixer a partir da música aberta (inclui Voz A/B e a gravação do karaokê).
import { singerTrack } from './mix.js';
import { player } from './state.js';

const RATE = 44100;

function voiceSplit(song) {
  const key = JSON.stringify(song.meta.segments);
  if (song._split?.key === key) return song._split.parts;
  const v = song.stems.voz;
  const a = singerTrack(v, RATE, song.meta.segments, 'A');
  const b = singerTrack(v, RATE, song.meta.segments, 'B');
  const rest = { left: new Float32Array(v.left.length), right: new Float32Array(v.left.length) };
  for (let i = 0; i < v.left.length; i++) {
    rest.left[i] = v.left[i] - a.left[i] - b.left[i];
    rest.right[i] = v.right[i] - a.right[i] - b.right[i];
  }
  song._split = { key, parts: { voz_a: a, voz_b: b, voz_sem: rest } };
  return song._split.parts;
}

export function buildItems(song) {
  const items = [];
  const segs = song.meta.segments ?? [];
  for (const [id, s] of Object.entries(song.stems)) {
    if (id === 'voz' && segs.length) {
      const p = voiceSplit(song);
      for (const k of ['voz_a', 'voz_b', 'voz_sem']) items.push({ id: k, left: p[k].left, right: p[k].right });
    } else items.push({ id, left: s.left, right: s.right });
  }
  if (song.recording) items.push({ id: 'gravacao', left: song.recording.left, right: song.recording.right, volume: 1 });
  return items;
}

function snapshot() {
  const out = {};
  for (const s of player.mix?.stems ?? []) out[s.id] = { volume: s.volume, muted: s.muted, solo: s.solo };
  return out;
}

export function loadPlayer(song, keepPosition = true) {
  const snap = snapshot();
  const items = buildItems(song).map((it) => {
    let prev = snap[it.id];
    // Voz A/B/sem marcação herdam o volume da voz inteira, se ainda não tinham ajuste
    if (!prev && it.id.startsWith('voz_')) prev = snap.voz;
    return { ...it, ...(prev ?? {}) };
  });
  player.load(items, keepPosition);
  return items;
}

/** Faixas com o estado atual do mixer, para exportar. */
export function currentMixItems() {
  return (player.mix?.stems ?? []).map((s) => ({ id: s.id, left: s.left, right: s.right, volume: s.volume, muted: s.muted, solo: s.solo }));
}
