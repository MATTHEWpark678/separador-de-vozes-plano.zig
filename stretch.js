// Tom e velocidade independentes, em JavaScript puro (sem bibliotecas).
//
// Técnica: WSOLA (esticar o tempo sem mudar o tom) + reamostragem (mudar o tom).
//   velocidade s e tom de r = 2^(semitons/12):
//   1) o WSOLA muda a duração por t = s / r, sem mexer no tom;
//   2) a reamostragem lê o resultado r vezes mais rápido, o que muda o tom por r e
//      devolve a duração para 1 / s.
// Quando velocidade = 1 e tom = 0, nada é processado: o som passa direto e exato.
//
// A fonte é qualquer objeto { length, read(start, len, outL, outR) } que preenche outL/outR
// com as amostras de start até start+len (zeros fora da música). Assim a mesma classe serve
// para uma faixa só ou para a mixagem ao vivo de várias faixas.

const W = 2048; // tamanho da janela
const HS = W / 2; // passo de saída (50% de sobreposição)
const DELTA = 400; // até onde procurar o melhor ponto de encaixe (amostras)
const CAP = 1 << 15; // tamanho da fila de saída

const HANN = new Float32Array(W);
for (let i = 0; i < W; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / W);

export const TEMPO_MIN = 0.25;
export const TEMPO_MAX = 4;
export const SEMITONES_MIN = -12;
export const SEMITONES_MAX = 12;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Pitcher {
  constructor(source) {
    this.source = source;
    this.tempo = 1;
    this.semitones = 0;
    this.pos = 0; // posição de leitura na fonte, em amostras

    this._fL = new Float32Array(W);
    this._fR = new Float32Array(W);
    this._tL = new Float32Array(W);
    this._tR = new Float32Array(W);
    this._ref = new Float32Array(HS);
    this._reg = new Float32Array(2 * DELTA + HS);
    this._accL = new Float32Array(W);
    this._accR = new Float32Array(W);
    this._qL = new Float32Array(CAP);
    this._qR = new Float32Array(CAP);
    this._resetStretch();
  }

  get ratio() {
    return 2 ** (this.semitones / 12);
  }

  get direct() {
    return this.tempo === 1 && this.semitones === 0;
  }

  setTempo(t) {
    const was = this.direct;
    this.tempo = clamp(t, TEMPO_MIN, TEMPO_MAX);
    if (was && !this.direct) this._resetStretch();
  }

  setSemitones(s) {
    const was = this.direct;
    this.semitones = clamp(Math.round(s), SEMITONES_MIN, SEMITONES_MAX);
    if (was && !this.direct) this._resetStretch();
  }

  seek(samplePos) {
    this.pos = clamp(samplePos, 0, this.source.length);
    this._resetStretch();
  }

  _resetStretch() {
    this._prevStart = null;
    this._accL.fill(0);
    this._accR.fill(0);
    this._qL[0] = 0; // uma amostra de guarda, para a interpolação cúbica
    this._qR[0] = 0;
    this._fl = 1; // quantas amostras válidas há na fila
    this._rpos = 1; // posição de leitura (fracionária) na fila
    this._ended = false;
  }

  // Procura o ponto de encaixe com maior correlação com a "continuação natural" do quadro anterior.
  _bestOffset(p) {
    const { source, _tL: tL, _tR: tR, _ref: ref, _reg: reg } = this;
    source.read(this._prevStart + HS, HS, tL, tR);
    for (let i = 0; i < HS; i++) ref[i] = 0.5 * (tL[i] + tR[i]);
    const rLen = 2 * DELTA + HS;
    source.read(p - DELTA, rLen, tL, tR);
    for (let i = 0; i < rLen; i++) reg[i] = 0.5 * (tL[i] + tR[i]);

    let e = 0;
    for (let i = 0; i < HS; i++) e += reg[i] * reg[i];
    let best = -Infinity;
    let bestO = DELTA;
    for (let o = 0; o <= 2 * DELTA; o++) {
      if (o > 0) {
        const add = reg[o + HS - 1];
        const sub = reg[o - 1];
        e += add * add - sub * sub;
      }
      let xc = 0;
      for (let i = 0; i < HS; i += 2) xc += reg[o + i] * ref[i];
      const score = xc / Math.sqrt(Math.max(e, 0) + 1e-9) - 1e-6 * Math.abs(o - DELTA);
      if (score > best) {
        best = score;
        bestO = o;
      }
    }
    return bestO;
  }

  _compact() {
    const drop = Math.floor(this._rpos) - 2;
    if (drop > 0) {
      this._qL.copyWithin(0, drop, this._fl);
      this._qR.copyWithin(0, drop, this._fl);
      this._fl -= drop;
      this._rpos -= drop;
    }
  }

  _makeFrame() {
    if (this.pos >= this.source.length) {
      this._ended = true;
      return;
    }
    if (this._fl + HS > CAP) this._compact();
    if (this._fl + HS > CAP) throw new RangeError('A fila de áudio encheu.');

    const t = this.tempo / this.ratio;
    const p = Math.round(this.pos);
    let start = p;
    if (this._prevStart !== null) start = p - DELTA + this._bestOffset(p);

    this.source.read(start, W, this._fL, this._fR);
    const { _accL: aL, _accR: aR, _fL: fL, _fR: fR } = this;
    for (let i = 0; i < W; i++) {
      aL[i] += fL[i] * HANN[i];
      aR[i] += fR[i] * HANN[i];
    }
    this._qL.set(aL.subarray(0, HS), this._fl);
    this._qR.set(aR.subarray(0, HS), this._fl);
    this._fl += HS;
    aL.copyWithin(0, HS);
    aL.fill(0, W - HS);
    aR.copyWithin(0, HS);
    aR.fill(0, W - HS);

    this._prevStart = start;
    this.pos += HS * t;
  }

  /**
   * Preenche outL/outR com n amostras. Devolve quantas são música de verdade
   * (menos que n só no fim da faixa; o resto vira silêncio).
   */
  process(outL, outR, n) {
    if (this.direct) {
      const avail = Math.max(0, Math.min(n, Math.floor(this.source.length - this.pos)));
      this.source.read(Math.floor(this.pos), n, outL, outR);
      for (let k = avail; k < n; k++) {
        outL[k] = 0;
        outR[k] = 0;
      }
      this.pos += avail;
      return avail;
    }

    const r = this.ratio;
    const { _qL: qL, _qR: qR } = this;
    let produced = 0;
    while (produced < n) {
      const i = Math.floor(this._rpos);
      while (this._fl < i + 3 && !this._ended) this._makeFrame();
      if (this._fl < i + 3) break;
      const f = this._rpos - i;
      outL[produced] = hermite(qL, i, f);
      outR[produced] = hermite(qR, i, f);
      this._rpos += r;
      produced++;
    }
    for (let k = produced; k < n; k++) {
      outL[k] = 0;
      outR[k] = 0;
    }
    this._compact();
    return produced;
  }
}

// Interpolação cúbica (Catmull-Rom) entre q[i] e q[i+1].
function hermite(q, i, f) {
  const y0 = q[i - 1];
  const y1 = q[i];
  const y2 = q[i + 1];
  const y3 = q[i + 2];
  const c1 = 0.5 * (y2 - y0);
  const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * f + c2) * f + c1) * f + y1;
}
