// In-place iterative radix-2 Cooley-Tukey FFT for power-of-two sizes.
// Used by the chromagram (8192) and onset detector (1024). Mirrors the
// magnitude spectrum produced by `rustfft` in the native PantherPlay engine.

export class FFT {
  readonly size: number;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private readonly reversed: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this.size = size;

    this.cosTable = new Float32Array(size / 2);
    this.sinTable = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      const angle = (-2 * Math.PI * i) / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }

    const bits = Math.log2(size);
    this.reversed = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let rev = 0;
      let x = i;
      for (let b = 0; b < bits; b++) {
        rev = (rev << 1) | (x & 1);
        x >>= 1;
      }
      this.reversed[i] = rev;
    }
  }

  /// In-place forward transform of the complex arrays `re` and `im`.
  transform(re: Float32Array, im: Float32Array): void {
    const n = this.size;

    for (let i = 0; i < n; i++) {
      const j = this.reversed[i];
      if (j > i) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        let k = 0;
        for (let j = i; j < i + half; j++) {
          const cos = this.cosTable[k];
          const sin = this.sinTable[k];
          const re2 = re[j + half];
          const im2 = im[j + half];
          const tr = re2 * cos - im2 * sin;
          const ti = re2 * sin + im2 * cos;
          re[j + half] = re[j] - tr;
          im[j + half] = im[j] - ti;
          re[j] += tr;
          im[j] += ti;
          k += step;
        }
      }
    }
  }
}
