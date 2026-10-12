// Leitura e escrita de WAV de 16 bits (sem perda audível, sem bibliotecas).

export function encodeWav16(left, right, sampleRate = 44100) {
  const n = left.length;
  if (right.length !== n) throw new RangeError('Os dois canais precisam ter o mesmo tamanho.');
  const dataBytes = n * 4;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (off, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 2, true); // estéreo
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    v.setInt16(o, l < 0 ? Math.round(l * 0x8000) : Math.round(l * 0x7fff), true);
    v.setInt16(o + 2, r < 0 ? Math.round(r * 0x8000) : Math.round(r * 0x7fff), true);
    o += 4;
  }
  return buf;
}

export function decodeWav16(buffer) {
  const v = new DataView(buffer);
  const tag = (off) => String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
  if (buffer.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new RangeError('Este arquivo não é um WAV válido.');
  }
  let off = 12;
  let fmt = null;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= buffer.byteLength) {
    const id = tag(off);
    const size = v.getUint32(off + 4, true);
    if (id === 'fmt ') {
      fmt = {
        format: v.getUint16(off + 8, true),
        channels: v.getUint16(off + 10, true),
        sampleRate: v.getUint32(off + 12, true),
        bits: v.getUint16(off + 22, true),
      };
    } else if (id === 'data') {
      dataOff = off + 8;
      dataLen = Math.min(size, buffer.byteLength - dataOff);
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || dataOff < 0) throw new RangeError('Este arquivo não é um WAV válido.');
  if (fmt.format !== 1 || fmt.bits !== 16 || (fmt.channels !== 1 && fmt.channels !== 2)) {
    throw new RangeError('Só WAV de 16 bits, mono ou estéreo, é aceito.');
  }
  const frameBytes = 2 * fmt.channels;
  const n = Math.floor(dataLen / frameBytes);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = dataOff + i * frameBytes;
    const l = v.getInt16(p, true);
    left[i] = l < 0 ? l / 0x8000 : l / 0x7fff;
    right[i] = fmt.channels === 2 ? (v.getInt16(p + 2, true) < 0 ? v.getInt16(p + 2, true) / 0x8000 : v.getInt16(p + 2, true) / 0x7fff) : left[i];
  }
  return { sampleRate: fmt.sampleRate, left, right };
}
