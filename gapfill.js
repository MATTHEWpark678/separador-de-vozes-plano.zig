// Preenchimento de falhas curtas na voz, por interpolação autorregressiva (método de Janssen).
//
// O que ele conserta: cortes curtos em que o som some de repente (trechos de silêncio digital de
// poucos milissegundos, no meio de som normal). Ele prevê o que faltava a partir do som antes e
// depois do corte, usando um modelo linear da própria voz.
//
// O que ele NÃO conserta:
//  - falhas longas (por padrão, mais de 10 ms): o modelo perde a precisão e o resultado some;
//  - buracos "parciais" em que a voz só ficou mais fraca depois da separação;
//  - pausas naturais da música (silêncio com som baixo ou longo ao redor não é tocado).

const clampPos = (v) => (v < 0 ? 0 : v);

export function detectGaps(
  left,
  right,
  { sampleRate = 44100, minSamples = 4, maxMs = 10, quiet = 1e-4, contextMs = 10, contextRms = 0.003 } = {},
) {
  const n = left.length;
  const maxSamples = Math.floor((maxMs / 1000) * sampleRate);
  const ctx = Math.max(8, Math.floor((contextMs / 1000) * sampleRate));
  const gaps = [];
  const isQuiet = (i) => Math.abs(left[i]) <= quiet && Math.abs(right[i]) <= quiet;
  const rms = (a, b) => {
    let s = 0;
    for (let i = a; i < b; i++) s += 0.5 * (left[i] * left[i] + right[i] * right[i]);
    return Math.sqrt(s / Math.max(1, b - a));
  };
  let i = 0;
  while (i < n) {
    if (!isQuiet(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && isQuiet(j)) j++;
    const len = j - i;
    if (len >= minSamples && len <= maxSamples && i >= ctx && j + ctx <= n) {
      if (rms(i - ctx, i) > contextRms && rms(j, j + ctx) > contextRms) gaps.push({ start: i, end: j });
    }
    i = j;
  }
  return gaps;
}

function autocorr(seg, order) {
  const n = seg.length;
  const r = new Float64Array(order + 1);
  if (n === 0) return r;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = seg[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n));
  for (let k = 0; k <= order && k < n; k++) {
    let s = 0;
    for (let i = 0; i + k < n; i++) s += w[i] * w[i + k];
    r[k] = s;
  }
  return r;
}

// Levinson-Durbin: devolve c = [1, a1..ap] tal que o erro de previsão é e[t] = sum c[m] x[t-m]
function levinson(r, p) {
  const a = new Float64Array(p + 1);
  a[0] = 1;
  let e = r[0];
  if (!(e > 0)) return null;
  for (let i = 1; i <= p; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / e;
    const prev = a.slice();
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j];
    a[i] = k;
    e *= 1 - k * k;
    if (!(e > 0)) return null;
  }
  return a;
}

// Resolve B x = b com B simétrica positiva (Cholesky). Devolve null se B não for positiva.
function choleskySolve(B, b, L) {
  const C = new Float64Array(L * L);
  for (let i = 0; i < L; i++) {
    for (let j = 0; j <= i; j++) {
      let s = B[i * L + j];
      for (let k = 0; k < j; k++) s -= C[i * L + k] * C[j * L + k];
      if (i === j) {
        if (!(s > 1e-18)) return null;
        C[i * L + i] = Math.sqrt(s);
      } else {
        C[i * L + j] = s / C[j * L + j];
      }
    }
  }
  const y = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= C[i * L + k] * y[k];
    y[i] = s / C[i * L + i];
  }
  const x = new Float64Array(L);
  for (let i = L - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < L; k++) s -= C[k * L + i] * x[k];
    x[i] = s / C[i * L + i];
  }
  return x;
}

/** Preenche as falhas de um canal. Devolve { data, filled, skipped }. */
export function fillChannel(x, gaps, { order: fixedOrder, context: fixedContext } = {}) {
  const y = Float32Array.from(x);
  let filled = 0;
  let skipped = 0;
  const n = x.length;
  for (const { start, end } of gaps) {
    const L = end - start;
    // Quanto maior o corte, mais longe o modelo precisa "enxergar" (um período inteiro da voz).
    // Medido em sinal sintético parecido com voz: ordem ~60 para cortes curtos, ~200 para os de 7-10 ms.
    const order = fixedOrder ?? Math.min(200, Math.max(48, Math.round(0.6 * L)));
    const context = fixedContext ?? Math.min(3000, order * 15);
    const before = y.subarray(clampPos(start - context), start);
    const after = y.subarray(end, Math.min(n, end + context));
    if (L < 1 || before.length < 2 * order || after.length < 2 * order) {
      skipped++;
      continue;
    }
    const rb = autocorr(before, order);
    const ra = autocorr(after, order);
    const r = new Float64Array(order + 1);
    for (let k = 0; k <= order; k++) r[k] = rb[k] + ra[k];
    r[0] = r[0] * (1 + 1e-6) + 1e-12;
    const c = levinson(r, order);
    if (!c) {
      skipped++;
      continue;
    }
    const rho = new Float64Array(order + 1);
    for (let k = 0; k <= order; k++) {
      let s = 0;
      for (let m = 0; m + k <= order; m++) s += c[m] * c[m + k];
      rho[k] = s;
    }
    const B = new Float64Array(L * L);
    for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) B[i * L + j] = Math.abs(i - j) <= order ? rho[Math.abs(i - j)] : 0;
    const rhs = new Float64Array(L);
    for (let j = 0; j < L; j++) {
      let s = 0;
      const lo = Math.max(0, start + j - order);
      const hi = Math.min(n - 1, start + j + order);
      for (let i = lo; i <= hi; i++) {
        if (i >= start && i < end) continue;
        s += rho[Math.abs(i - (start + j))] * y[i];
      }
      rhs[j] = -s;
    }
    const sol = choleskySolve(B, rhs, L);
    if (!sol) {
      skipped++;
      continue;
    }
    let ok = true;
    for (let j = 0; j < L; j++) if (!Number.isFinite(sol[j])) ok = false;
    if (!ok) {
      skipped++;
      continue;
    }
    for (let j = 0; j < L; j++) y[start + j] = sol[j];
    filled++;
  }
  return { data: y, filled, skipped };
}

/** Detecta e preenche, nos dois canais. */
export function fillGaps(left, right, opts = {}) {
  const gaps = detectGaps(left, right, opts);
  const l = fillChannel(left, gaps, opts);
  const r = fillChannel(right, gaps, opts);
  return { left: l.data, right: r.data, found: gaps.length, filled: l.filled, skipped: l.skipped };
}
