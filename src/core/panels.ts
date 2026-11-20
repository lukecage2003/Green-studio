/** Découpe d'une planche de comic en cases (gouttières claires ou sombres) et cadrage du zoom sur une case. Fonctions pures. */
import type { ZoomTarget } from "./overlay.ts";

export interface Panel { x: number; y: number; w: number; h: number } // fractions de la page

/**
 * Cases d'une planche (image RVBA w × h, idéalement réduite à ~400 px) : découpe récursive « XY-cut » sur les gouttières,
 * c'est-à-dire les lignes et colonnes presque entièrement de la couleur du fond de page (blanc, noir ou papier).
 * Renvoie les cases dans l'ordre de lecture (haut → bas, gauche → droite). Une image sans gouttière = une seule case.
 */
export function detectPanels(px: Uint8ClampedArray, w: number, h: number): Panel[] {
  // couleur du fond : médiane des pixels du bord
  const edge: number[][] = [];
  for (let x = 0; x < w; x += 2) { edge.push(rgb(px, w, x, 0), rgb(px, w, x, h - 1)); }
  for (let y = 0; y < h; y += 2) { edge.push(rgb(px, w, 0, y), rgb(px, w, w - 1, y)); }
  const med = [0, 1, 2].map((c) => edge.map((e) => e[c]).sort((a, b) => a - b)[edge.length >> 1]);
  const bg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const d = Math.abs(px[i * 4] - med[0]) + Math.abs(px[i * 4 + 1] - med[1]) + Math.abs(px[i * 4 + 2] - med[2]); bg[i] = d < 60 ? 1 : 0; }
  const out: Panel[] = [];
  const minW = Math.max(6, Math.round(w * 0.08)), minH = Math.max(6, Math.round(h * 0.05));
  /** Bandes de contenu le long d'un axe dans le rectangle (gouttière = ligne à ≥ 96 % fond). */
  const bands = (x0: number, y0: number, x1: number, y1: number, vertical: boolean): [number, number][] => {
    const n = vertical ? x1 - x0 : y1 - y0, len = vertical ? y1 - y0 : x1 - x0, gut: boolean[] = [];
    for (let i = 0; i < n; i++) { let c = 0; for (let j = 0; j < len; j++) { const x = vertical ? x0 + i : x0 + j, y = vertical ? y0 + j : y0 + i; c += bg[y * w + x]; } gut.push(c >= len * 0.96); }
    const r: [number, number][] = []; let s = -1;
    for (let i = 0; i <= n; i++) { const g = i === n || gut[i]; if (!g && s < 0) s = i; if (g && s >= 0) { r.push([s, i]); s = -1; } }
    return r.filter(([a, b]) => b - a >= (vertical ? minW : minH));
  };
  const cut = (x0: number, y0: number, x1: number, y1: number, depth: number) => {
    const rows = bands(x0, y0, x1, y1, false);
    if (!rows.length) return;
    for (const [a, b] of rows) {
      const cols = bands(x0, y0 + a, x1, y0 + b, true);
      if (cols.length <= 1 || depth >= 3) {
        const [ca, cb] = cols[0] ?? [0, x1 - x0];
        // resserre la case sur son contenu
        const sub = depth < 3 && cols.length === 1 ? bands(x0 + ca, y0 + a, x0 + cb, y0 + b, false) : [];
        if (sub.length > 1) { cut(x0 + ca, y0 + a, x0 + cb, y0 + b, depth + 1); continue; }
        out.push({ x: (x0 + ca) / w, y: (y0 + a) / h, w: (cb - ca) / w, h: (b - a) / h });
      } else for (const [ca, cb] of cols) cut(x0 + ca, y0 + a, x0 + cb, y0 + b, depth + 1);
    }
  };
  cut(0, 0, w, h, 0);
  const big = out.filter((p) => p.w * p.h >= 0.015);
  if (!big.length) return [{ x: 0, y: 0, w: 1, h: 1 }];
  // ordre de lecture : par rangées (centres proches en hauteur), puis de gauche à droite
  big.sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5 ? a.x - b.x : a.y - b.y));
  return big;
}
function rgb(px: Uint8ClampedArray, w: number, x: number, y: number) { const i = (y * w + x) * 4; return [px[i], px[i + 1], px[i + 2]]; }

/** Cadrage (pour zoomRect) qui montre toute la case dans un cadre de rapport boxAspect (largeur / hauteur), avec une petite marge. */
export function panelTarget(p: Panel, imgW: number, imgH: number, boxAspect: number, margin = 0.92): ZoomTarget {
  let cw = imgW, ch = imgH; if (imgW / imgH > boxAspect) cw = imgH * boxAspect; else ch = imgW / boxAspect; // recadrage de base (remplissage)
  const z = Math.max(1, Math.min(cw / (p.w * imgW), ch / (p.h * imgH)) * margin);
  return { z: +z.toFixed(3), x: +(p.x + p.w / 2).toFixed(4), y: +(p.y + p.h / 2).toFixed(4) };
}
/** Case qui contient le point (fractions de la page), sinon la plus proche. */
export function panelAt(panels: Panel[], x: number, y: number): number {
  let best = -1, bd = Infinity;
  panels.forEach((p, i) => { const dx = Math.max(p.x - x, 0, x - (p.x + p.w)), dy = Math.max(p.y - y, 0, y - (p.y + p.h)), d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
  return best;
}
/** Cadrage qui montre toute la page dans le cadre (vue d'ensemble, sans rien rogner). */
export function pageTarget(imgW: number, imgH: number, boxAspect: number): ZoomTarget {
  let cw = imgW, ch = imgH; if (imgW / imgH > boxAspect) cw = imgH * boxAspect; else ch = imgW / boxAspect;
  return { z: +Math.min(1, cw / imgW, ch / imgH).toFixed(4), x: 0.5, y: 0.5 };
}
