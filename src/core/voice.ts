/** Voix studio : coupe-bas 80 Hz → suppression du bruit (RNNoise, réseau de neurones, sur l'appareil) → égaliseur de voix
 *  (moins de « boue » à 300 Hz, plus de présence à 3,2 kHz) → compresseur doux. Traitement en flux, échantillon k en sortie
 *  = échantillon k en entrée (aucun décalage avec l'image). RNNoise travaille à 48 kHz ; à un autre débit, il est sauté. */

/** Filtre biquadratique (formules RBJ). */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0; private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  static highpass(sr: number, f: number, q = 0.707) { const b = new Biquad(), w = 2 * Math.PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    b.set((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0); return b; }
  static peak(sr: number, f: number, db: number, q = 1) { const b = new Biquad(), A = Math.pow(10, db / 40), w = 2 * Math.PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al / A;
    b.set((1 + al * A) / a0, -2 * c / a0, (1 - al * A) / a0, -2 * c / a0, (1 - al / A) / a0); return b; }
  private set(b0: number, b1: number, b2: number, a1: number, a2: number) { this.b0 = b0; this.b1 = b1; this.b2 = b2; this.a1 = a1; this.a2 = a2; }
  run(x: Float32Array) {
    for (let i = 0; i < x.length; i++) { const v = x[i], y = this.b0 * v + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = v; this.y2 = this.y1; this.y1 = y; x[i] = y; }
  }
}

/** Compresseur RMS doux : seuil −22 dBFS, rapport 3:1, attaque 10 ms, relâche 150 ms, gain de compensation ; expandeur sous −50 dBFS. */
export class Compressor {
  private env = 0; private ka: number; private kr: number; private th: number; private ratio: number; private makeup: number;
  constructor(sr: number, th = -22, ratio = 3, makeup = 4) { this.th = th; this.ratio = ratio; this.makeup = makeup; this.ka = Math.exp(-1 / (sr * 0.01)); this.kr = Math.exp(-1 / (sr * 0.15)); }
  run(x: Float32Array) {
    const mk = Math.pow(10, this.makeup / 20);
    for (let i = 0; i < x.length; i++) {
      const p = x[i] * x[i], k = p > this.env ? this.ka : this.kr; this.env = k * this.env + (1 - k) * p;
      const db = 10 * Math.log10(this.env + 1e-12), over = db - this.th;
      // au-dessus du seuil : compression ; très en dessous (−50 dBFS : bruit de fond entre les phrases) : expansion 1:2,
      // pour que le gain de compensation ne fasse pas remonter le bruit dans les pauses
      const g = over > 0 ? Math.pow(10, (-over * (1 - 1 / this.ratio)) / 20) : db < -50 ? Math.pow(10, Math.max(-24, db + 50) / 20) : 1;
      x[i] *= g * mk;
    }
  }
}

const energy = (f: Float32Array) => { let e = 0; for (let i = 0; i < f.length; i++) e += f[i] * f[i]; return e / f.length; };

export interface Denoiser { frameSize: number; processFrame(f: Float32Array): number }
let rnP: Promise<{ createDenoiseState(): Denoiser; frameSize: number } | null> | null = null;
/** RNNoise chargé à la demande (≈ 5 Mo, inclus dans l'app, hors ligne). */
export function loadDenoiser() {
  return (rnP ??= import("@shiguredo/rnnoise-wasm").then((m) => m.Rnnoise.load() as any).catch((e) => { console.warn("RNNoise indisponible", e); return null; }));
}

export class StudioVoice {
  private hp: Biquad; private mud: Biquad; private pres: Biquad; private comp: Compressor;
  private dn: Denoiser | null; private fs: number; private inBuf: Float32Array; private inN = 0; private outQ: Float32Array[] = [];
  readonly sr: number; private strength: number;
  /** strength : part du signal débruité (1 = totalement, 0,9 conseillé : garde un peu de naturel). */
  constructor(sr: number, rn: { createDenoiseState(): Denoiser; frameSize: number } | null, strength = 0.9) {
    this.sr = sr; this.strength = strength; this.hp = Biquad.highpass(sr, 80); this.mud = Biquad.peak(sr, 300, -2, 1); this.pres = Biquad.peak(sr, 3200, 2.5, 1);
    this.comp = new Compressor(sr);
    this.dn = rn && sr === 48000 ? rn.createDenoiseState() : null; this.fs = this.dn ? rn!.frameSize : 480; this.inBuf = new Float32Array(this.fs);
  }
  get denoising() { return !!this.dn; }
  // gain automatique : rend à la voix traitée le même niveau qu'à l'entrée (mesuré seulement pendant la parole)
  private eIn = 0; private eOut = 0; private ag = 1;
  private frame(f: Float32Array) {
    this.hp.run(f);
    const ein = energy(f); let speech = ein > 1e-4; // repli sans RNNoise : trame assez forte (≈ −40 dBFS)
    if (this.dn) {
      const dry = f.slice(), s = f; for (let i = 0; i < s.length; i++) s[i] *= 32768;
      speech = this.dn.processFrame(s) > 0.6; // RNNoise estime aussi la probabilité de parole
      for (let i = 0; i < s.length; i++) s[i] = (s[i] / 32768) * this.strength + dry[i] * (1 - this.strength);
    }
    this.mud.run(f); this.pres.run(f); this.comp.run(f);
    if (speech) { this.eIn = this.eIn * 0.97 + ein * 0.03; this.eOut = this.eOut * 0.97 + energy(f) * 0.03;
      const gt = Math.min(4, Math.max(0.5, Math.sqrt(this.eIn / Math.max(1e-12, this.eOut)))); this.ag += (gt - this.ag) * 0.08; }
    for (let i = 0; i < f.length; i++) f[i] *= this.ag;
    this.outQ.push(f);
  }
  /** Entrée mono (n'importe quelle longueur) → sortie disponible (multiple de la taille de trame). */
  process(x: Float32Array): Float32Array {
    let i = 0;
    while (i < x.length) { const n = Math.min(this.fs - this.inN, x.length - i); this.inBuf.set(x.subarray(i, i + n), this.inN); this.inN += n; i += n;
      if (this.inN === this.fs) { this.frame(this.inBuf.slice()); this.inN = 0; } }
    return this.drain();
  }
  /** Fin du flux : la dernière trame partielle est traitée (complétée de silence) et rendue à sa vraie longueur. */
  flush(): Float32Array {
    if (!this.inN) return this.drain();
    const n = this.inN, f = new Float32Array(this.fs); f.set(this.inBuf.subarray(0, n)); this.inN = 0; this.frame(f);
    const out = this.drain(); return out.subarray(0, out.length - (this.fs - n));
  }
  private drain() { const n = this.outQ.reduce((s, f) => s + f.length, 0), o = new Float32Array(n); let k = 0; for (const f of this.outQ) { o.set(f, k); k += f.length; } this.outQ = []; return o; }
}
