/**
 * Détection des cases par IA, sur le téléphone : détecteur YOLO26-nano entraîné sur Manga109-s
 * (leoxs22/manga-panel-detector-yolo26n, export ONNX mednasserallah/manga-panel-detector-yolo26n-onnx, licence Apache-2.0 —
 * voir public/models/panels-yolo26n-LICENSE ; entraîné sur le jeu de données Manga109-s).
 * Combiné avec la détection par bordures (panels.ts) : l'IA trouve les cases, les bordures comblent les trous et découpent
 * les grands blocs incertains. Sans IA (chargement impossible), la détection par bordures seule prend le relais.
 */
import { detectPanels, detectByLines, readingOrder, type Panel } from "./panels.ts";

const MODEL = "/models/panels-yolo26n-1024.onnx", S = 1024;
let sessP: Promise<any> | null = null;
async function session() {
  sessP ??= (async () => {
    const ort: any = await import("onnxruntime-web");
    ort.env.wasm.numThreads = (globalThis as any).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    // moteur WebAssembly local (le même fichier que la transcription : rien de plus à télécharger, fonctionne hors connexion)
    ort.env.wasm.wasmPaths = { wasm: new URL("../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm", import.meta.url).href };
    for (const ep of [["webgpu"], ["wasm"]]) { try { return { ort, s: await ort.InferenceSession.create(MODEL, { executionProviders: ep }) }; } catch { /* moteur suivant */ } }
    throw new Error("détecteur de cases indisponible");
  })();
  return sessP;
}
/** Prépare le détecteur à l'avance (sans attendre). */
export const warmPanels = () => { session().catch(() => { sessP = null; }); };

export interface MLBox extends Panel { s: number }
/**
 * Cases vues par l'IA (fractions de la page) avec leur confiance : page entière, puis moitié haute et moitié basse agrandies
 * (les cases y paraissent plus grandes ; une case vue seulement là est ajoutée si elle ne contredit pas la page entière).
 */
export async function detectML(src: CanvasImageSource, w: number, h: number, conf = 0.08): Promise<MLBox[]> { return (await detectPage(src, w, h, conf)).panels; }
/** Cases et bulles d'une planche (IA seule). */
export async function detectPage(src: CanvasImageSource, w: number, h: number, conf = 0.08): Promise<{ panels: MLBox[]; texts: MLBox[] }> {
  const first = await runML2(src, 0, 0, w, h, conf), full = first.p, texts = first.t;
  const done = (panels: MLBox[]) => ({ panels, texts });
  if (h / w < 1.2) return done(full);
  const out = [...full];
  for (const [a, b] of [[0, 0.6], [0.4, 1]] as const) {
    for (const q of await runML(src, 0, a * h, w, (b - a) * h, conf)) {
      const box: MLBox = { x: q.x, y: a + q.y * (b - a), w: q.w, h: q.h * (b - a), s: q.s };
      const cutTop = a > 0 && box.y < a + 0.015, cutBot = b < 1 && box.y + box.h > b - 0.015; if (cutTop || cutBot) continue; // coupée par la découpe
      const over = out.filter((o) => inter(o, box) > Math.min(o.w * o.h, box.w * box.h) * 0.3);
      if (!over.length) { if (box.s >= 0.2) out.push(box); continue; }
      // précise un grand bloc peu sûr de la page entière
      const big = over.find((o) => o.s < 0.2 && inter(o, box) > box.w * box.h * 0.85 && o.w * o.h > box.w * box.h * 1.4);
      if (big && over.length === 1 && box.s > big.s) out.push(box);
    }
  }
  // un grand bloc peu sûr qui contient maintenant une case plus précise disparaît
  return done(out.filter((o) => !(o.s < 0.2 && out.some((p) => p !== o && p.s > o.s && inter(o, p) > p.w * p.h * 0.85 && o.w * o.h > p.w * p.h * 1.4))));
}
/** Une passe du modèle sur la zone (sx, sy, sw, sh) de l'image ; boîtes en fractions de cette zone. */
async function runML(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, conf: number): Promise<MLBox[]> { return (await runML2(src, sx, sy, sw, sh, conf)).p; }
/** Une passe : cases (classe 0) et bulles / cartouches de texte (classe 1). */
async function runML2(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, conf: number): Promise<{ p: MLBox[]; t: MLBox[] }> {
  const w = sw, h = sh; const { ort, s } = await session();
  const k = Math.min(S / w, S / h), nw = Math.round(w * k), nh = Math.round(h * k), px = Math.floor((S - nw) / 2), py = Math.floor((S - nh) / 2);
  const c = new OffscreenCanvas(S, S), g = c.getContext("2d")!; g.fillStyle = "rgb(114,114,114)"; g.fillRect(0, 0, S, S); g.drawImage(src, sx, sy, sw, sh, px, py, nw, nh);
  const d = g.getImageData(0, 0, S, S).data, t = new Float32Array(3 * S * S);
  for (let i = 0, o = 0; i < S * S; i++, o += 4) { t[i] = d[o] / 255; t[S * S + i] = d[o + 1] / 255; t[2 * S * S + i] = d[o + 2] / 255; }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", t, [1, 3, S, S]) }), r = out[s.outputNames[0]], [, N, C] = r.dims, v = r.data as Float32Array;
  const boxes: MLBox[] = [], texts: MLBox[] = [];
  for (let i = 0; i < N; i++) {
    const b = v.subarray(i * C, i * C + C); if (b[4] < conf || (b[5] !== 0 && b[5] !== 1)) continue;
    const x0 = Math.max(0, (b[0] - px) / nw), y0 = Math.max(0, (b[1] - py) / nh), x1 = Math.min(1, (b[2] - px) / nw), y1 = Math.min(1, (b[3] - py) / nh);
    if (b[5] === 1) { if (b[4] >= 0.25 && x1 - x0 > 0.015 && y1 - y0 > 0.008) texts.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, s: b[4] }); continue; }
    if (x1 - x0 > 0.05 && y1 - y0 > 0.03) boxes.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, s: b[4] });
  }
  // doublons (même case vue deux fois) : on garde la plus sûre
  const dedupe = (l: MLBox[]) => { l.sort((a, b) => b.s - a.s); return l.filter((b, i) => !l.slice(0, i).some((a) => iou(a, b) > 0.6)); };
  return { p: dedupe(boxes), t: dedupe(texts) };
}
export const iou = (a: Panel, b: Panel) => { const i = inter(a, b); return i / (a.w * a.h + b.w * b.h - i); };
const inter = (a: Panel, b: Panel) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Une « case » qui est en fait une bulle ou un cartouche de texte : recouverte à plus de 55 % par le texte repéré par l'IA,
 * ou petite et presque confondue avec une bulle.
 */
export function isBubble(p: Panel, texts: Panel[]): boolean {
  const cov = texts.reduce((t, b) => t + inter(p, b), 0) / (p.w * p.h);
  return cov > 0.55 || (p.w * p.h < 0.06 && texts.some((b) => iou(p, b) > 0.3));
}
/**
 * Fusion IA + bordures :
 *  - un bloc de l'IA peu sûr, ou rempli à 60 % par au moins deux cases nettes trouvées par les bordures, est remplacé par celles-ci ;
 *  - une case des bordures qui ne recouvre aucune case de l'IA est ajoutée (trou comblé) ;
 *  - les bulles et cartouches de texte ne sont jamais des cases ;
 *  - ordre de lecture à la fin.
 */
export function mergePanels(ml: MLBox[], lines: Panel[], rtl = false, texts: Panel[] = []): Panel[] {
  let out: Panel[] = [];
  lines = lines.filter((l) => !isBubble(l, texts)); ml = ml.filter((b) => !isBubble(b, texts));
  for (const b of ml) {
    const inside = lines.filter((l) => inter(l, b) > l.w * l.h * 0.85 && l.w * l.h < b.w * b.h * 0.8);
    const covered = inside.reduce((t, l) => t + l.w * l.h, 0) / (b.w * b.h);
    if (inside.length >= 2 && (b.s < 0.35 || covered >= 0.6)) out.push(...inside); else out.push(b); // plusieurs cases nettes qui remplissent le bloc : elles l'emportent
  }
  for (const l of lines) if (!out.some((o) => inter(o, l) > Math.min(o.w * o.h, l.w * l.h) * 0.25)) out.push(l);
  out = out.filter((p, i) => !out.slice(0, i).some((q) => iou(p, q) > 0.6)).map(({ x, y, w, h }) => ({ x, y, w, h }));
  return readingOrder(out, rtl);
}

/** Détection complète d'une planche : IA + bordures ; bordures seules si l'IA ne se charge pas. */
export async function detectPanelsSmart(src: CanvasImageSource, w: number, h: number, opt: { rtl?: boolean } = {}): Promise<Panel[]> { return (await detectPageSmart(src, w, h, opt)).panels; }
/** Cases (IA + bordures) et bulles de dialogue / cartouches (IA) d'une planche. */
export async function detectPageSmart(src: CanvasImageSource, w: number, h: number, opt: { rtl?: boolean } = {}): Promise<{ panels: Panel[]; bubbles: Panel[] }> {
  const k = Math.min(1, 600 / w), c = new OffscreenCanvas(Math.max(8, Math.round(w * k)), Math.max(8, Math.round(h * k))), g = c.getContext("2d")!; g.drawImage(src, 0, 0, c.width, c.height);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  try {
    const { panels: ml, texts } = await detectPage(src, w, h);
    const lines = detectByLines(px, c.width, c.height, { ext: 0.05, iso: false });
    const m = mergePanels(ml, lines, opt.rtl, texts), bubbles = texts.map(({ x, y, w: bw, h: bh }) => ({ x, y, w: bw, h: bh }));
    if (m.length) return { panels: m, bubbles };
  } catch (e) { console.warn("détection IA des cases", e); }
  return { panels: detectPanels(px, c.width, c.height, opt), bubbles: [] };
}
