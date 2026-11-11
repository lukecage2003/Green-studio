/** Dérush : la vidéo vue comme une suite de clips (parties gardées, découpées aux points de scission) séparés par des coupes.
 *  Fonctions pures, testées ; l'interface (src/ui/derush.ts) les dessine et les manipule. Temps = temps source (s). */
import { normalize, kept, type Range, type Word } from "./timeline.ts";

export interface Clip extends Range { index: number }
const MIN = 0.05; // durée minimale d'un clip ou d'une coupe

/** Parties gardées, découpées aux points de scission. */
export function clipsOf(duration: number, cuts: Range[], splits: number[]): Clip[] {
  const out: Clip[] = []; const sp = [...splits].sort((a, b) => a - b);
  for (const k of kept(duration, cuts)) {
    let a = k.start;
    for (const s of sp) if (s > a + MIN && s < k.end - MIN) { out.push({ start: a, end: s, index: out.length }); a = s; }
    out.push({ start: a, end: k.end, index: out.length });
  }
  return out;
}

/** Point de scission propre : si t tombe dans un mot, il est déplacé dans le blanc le plus proche (≤ tol s). */
export function snapSplit(t: number, words: Word[] | null, tol = 0.25): number {
  if (!words?.length) return t;
  const w = words.find((x) => t > x.start && t < x.end); if (!w) return t;
  const i = words.indexOf(w), before = i > 0 ? (words[i - 1].end + w.start) / 2 : w.start - 0.02, after = i + 1 < words.length ? (w.end + words[i + 1].start) / 2 : w.end + 0.02;
  const best = t - before <= after - t ? before : after;
  return Math.abs(best - t) <= tol ? best : t;
}

/** Ce qui se trouve au temps t : un clip gardé, une coupe, ou rien. */
export function hitAt(t: number, clips: Clip[], cuts: Range[]): { kind: "clip"; clip: Clip } | { kind: "cut"; cut: Range } | null {
  const c = clips.find((x) => t >= x.start && t < x.end); if (c) return { kind: "clip", clip: c };
  const k = cuts.find((x) => t >= x.start && t < x.end); return k ? { kind: "cut", cut: k } : null;
}

/**
 * Déplace un bord de clip (rogner / rallonger). Bord gauche vers la droite = on coupe le début ; vers la gauche = on récupère
 * ce qui avait été coupé juste avant. Jamais au-delà du clip voisin gardé, ni sous la durée minimale. Renvoie les nouvelles coupes.
 */
export function trimEdge(duration: number, cuts: Range[], clip: Range, side: "start" | "end", t: number): Range[] {
  const next = cuts.map((c) => ({ ...c }));
  if (side === "start") {
    const li = next.findIndex((c) => Math.abs(c.end - clip.start) < 1e-3), lo = li >= 0 ? next[li].start : clip.start;
    const a = Math.max(lo, Math.min(clip.end - MIN, t));
    if (a > clip.start) next.push({ start: clip.start, end: a });
    else if (a < clip.start && li >= 0) next[li].end = a;
  } else {
    const ri = next.findIndex((c) => Math.abs(c.start - clip.end) < 1e-3), hi = ri >= 0 ? next[ri].end : clip.end;
    const b = Math.min(hi, Math.max(clip.start + MIN, t));
    if (b < clip.end) next.push({ start: b, end: clip.end });
    else if (b > clip.end && ri >= 0) next[ri].start = b;
  }
  return normalize(next.filter((c) => c.end - c.start >= MIN / 2), duration);
}

/** Pic par colonne (0–1) entre t0 et t1, calculé directement sur le son (zoom fin) ; échantillonnage clairsemé pour rester rapide. */
export function wavePeaks(pcm: Float32Array, rate: number, t0: number, t1: number, cols: number): Float32Array {
  const out = new Float32Array(cols), spc = ((t1 - t0) * rate) / cols;
  for (let x = 0; x < cols; x++) {
    const a = Math.max(0, Math.floor((t0 * rate) + x * spc)), b = Math.min(pcm.length, Math.floor((t0 * rate) + (x + 1) * spc));
    const step = Math.max(1, Math.floor((b - a) / 48)); let m = 0;
    for (let i = a; i < b; i += step) { const v = Math.abs(pcm[i]); if (v > m) m = v; }
    out[x] = m;
  }
  return out;
}
