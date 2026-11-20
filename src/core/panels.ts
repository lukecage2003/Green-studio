/**
 * Découpe d'une planche de comic en cases, toutes formes (grilles, cases penchées, mises en page irrégulières), et cadrage du zoom.
 * Méthode (idées des détecteurs par contours, réécrites ici) :
 *  1. fond de page = couleur médiane du bord ;
 *  2. « dehors » = pixels de fond reliés au bord de la page (remplissage depuis le bord) : un ciel blanc ou une bulle À L'INTÉRIEUR
 *     d'une case n'est pas relié au bord, il reste dans la case ;
 *  3. ouverture morphologique (érosion puis dilatation) : coupe les ponts fins qui traversent une gouttière (queue de bulle, détail) ;
 *  4. composantes connexes = cases (boîte englobante + enveloppe convexe pour les cases penchées) ;
 *  5. une très grande zone sans gouttière est redécoupée par l'ancienne méthode (lignes de fond) ;
 *  6. ordre de lecture par rangées (gauche → droite, ou droite → gauche pour les mangas).
 * Fonctions pures.
 */
import type { ZoomTarget } from "./overlay.ts";

/** Case : rectangle englobant (fractions de la page) et contour réel (enveloppe convexe, fractions) pour les cases non rectangulaires. */
export interface Panel { x: number; y: number; w: number; h: number; poly?: [number, number][] }

export function detectPanels(px: Uint8ClampedArray, w: number, h: number, opt: { rtl?: boolean } = {}): Panel[] {
  const n = w * h;
  // 1. fond de page
  const edge: number[][] = [];
  for (let x = 0; x < w; x += 2) edge.push(rgb(px, w, x, 0), rgb(px, w, x, h - 1));
  for (let y = 0; y < h; y += 2) edge.push(rgb(px, w, 0, y), rgb(px, w, w - 1, y));
  const med = [0, 1, 2].map((c) => edge.map((e) => e[c]).sort((a, b) => a - b)[edge.length >> 1]);
  const bg = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const d = Math.abs(px[i * 4] - med[0]) + Math.abs(px[i * 4 + 1] - med[1]) + Math.abs(px[i * 4 + 2] - med[2]); bg[i] = d < 66 ? 1 : 0; }
  // 2. dehors : fond relié au bord
  const out = new Uint8Array(n), stack = new Int32Array(n); let sp = 0;
  const seed = (i: number) => { if (bg[i] && !out[i]) { out[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); } for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (sp) { const i = stack[--sp], x = i % w; if (x > 0) seed(i - 1); if (x < w - 1) seed(i + 1); if (i >= w) seed(i - w); if (i < n - w) seed(i + w); }
  let content = new Uint8Array(n); for (let i = 0; i < n; i++) content[i] = out[i] ? 0 : 1;
  // 3. ouverture : coupe les ponts plus fins que ~1,6 % de la largeur
  const r = Math.max(1, Math.round(w * 0.008));
  content = dilate(erode(content, w, h, r), w, h, r);
  // 4. composantes connexes ; une composante en « sablier » (deux cases reliées par une bulle qui déborde sur la gouttière) est coupée au col
  let lab = new Int32Array(n), comps: { x0: number; y0: number; x1: number; y1: number; area: number; pts: number[] }[] = [];
  for (let it = 0; it < 4; it++) {
    ({ lab, comps } = label(content, w, h, stack));
    let cut = false;
    for (const [id, c] of comps.entries()) if (c.area >= n * 0.02 && neck(content, lab, w, id, c)) cut = true;
    if (!cut) break;
  }
  const minA = n * 0.012;
  let panels: Panel[] = [];
  for (const c of comps) {
    if (c.area < minA) continue;
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    if (bw < w * 0.06 || bh < h * 0.04) continue; // filets, bulles hors case
    // 5. très grande zone : redécoupe sur les lignes de fond (cases sans contour séparées par de fines gouttières)
    if (c.area > n * 0.5) { const sub = xyCut(bg, w, h, c.x0, c.y0, c.x1 + 1, c.y1 + 1); if (sub.length > 1) { panels.push(...sub); continue; } }
    // rectangle si chaque coin de la boîte a un sommet tout près ; sinon le contour réel est gardé (case penchée, trapèze…)
    const simp = simplify(convexHull(c.pts), Math.max(2, w * 0.01)), tol = Math.hypot(bw, bh) * 0.035;
    const rectish = [[c.x0, c.y0], [c.x1, c.y0], [c.x1, c.y1], [c.x0, c.y1]].every(([cx, cy]) => simp.some(([x, y]) => Math.hypot(x - cx, y - cy) <= tol));
    panels.push({ x: c.x0 / w, y: c.y0 / h, w: bw / w, h: bh / h, ...(rectish ? {} : { poly: simp.map(([x, y]) => [+(x / w).toFixed(4), +(y / h).toFixed(4)] as [number, number]) }) });
  }
  // case incluse dans une autre (rare après l'ouverture) : on garde la grande
  panels = panels.filter((p, i) => !panels.some((q, j) => j !== i && q.w * q.h > p.w * p.h && p.x >= q.x - 0.005 && p.y >= q.y - 0.005 && p.x + p.w <= q.x + q.w + 0.005 && p.y + p.h <= q.y + q.h + 0.005));
  if (!panels.length) return [{ x: 0, y: 0, w: 1, h: 1 }];
  return readingOrder(panels, !!opt.rtl);
}

/** Étiquetage des composantes connexes (4-voisinage) : boîte, aire et pixels de bord de chacune. */
function label(content: Uint8Array, w: number, h: number, stack: Int32Array) {
  const n = w * h, lab = new Int32Array(n).fill(-1), comps: { x0: number; y0: number; x1: number; y1: number; area: number; pts: number[] }[] = [];
  for (let s = 0; s < n; s++) {
    if (!content[s] || lab[s] >= 0) continue;
    const c = { x0: w, y0: h, x1: 0, y1: 0, area: 0, pts: [] as number[] }, id = comps.length; comps.push(c); lab[s] = id; let sp = 0; stack[sp++] = s;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i / w) | 0; c.area++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      let border = false;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0 || !content[j]) { border = true; continue; } if (lab[j] < 0) { lab[j] = id; stack[sp++] = j; }
      }
      if (border) c.pts.push(x, y);
    }
  }
  return { lab, comps };
}
/** Col d'une composante (lignes ou colonnes où elle devient très étroite, avec de la matière de part et d'autre) : effacé ; renvoie vrai si coupé. */
function neck(content: Uint8Array, lab: Int32Array, w: number, id: number, c: { x0: number; y0: number; x1: number; y1: number }) {
  for (const vertical of [false, true]) {
    const a0 = vertical ? c.x0 : c.y0, a1 = vertical ? c.x1 : c.y1, b0 = vertical ? c.y0 : c.x0, b1 = vertical ? c.y1 : c.x1, cnt: number[] = [];
    for (let a = a0; a <= a1; a++) { let k = 0; for (let b = b0; b <= b1; b++) if (lab[vertical ? b * w + a : a * w + b] === id) k++; cnt.push(k); }
    const sorted = [...cnt].sort((x, y) => x - y), med = sorted[sorted.length >> 1], L = cnt.length;
    for (let i = Math.floor(L * 0.15); i < Math.ceil(L * 0.85); i++) {
      if (cnt[i] >= med * 0.45) continue;
      let j = i; while (j + 1 < L && cnt[j + 1] < med * 0.45) j++;
      const before = cnt.slice(0, i).filter((v) => v >= med * 0.7).length, after = cnt.slice(j + 1).filter((v) => v >= med * 0.7).length;
      if (before >= L * 0.12 && after >= L * 0.12) {
        for (let a = a0 + i; a <= a0 + j; a++) for (let b = b0; b <= b1; b++) { const k = vertical ? b * w + a : a * w + b; if (lab[k] === id) content[k] = 0; }
        return true;
      }
      i = j;
    }
  }
  return false;
}
/** Ordre de lecture : rangées (cases qui se recouvrent en hauteur), puis gauche → droite (ou droite → gauche). */
export function readingOrder(ps: Panel[], rtl = false): Panel[] {
  const rest = [...ps].sort((a, b) => a.y - b.y), out: Panel[] = [];
  while (rest.length) {
    const top = rest[0], row = rest.filter((p) => Math.min(p.y + p.h, top.y + top.h) - Math.max(p.y, top.y) > Math.min(p.h, top.h) * 0.5);
    row.sort((a, b) => (rtl ? b.x + b.w - (a.x + a.w) : a.x - b.x)); out.push(...row); for (const p of row) rest.splice(rest.indexOf(p), 1);
  }
  return out;
}

/** Ancienne méthode : découpe récursive sur les lignes et colonnes presque entièrement de fond. */
function xyCut(bg: Uint8Array, w: number, h: number, X0: number, Y0: number, X1: number, Y1: number): Panel[] {
  const out: Panel[] = [], minW = Math.max(6, Math.round(w * 0.08)), minH = Math.max(6, Math.round(h * 0.05));
  const bands = (x0: number, y0: number, x1: number, y1: number, vertical: boolean): [number, number][] => {
    const n = vertical ? x1 - x0 : y1 - y0, len = vertical ? y1 - y0 : x1 - x0, gut: boolean[] = [];
    for (let i = 0; i < n; i++) { let c = 0; for (let j = 0; j < len; j++) { const x = vertical ? x0 + i : x0 + j, y = vertical ? y0 + j : y0 + i; c += bg[y * w + x]; } gut.push(c >= len * 0.96); }
    const r: [number, number][] = []; let s = -1;
    for (let i = 0; i <= n; i++) { const g = i === n || gut[i]; if (!g && s < 0) s = i; if (g && s >= 0) { r.push([s, i]); s = -1; } }
    return r.filter(([a, b]) => b - a >= (vertical ? minW : minH));
  };
  const cut = (x0: number, y0: number, x1: number, y1: number, depth: number) => {
    for (const [a, b] of bands(x0, y0, x1, y1, false)) {
      const cols = bands(x0, y0 + a, x1, y0 + b, true);
      if (cols.length <= 1 || depth >= 3) { const [ca, cb] = cols[0] ?? [0, x1 - x0]; out.push({ x: (x0 + ca) / w, y: (y0 + a) / h, w: (cb - ca) / w, h: (b - a) / h }); }
      else for (const [ca, cb] of cols) cut(x0 + ca, y0 + a, x0 + cb, y0 + b, depth + 1);
    }
  };
  cut(X0, Y0, X1, Y1, 0);
  return out.filter((p) => p.w * p.h >= 0.012);
}

/** Érosion / dilatation binaires par un carré (2r + 1), en deux passes séparées (rapide). */
function erode(m: Uint8Array, w: number, h: number, r: number) { return morph(m, w, h, r, true); }
function dilate(m: Uint8Array, w: number, h: number, r: number) { return morph(m, w, h, r, false); }
function morph(m: Uint8Array, w: number, h: number, r: number, er: boolean) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), pre = new Int32Array(Math.max(w, h) + 1);
  const pass = (src: Uint8Array, dst: Uint8Array, len: number, lines: number, at: (line: number, k: number) => number) => {
    for (let l = 0; l < lines; l++) {
      for (let k = 0; k < len; k++) pre[k + 1] = pre[k] + src[at(l, k)];
      for (let k = 0; k < len; k++) { const a = Math.max(0, k - r), b = Math.min(len - 1, k + r), ones = pre[b + 1] - pre[a]; dst[at(l, k)] = er ? (ones === b - a + 1 ? 1 : 0) : ones > 0 ? 1 : 0; }
    }
  };
  pass(m, tmp, w, h, (y, x) => y * w + x); pass(tmp, out, h, w, (x, y) => y * w + x);
  return out;
}
/** Enveloppe convexe (chaîne monotone) de points [x0, y0, x1, y1, …]. */
function convexHull(flat: number[]): [number, number][] {
  const p: [number, number][] = []; for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]);
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p;
  const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
/** Simplification d'un contour fermé (Douglas–Peucker) : quelques sommets suffisent pour une case. */
function simplify(poly: [number, number][], eps: number): [number, number][] {
  if (poly.length <= 4) return poly;
  const dp = (pts: [number, number][]): [number, number][] => {
    if (pts.length < 3) return pts; const [a, b] = [pts[0], pts[pts.length - 1]]; let md = -1, mi = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1); if (d > md) { md = d; mi = i; } }
    return md > eps ? [...dp(pts.slice(0, mi + 1)).slice(0, -1), ...dp(pts.slice(mi))] : [a, b];
  };
  const far = poly.reduce((bi, q, i) => (Math.hypot(q[0] - poly[0][0], q[1] - poly[0][1]) > Math.hypot(poly[bi][0] - poly[0][0], poly[bi][1] - poly[0][1]) ? i : bi), 0);
  return [...dp(poly.slice(0, far + 1)).slice(0, -1), ...dp([...poly.slice(far), poly[0]]).slice(0, -1)];
}
function rgb(px: Uint8ClampedArray, w: number, x: number, y: number) { const i = (y * w + x) * 4; return [px[i], px[i + 1], px[i + 2]]; }

/** Cadrage (pour zoomRect) qui montre toute la case dans un cadre de rapport boxAspect (largeur / hauteur), avec une petite marge. */
export function panelTarget(p: Panel, imgW: number, imgH: number, boxAspect: number, margin = 0.92): ZoomTarget {
  let cw = imgW, ch = imgH; if (imgW / imgH > boxAspect) cw = imgH * boxAspect; else ch = imgW / boxAspect; // recadrage de base (remplissage)
  const z = Math.max(1, Math.min(cw / (p.w * imgW), ch / (p.h * imgH)) * margin);
  return { z: +z.toFixed(3), x: +(p.x + p.w / 2).toFixed(4), y: +(p.y + p.h / 2).toFixed(4) };
}
/** Case qui contient le point (fractions de la page), sinon la plus proche ; le contour réel départage les cases penchées. */
export function panelAt(panels: Panel[], x: number, y: number): number {
  let best = -1, bd = Infinity;
  panels.forEach((p, i) => {
    const inPoly = p.poly ? pointIn(p.poly, x, y) : null;
    const dx = Math.max(p.x - x, 0, x - (p.x + p.w)), dy = Math.max(p.y - y, 0, y - (p.y + p.h)), d = inPoly === true ? -1 : inPoly === false && dx === 0 && dy === 0 ? 1e-4 : dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
function pointIn(poly: [number, number][], x: number, y: number) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
/** Cadrage qui montre toute la page dans le cadre (vue d'ensemble, sans rien rogner). */
export function pageTarget(imgW: number, imgH: number, boxAspect: number): ZoomTarget {
  let cw = imgW, ch = imgH; if (imgW / imgH > boxAspect) cw = imgH * boxAspect; else ch = imgW / boxAspect;
  return { z: +Math.min(1, cw / imgW, ch / imgH).toFixed(4), x: 0.5, y: 0.5 };
}
