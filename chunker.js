// Corta a música em janelas com sobreposição, passa cada janela pelo modelo e junta o resultado.
// Não conhece o modelo: recebe uma função `model`. Assim dá para testar aqui com um modelo falso.
//
// Para gastar pouca memória no celular, o resultado NÃO guarda todas as faixas do modelo.
// O chamador diz quais "alvos" quer, juntando faixas do modelo. Exemplo para o HT-Demucs
// (ordem: bateria, baixo, outros, voz):
//   { voz: [3], instrumental: [0, 1, 2] }          -> 2 alvos, 4 canais de saída
//   { voz: [3], bateria: [0], baixo: [1], outros: [2] }

export const SEGMENT = 343980; // 7,8 s a 44,1 kHz: tamanho fixo que o HT-Demucs aceita

/**
 * Planeja as janelas. Cada janela tem `start` e `valid` (quantas amostras são música de verdade;
 * o resto da janela é preenchido com zeros).
 */
export function planWindows(total, segment = SEGMENT, overlap = 0.25) {
  if (!Number.isInteger(total) || total <= 0) return { windows: [], overlapSamples: 0, hop: segment };
  const overlapSamples = Math.max(0, Math.min(Math.floor(segment * overlap), segment - 1));
  const hop = segment - overlapSamples;
  const windows = [];
  for (let start = 0; ; start += hop) {
    windows.push({ start, valid: Math.min(segment, total - start) });
    if (start + segment >= total) break;
  }
  return { windows, overlapSamples, hop };
}

// Peso de cada amostra da janela: 1 no meio e uma descida suave nas bordas que se sobrepõem.
// A primeira janela não desce no começo e a última não desce no fim, para não perder as pontas.
function windowWeights(index, count, segment, overlapSamples, valid) {
  const w = new Float32Array(valid).fill(1);
  const isFirst = index === 0;
  const isLast = index === count - 1;
  if (overlapSamples > 0) {
    if (!isFirst) {
      for (let k = 0; k < overlapSamples && k < valid; k++) {
        w[k] = Math.min(w[k], 0.5 - 0.5 * Math.cos((Math.PI * (k + 0.5)) / overlapSamples));
      }
    }
    if (!isLast) {
      for (let j = 0; j < overlapSamples; j++) {
        const k = segment - overlapSamples + j;
        if (k < valid) w[k] = Math.min(w[k], 0.5 + 0.5 * Math.cos((Math.PI * (j + 0.5)) / overlapSamples));
      }
    }
  }
  return w;
}

/**
 * @param {object}   opts
 * @param {Float32Array} opts.left       canal esquerdo, a 44,1 kHz
 * @param {Float32Array} [opts.right]    canal direito (se faltar, a música é mono e vira estéreo)
 * @param {(chunk: Float32Array[]) => Promise<Float32Array[][]>} opts.model
 *        recebe [esquerdo, direito], cada um com `segment` amostras; devolve stems[faixa][canal],
 *        cada um com `segment` amostras. O modelo não deve guardar os arrays recebidos (são reaproveitados).
 * @param {Record<string, number[]>} opts.targets  nome do alvo -> índices das faixas do modelo a somar
 * @param {number}  [opts.overlap=0.25]  fração de sobreposição entre janelas (0 a 0,9)
 * @param {number}  [opts.segment=SEGMENT]
 * @param {(fraction: number) => void} [opts.onProgress]  chamado de 0 a 1 depois de cada janela
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Record<string, Float32Array[]>>} alvo -> [esquerdo, direito]
 */
export async function separate({
  left,
  right,
  model,
  targets,
  overlap = 0.25,
  segment = SEGMENT,
  onProgress,
  signal,
}) {
  if (!left || !(left.length > 0)) throw new RangeError('A música está vazia.');
  const total = left.length;
  const r = right ?? left;
  if (r.length !== total) throw new RangeError('Os dois canais precisam ter o mesmo tamanho.');
  if (typeof model !== 'function') throw new TypeError('Falta o modelo.');
  const names = Object.keys(targets ?? {});
  if (names.length === 0) throw new RangeError('Escolha pelo menos um alvo.');
  if (!(overlap >= 0 && overlap <= 0.9)) throw new RangeError('A sobreposição deve ficar entre 0 e 0,9.');
  const needed = Math.max(...names.flatMap((n) => targets[n])) + 1;

  const out = {};
  for (const n of names) out[n] = [new Float32Array(total), new Float32Array(total)];
  const weightSum = new Float32Array(total);

  const { windows, overlapSamples } = planWindows(total, segment, overlap);
  const inL = new Float32Array(segment);
  const inR = new Float32Array(segment);

  for (let i = 0; i < windows.length; i++) {
    if (signal?.aborted) throw new DOMException('Separação cancelada.', 'AbortError');
    const { start, valid } = windows[i];

    inL.fill(0);
    inR.fill(0);
    inL.set(left.subarray(start, start + valid));
    inR.set(r.subarray(start, start + valid));

    const stems = await model([inL, inR]);
    if (!Array.isArray(stems) || stems.length < needed) {
      throw new RangeError(`O modelo devolveu ${stems?.length ?? 0} faixas; eram necessárias ${needed}.`);
    }

    const w = windowWeights(i, windows.length, segment, overlapSamples, valid);
    for (const n of names) {
      for (const idx of targets[n]) {
        const st = stems[idx];
        if (!st || st.length < 2 || st[0].length < valid || st[1].length < valid) {
          throw new RangeError(`A faixa ${idx} do modelo veio com tamanho errado.`);
        }
        for (let ch = 0; ch < 2; ch++) {
          const dst = out[n][ch];
          const src = st[ch];
          for (let k = 0; k < valid; k++) dst[start + k] += src[k] * w[k];
        }
      }
    }
    for (let k = 0; k < valid; k++) weightSum[start + k] += w[k];

    onProgress?.((i + 1) / windows.length);
  }

  for (const n of names) {
    for (let ch = 0; ch < 2; ch++) {
      const dst = out[n][ch];
      for (let k = 0; k < total; k++) if (weightSum[k] > 0) dst[k] /= weightSum[k];
    }
  }
  return out;
}
