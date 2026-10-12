// Mixagem ao vivo de várias faixas, com volume, mudo e solo, e agrupamento de faixas.
// Não usa nada do navegador, então dá para testar em Node.

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Ganho que cada faixa realmente tem: mudo zera; se alguma faixa está em solo,
 * só as faixas em solo tocam. Mudo e solo na mesma faixa: o mudo vence.
 */
export function effectiveGains(stems) {
  const anySolo = stems.some((s) => s.solo);
  return stems.map((s) => {
    if (s.muted) return 0;
    if (anySolo && !s.solo) return 0;
    return clamp01(s.volume);
  });
}

/** Fonte para o Pitcher: soma as faixas, cada uma com o seu ganho. */
export class MixSource {
  /** @param {{id:string,left:Float32Array,right:Float32Array,volume?:number,muted?:boolean,solo?:boolean}[]} stems */
  constructor(stems) {
    this.stems = stems.map((s) => ({ volume: 1, muted: false, solo: false, ...s }));
    this.length = this.stems.reduce((m, s) => Math.max(m, s.left.length), 0);
    this._refresh();
  }

  _refresh() {
    this._gains = effectiveGains(this.stems);
  }

  get(id) {
    const s = this.stems.find((x) => x.id === id);
    if (!s) throw new RangeError(`Faixa desconhecida: ${id}`);
    return s;
  }

  setVolume(id, v) {
    this.get(id).volume = clamp01(v);
    this._refresh();
  }

  setMuted(id, on) {
    this.get(id).muted = !!on;
    this._refresh();
  }

  setSolo(id, on) {
    this.get(id).solo = !!on;
    this._refresh();
  }

  read(start, len, outL, outR) {
    outL.fill(0, 0, len);
    outR.fill(0, 0, len);
    for (let si = 0; si < this.stems.length; si++) {
      const g = this._gains[si];
      if (g === 0) continue;
      const { left, right } = this.stems[si];
      const from = Math.max(0, -start);
      const to = Math.min(len, left.length - start);
      for (let k = from; k < to; k++) {
        outL[k] += left[start + k] * g;
        outR[k] += right[start + k] * g;
      }
    }
  }
}

/**
 * Junta faixas em grupos para gastar menos memória no celular.
 * plan: { nomeDoGrupo: ['faixaA', 'faixaB'] }. As faixas que não estão no plano ficam como estão.
 * Devolve { nome: { left, right } }.
 */
export function groupStems(stems, plan) {
  const out = {};
  const used = new Set();
  for (const [group, members] of Object.entries(plan)) {
    const parts = members.map((m) => {
      if (!stems[m]) throw new RangeError(`Falta a faixa "${m}" para montar o grupo "${group}".`);
      used.add(m);
      return stems[m];
    });
    const n = Math.max(...parts.map((p) => p.left.length));
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (const p of parts) {
      for (let i = 0; i < p.left.length; i++) {
        left[i] += p.left[i];
        right[i] += p.right[i];
      }
    }
    out[group] = { left, right };
  }
  for (const [name, s] of Object.entries(stems)) if (!used.has(name)) out[name] = s;
  return out;
}

/** Corta um trecho [startS, endS) em segundos de uma faixa. Usado para Voz A e Voz B. */
export function sliceSeconds(stem, sampleRate, startS, endS) {
  const a = Math.max(0, Math.floor(startS * sampleRate));
  const b = Math.min(stem.left.length, Math.floor(endS * sampleRate));
  return { left: stem.left.subarray(a, Math.max(a, b)), right: stem.right.subarray(a, Math.max(a, b)) };
}

/**
 * Monta a faixa de um cantor a partir da faixa de voz e das marcações de tempo:
 * dentro dos trechos do cantor o som passa; fora deles vira silêncio.
 * Há uma descida e uma subida curtas (fadeMs) nas bordas para não estalar.
 * segments: [{ start, end, singer }] em segundos. singer: "A" ou "B".
 */
export function singerTrack(voice, sampleRate, segments, singer, fadeMs = 12) {
  const n = voice.left.length;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const fade = Math.max(1, Math.round((fadeMs / 1000) * sampleRate));
  for (const seg of segments) {
    if (seg.singer !== singer) continue;
    const a = Math.max(0, Math.floor(seg.start * sampleRate));
    const b = Math.min(n, Math.floor(seg.end * sampleRate));
    for (let i = a; i < b; i++) {
      const fi = Math.min(1, (i - a + 1) / fade);
      const fo = Math.min(1, (b - i) / fade);
      const g = Math.min(fi, fo);
      left[i] = voice.left[i] * g;
      right[i] = voice.right[i] * g;
    }
  }
  return { left, right };
}

/** Estimativa do espaço que o app usa e se está perto do limite. */
export function storageLevel(usedBytes, quotaBytes) {
  if (!(quotaBytes > 0)) return { fraction: 0, level: 'normal' };
  const fraction = Math.min(1, usedBytes / quotaBytes);
  return { fraction, level: fraction >= 0.95 ? 'cheio' : fraction >= 0.8 ? 'perto' : 'normal' };
}
