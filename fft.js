// FFT complexa de raiz 2, no lugar. Sem bibliotecas.
export class FFT {
  constructor(n) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new RangeError('O tamanho da FFT precisa ser potência de 2.');
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    let bits = 0;
    while (1 << bits < n) bits++;
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  forward(re, im) {
    this._run(re, im, -1);
  }

  inverse(re, im) {
    this._run(re, im, 1);
    const s = 1 / this.n;
    for (let i = 0; i < this.n; i++) {
      re[i] *= s;
      im[i] *= s;
    }
  }

  _run(re, im, dir) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const wr = this.cos[t];
          const wi = dir * this.sin[t];
          const a = start + k;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}
