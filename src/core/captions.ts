/** Sous-titres animés : regroupement des mots en lignes courtes (style réseaux sociaux) et dessin sur canvas.
 *  Les temps sont ceux de la vidéo source : le même code sert à l'aperçu (lecteur) et à l'export (images source). */
import type { Range, Word } from "./timeline.ts";

export type CaptionPreset = "none" | "karaoke" | "box" | "word" | "simple";
export interface CaptionStyle { preset: CaptionPreset; pos: number; upper: boolean; color: string }
export const CAPTION_DEFAULT: CaptionStyle = { preset: "karaoke", pos: 0.72, upper: false, color: "#34e08b" };
export const PRESETS: Record<CaptionPreset, string> = { none: "Aucun", karaoke: "Karaoké", word: "Mot par mot", box: "Encadré", simple: "Simple" };

export interface CapLine { start: number; end: number; words: Word[] }

/** Segment traduit (temps de début/fin seulement) → mots horodatés : chaque mot reçoit une part du segment proportionnelle à sa longueur. */
export function spreadSegment(text: string, start: number, end: number): Word[] {
  const ws = text.trim().split(/\s+/).filter(Boolean); if (!ws.length || !(end > start)) return [];
  const tot = ws.reduce((a, w) => a + w.length + 1, 0); let t = start; const k = (end - start) / tot;
  return ws.map((w) => { const d = (w.length + 1) * k, o = { text: w, start: t, end: t + d * 0.92 }; t += d; return o; });
}

/** Lignes de ≤ maxWords mots / maxChars caractères ; nouvelle ligne après une pause ou une fin de phrase. Les mots coupés sont exclus. */
export function buildCaptions(words: Word[], cuts: Range[], o: { maxWords?: number; maxChars?: number; maxGap?: number; hold?: number } = {}): CapLine[] {
  const { maxWords = 4, maxChars = 22, maxGap = 0.6, hold = 0.5 } = o;
  const isCut = (w: Word) => { const m = (w.start + w.end) / 2; return cuts.some((c) => m >= c.start && m < c.end); };
  const lines: CapLine[] = []; let cur: Word[] = [], chars = 0;
  const flush = () => { if (cur.length) lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur }); cur = []; chars = 0; };
  let prev: Word | null = null;
  for (const w of words) {
    if (isCut(w) || !w.text.trim()) continue;
    const len = w.text.length + (cur.length ? 1 : 0);
    if (cur.length && (cur.length >= maxWords || chars + len > maxChars || (prev && w.start - prev.end > maxGap) || /[.!?…]$/.test(prev!.text))) flush();
    cur.push(w); chars += len; prev = w;
  }
  flush();
  for (let i = 0; i < lines.length; i++) lines[i].end = Math.min(lines[i].end + hold, lines[i + 1]?.start ?? Infinity);
  return lines;
}

/** Ligne affichée à l'instant t (recherche dichotomique). */
export function lineAt(lines: CapLine[], t: number): CapLine | null {
  let lo = 0, hi = lines.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (lines[m].end <= t) lo = m + 1; else if (lines[m].start > t) hi = m - 1; else return lines[m]; }
  return null;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Dessine la ligne active dans le rectangle (x, y, W, H) de l'image. */
export function drawCaption(ctx: Ctx, x: number, y: number, W: number, H: number, line: CapLine | null, t: number, st: CaptionStyle) {
  if (!line || st.preset === "none") return;
  const txt = (s: string) => (st.upper ? s.toUpperCase() : s);
  let k = line.words.findIndex((w) => t >= w.start && t < w.end);
  if (k < 0) { k = -1; for (let i = 0; i < line.words.length; i++) if (line.words[i].start <= t) k = i; } // entre deux mots : le dernier prononcé
  ctx.save(); ctx.textBaseline = "middle"; ctx.lineJoin = "round"; ctx.miterLimit = 2;
  const cy = y + H * st.pos;

  if (st.preset === "word") { // un mot à la fois, gros, qui « pop »
    const w = line.words[Math.max(0, k)], fs = W * 0.11, age = Math.max(0, t - w.start), sc = 1 + 0.18 * Math.max(0, 1 - age / 0.12);
    ctx.font = `900 ${fs}px ${FONT}`; ctx.textAlign = "center"; ctx.translate(x + W / 2, cy); ctx.scale(sc, sc);
    ctx.lineWidth = fs * 0.2; ctx.strokeStyle = "#000"; ctx.strokeText(txt(w.text), 0, 0); ctx.fillStyle = st.color; ctx.fillText(txt(w.text), 0, 0);
    ctx.restore(); return;
  }
  const fs = W * (st.preset === "karaoke" ? 0.072 : 0.06);
  ctx.font = `${st.preset === "simple" ? 700 : 850} ${fs}px ${FONT}`; ctx.textAlign = "left";
  const words = line.words.map((w) => txt(w.text)), ws = words.map((s) => ctx.measureText(s).width);
  const sp = Math.max(ctx.measureText(" ").width, fs * 0.34); // écart sûr malgré le contour et le grossissement du mot actif
  // une ou deux rangées selon la largeur disponible
  const rows: number[][] = []; const maxW = W * 0.88; let row: number[] = [], rw = 0;
  ws.forEach((w, i) => { const add = (row.length ? sp : 0) + w; if (row.length && rw + add > maxW) { rows.push(row); row = []; rw = 0; } row.push(i); rw += (row.length > 1 ? sp : 0) + w; });
  if (row.length) rows.push(row);
  const lh = fs * 1.25, top = cy - ((rows.length - 1) * lh) / 2;
  rows.forEach((r, ri) => {
    const width = r.reduce((s, i, j) => s + ws[i] + (j ? sp : 0), 0), ry = top + ri * lh; let cx = x + (W - width) / 2;
    if (st.preset === "box") { const pad = fs * 0.35; ctx.fillStyle = "rgba(0,0,0,.72)"; ctx.beginPath(); (ctx as any).roundRect(cx - pad, ry - lh / 2, width + 2 * pad, lh, fs * 0.25); ctx.fill(); }
    for (const i of r) {
      const active = i === k && st.preset !== "simple";
      ctx.save();
      if (active && st.preset === "karaoke") { const age = Math.max(0, t - line.words[i].start), sc = 1 + 0.1 * Math.min(1, age / 0.08); ctx.translate(cx + ws[i] / 2, ry); ctx.scale(sc, sc); ctx.translate(-(cx + ws[i] / 2), -ry); }
      if (st.preset === "simple") { ctx.shadowColor = "rgba(0,0,0,.85)"; ctx.shadowBlur = fs * 0.25; }
      else if (st.preset === "karaoke") { ctx.lineWidth = fs * 0.18; ctx.strokeStyle = "#000"; ctx.strokeText(words[i], cx, ry); }
      ctx.fillStyle = active ? (st.preset === "box" ? "#ffd23f" : st.color) : "#fff"; ctx.fillText(words[i], cx, ry);
      ctx.restore(); cx += ws[i] + sp;
    }
  });
  ctx.restore();
}
