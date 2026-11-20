/** Habillage sonore généré (aucun fichier, aucun droit) : whoosh, « pop » discret, impact grave. Mixé à l'export. */
export type SfxKind = "whoosh" | "pop" | "impact";
const cache = new Map<string, Float32Array>();
/** Son mono au taux d'échantillonnage sr, crête normalisée (whoosh −18 dB, pop −20 dB, impact −11 dB). */
export function synth(kind: SfxKind, sr: number): Float32Array {
  const key = kind + sr; const c = cache.get(key); if (c) return c;
  const d = kind === "whoosh" ? 0.42 : kind === "pop" ? 0.16 : 0.9, n = Math.round(d * sr), y = new Float32Array(n);
  let seed = 22222; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296) * 2 - 1;
  let lp = 0, lp2 = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (kind === "whoosh") { const e = Math.sin((Math.PI * t) / d) ** 2, a = 0.015 + 0.2 * e; lp += a * (rnd() - lp); lp2 += a * 0.6 * (lp - lp2); y[i] = (lp - lp2 * 0.5) * e; }
    else if (kind === "pop") { const f = 520 + 700 * Math.exp(-t * 25); ph += (2 * Math.PI * f) / sr; y[i] = Math.sin(ph) * Math.exp(-t * 28) + rnd() * Math.exp(-t * 500) * 0.25; }
    else { const f = 38 + 70 * Math.exp(-t * 7); ph += (2 * Math.PI * f) / sr; lp += 0.08 * (rnd() - lp); y[i] = Math.sin(ph) * Math.exp(-t * 3.4) + lp * Math.exp(-t * 14) * 0.9; }
  }
  // fondu de sortie (pas de clic) et normalisation
  const fo = Math.min(n, Math.round(0.02 * sr)); for (let i = 0; i < fo; i++) y[n - 1 - i] *= i / fo;
  let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v)); const lvl = kind === "whoosh" ? 0.125 : kind === "pop" ? 0.1 : 0.28;
  if (pk > 0) for (let i = 0; i < n; i++) y[i] *= lvl / pk;
  cache.set(key, y); return y;
}
/** Ajoute les sons qui tombent dans le bloc [t0, t0 + n / sr) (temps de la vidéo finale) à chaque canal. */
export function mixSfx(chs: Float32Array[], sr: number, t0: number, ev: { t: number; k: SfxKind }[]) {
  if (!ev.length || !chs.length) return; const n = chs[0].length, t1 = t0 + n / sr;
  for (const e of ev) {
    const buf = synth(e.k, sr); if (e.t + buf.length / sr <= t0 || e.t >= t1) continue;
    const a = Math.max(0, Math.round((e.t - t0) * sr)), j0 = Math.max(0, Math.round((t0 - e.t) * sr));
    for (let i = a, j = j0; i < n && j < buf.length; i++, j++) for (const c of chs) c[i] += buf[j];
  }
}
