/** Outils audio purs (sans DOM) : mixage mono, rééchantillonnage, forme d'onde, fondus. */

/** Mixe des canaux en mono. */
export function toMono(planes: Float32Array[]): Float32Array {
  if (planes.length === 1) return planes[0];
  const n = planes[0].length, out = new Float32Array(n), k = 1 / planes.length;
  for (const p of planes) for (let i = 0; i < n; i++) out[i] += p[i] * k;
  return out;
}

/**
 * Rééchantillonneur en flux (morceau par morceau) : moyenne sur la fenêtre de chaque échantillon de sortie
 * (filtre anti-repliement simple, suffisant pour la reconnaissance vocale).
 */
export class Resampler {
  private acc = 0; private cnt = 0; private pos = 0; // pos : position (en échantillons d'entrée) de la prochaine sortie
  private chunks: Float32Array[] = []; private len = 0;
  private readonly step: number; readonly outRate: number;
  constructor(inRate: number, outRate: number) { this.outRate = outRate; this.step = inRate / outRate; }
  push(x: Float32Array) {
    const out = new Float32Array(Math.ceil(x.length / this.step) + 2); let o = 0;
    for (let i = 0; i < x.length; i++) {
      this.acc += x[i]; this.cnt++; this.pos -= 1;
      if (this.pos <= 0) { out[o++] = this.acc / this.cnt; this.acc = 0; this.cnt = 0; this.pos += this.step; }
    }
    const r = out.subarray(0, o); this.chunks.push(r); this.len += o;
  }
  /** Ajoute du silence (trou dans le flux audio) pour garder l'alignement temporel. */
  pad(seconds: number) { const n = Math.round(seconds * this.outRate); if (n > 0) { this.chunks.push(new Float32Array(n)); this.len += n; } }
  get length() { return this.len; }
  result(): Float32Array {
    const out = new Float32Array(this.len); let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}

/** Crêtes (valeur absolue max) par tranche de `per` échantillons : forme d'onde légère pour la timeline. */
export function peaks(x: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(Math.max(1, buckets)), per = x.length / out.length;
  for (let b = 0; b < out.length; b++) {
    let m = 0; const e = Math.min(x.length, Math.floor((b + 1) * per));
    for (let i = Math.floor(b * per); i < e; i++) { const v = x[i] < 0 ? -x[i] : x[i]; if (v > m) m = v; }
    out[b] = m;
  }
  return out;
}

/** Gain d'un fondu entrée/sortie (courbe sinusoïdale) à t secondes du début d'un segment de longueur len. */
export function fadeGain(t: number, len: number, fade: number): number {
  if (fade <= 0) return 1;
  const f = Math.min(fade, len / 2), d = Math.min(t, len - t);
  if (d >= f) return 1; if (d <= 0) return 0;
  return Math.sin((d / f) * Math.PI / 2);
}

/**
 * Bornes de découpage pour la transcription par lots (≤ maxSec) : on coupe au moment le plus calme des `searchSec`
 * dernières secondes de chaque lot, pour ne jamais couper un mot en deux. Renvoie les indices [0, …, x.length].
 */
export function splitAtSilences(x: Float32Array, rate: number, maxSec = 28, searchSec = 6): number[] {
  const out = [0], max = Math.round(maxSec * rate), search = Math.round(searchSec * rate), fr = Math.max(1, Math.round(rate * 0.02));
  let s = 0;
  while (x.length - s > max) {
    let best = s + max, bestE = Infinity;
    for (let f = s + max - search; f + fr <= s + max; f += fr) {
      let e = 0; for (let i = f; i < f + fr; i++) e += x[i] * x[i];
      if (e < bestE) { bestE = e; best = f + (fr >> 1); }
    }
    out.push(best); s = best;
  }
  out.push(x.length); return out;
}

const db = (x: number) => 20 * Math.log10(Math.max(1e-9, x));

/**
 * Gain pour un volume homogène « réseaux sociaux » (≈ −14 LUFS) : RMS sur blocs de 400 ms avec double seuil
 * (absolu −50 dBFS, puis relatif −10 dB), à la manière de la norme BS.1770, mesuré sur les seules parties conservées.
 * Le gain est plafonné (+12 dB) pour ne pas faire remonter le bruit de fond.
 */
export function loudnessGain(x: Float32Array, rate: number, keep: { start: number; end: number }[] | null = null, targetDb = -16, maxGainDb = 12): number {
  const blk = Math.round(rate * 0.4), e: number[] = [];
  const ranges = keep ?? [{ start: 0, end: x.length / rate }];
  for (const r of ranges) for (let s = Math.round(r.start * rate); s + blk <= Math.min(x.length, Math.round(r.end * rate)); s += blk >> 1) {
    let a = 0; for (let i = s; i < s + blk; i++) a += x[i] * x[i]; e.push(a / blk);
  }
  const abs = e.filter((v) => db(Math.sqrt(v)) > -50); if (!abs.length) return 1;
  const mean = abs.reduce((s, v) => s + v, 0) / abs.length, rel = abs.filter((v) => v > mean / 10);
  const level = db(Math.sqrt(rel.reduce((s, v) => s + v, 0) / rel.length));
  return Math.pow(10, Math.min(maxGainDb, targetDb - level) / 20);
}

/** Limiteur doux : transparent sous 0,85, puis compression progressive vers 1 (jamais d'écrêtage dur). */
export const softLimit = (v: number) => { const a = v < 0 ? -v : v, t = 0.85; return a <= t ? v : Math.sign(v) * (t + (1 - t) * Math.tanh((a - t) / (1 - t))); };

/** Début et fin de la parole (trames de 20 ms au-dessus du seuil, relatif au niveau max), pour couper les bords muets. */
export function speechBounds(x: Float32Array, rate: number, relDb = -30): { start: number; end: number } | null {
  const fr = Math.max(1, Math.round(rate * 0.02)), lv: number[] = [];
  for (let s = 0; s + fr <= x.length; s += fr) { let a = 0; for (let i = s; i < s + fr; i++) a += x[i] * x[i]; lv.push(Math.sqrt(a / fr)); }
  const max = Math.max(0, ...lv); if (max < 1e-4) return null;
  const th = max * Math.pow(10, relDb / 20), first = lv.findIndex((v) => v > th); let last = lv.length - 1; while (last > 0 && lv[last] <= th) last--;
  return first < 0 ? null : { start: (first * fr) / rate, end: ((last + 1) * fr) / rate };
}
