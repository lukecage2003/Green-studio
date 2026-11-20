/** Habillage : images/extraits par-dessus la vidéo (plein écran, incrustation, « moi en petit ») et bandeaux titres.
 *  Le même dessin sert à l'aperçu (lecteur) et à l'export : ce que l'on voit est ce que l'on obtient. Temps = temps source. */

export type OverlayMode = "full" | "pip" | "me" | "compare";
/** Animation d'une image / d'un extrait : entrée (ressort), mouvement continu ou sortie. */
export type OverlayAnim = "none" | "slideL" | "slideR" | "slideUp" | "zoomIn" | "pop" | "spin" | "float" | "shake" | "panLR" | "panRL";
/** Zoom sur un détail : facteur z (1–4) vers le point (x, y) de l'image source (0–1). */
export interface ZoomTarget { z: number; x: number; y: number }
/** freeze : l'extrait vidéo se fige à cet instant (s depuis son début) ; zoom : on s'approche d'un détail (après le gel, sinon dès l'apparition). */
/** path : parcours de cases (page de comic) — la page entière, puis chaque case dans l'ordre. */
/** anim : animation ; with / labels : avant / après (2e image et étiquettes des deux côtés). */
export interface Overlay { id: string; kind: "image" | "video"; start: number; end: number; mode: OverlayMode; freeze?: number; zoom?: ZoomTarget; path?: ZoomTarget[]; anim?: OverlayAnim; with?: string; labels?: [string, string]; label?: string }
/** Arrêt sur image dans la vidéo principale : à l'instant `at` (temps source), l'image reste figée `dur` s, avec zoom éventuel. */
export interface Freeze { id: string; at: number; dur: number; zoom?: ZoomTarget }

/** Montée du zoom (0 → 1) en 0,7 s, adoucie. */
export const zoomEase = (dt: number, d = 0.7) => { const x = Math.min(1, Math.max(0, dt / d)); return x * x * (3 - 2 * x); };
/**
 * Partie de la source à afficher pour remplir un cadre dw×dh (recadrage centré), zoomée z× vers (fx, fy) à la progression k.
 * Le cadre reste toujours dans l'image : jamais de bord noir.
 */
export function zoomRect(srcW: number, srcH: number, dw: number, dh: number, zt: ZoomTarget | null | undefined, k = 1, extra = 1) {
  let cw = srcW, ch = srcH;
  if (srcW / srcH > dw / dh) cw = srcH * dw / dh; else ch = srcW * dh / dw;
  const z = (zt ? 1 + (Math.max(1, zt.z) - 1) * k : 1) * extra; cw /= z; ch /= z;
  const fx = zt ? 0.5 + (zt.x - 0.5) * k : 0.5, fy = zt ? 0.5 + (zt.y - 0.5) * k : 0.5;
  const cx = Math.min(srcW - cw / 2, Math.max(cw / 2, fx * srcW)), cy = Math.min(srcH - ch / 2, Math.max(ch / 2, fy * srcH));
  return { sx: cx - cw / 2, sy: cy - ch / 2, sw: cw, sh: ch };
}
/**
 * Parcours de cases à l'instant t : 0,8 s sur la page entière, puis chaque case reçoit le même temps — 0,6 s de glissement
 * depuis la précédente, puis on reste dessus. Renvoie le cadrage à appliquer (progression 1).
 */
export function pathAt(path: ZoomTarget[], start: number, end: number, t: number): ZoomTarget {
  const whole = { z: 1, x: 0.5, y: 0.5 }, n = path.length, T = Math.max(0.8, (end - start - 0.8) / n), dt = t - start - 0.8;
  if (!n || dt <= 0) return whole;
  const i = Math.min(n - 1, Math.floor(dt / T)), a = i ? path[i - 1] : whole, b = path[i], k = zoomEase(dt - i * T, 0.6);
  return { z: a.z + (b.z - a.z) * k, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}
/** Durée conseillée d'un parcours (≈ 2,2 s par case). */
export const pathDuration = (n: number) => 0.8 + n * 2.2;
/**
 * Ressort amorti (0 → 1 avec léger dépassement) : même idée que la fonction spring() de Remotion, écrite ici sans dépendance.
 * d = durée de mise en place ; bounce = ampleur du rebond.
 */
export function spring(t: number, d = 0.55, bounce = 0.35): number {
  if (t <= 0) return 0; if (t >= d * 1.6) return 1;
  const x = t / d; return 1 - Math.exp(-5.2 * x) * Math.cos(x * Math.PI * (1.4 + bounce * 2.2)) * (1 - bounce * 0.25);
}
export const ANIMS: [OverlayAnim, string][] = [["none", "Aucune"], ["slideL", "→ Glisse de gauche"], ["slideR", "← Glisse de droite"], ["slideUp", "↑ Monte"], ["zoomIn", "Zoom"], ["pop", "Pop"],
  ["spin", "Tourbillon"], ["float", "Flotte"], ["shake", "Tremble"], ["panLR", "Panoramique →"], ["panRL", "Panoramique ←"]];
/** Transformation de l'image à l'instant t : décalage (fraction de l'image), échelle, rotation (rad), opacité. */
export function animAt(ov: Overlay, t: number): { dx: number; dy: number; sc: number; rot: number; al: number } {
  const age = t - ov.start, left = ov.end - t, e = spring(age), ex = Math.min(1, Math.max(0, 1 - left / 0.35)), ee = ex * ex;
  const r = { dx: 0, dy: 0, sc: 1, rot: 0, al: 1 };
  switch (ov.anim) {
    case "slideL": r.dx = -(1 - e) + ee; break;
    case "slideR": r.dx = (1 - e) - ee; break;
    case "slideUp": r.dy = (1 - e) - ee; break;
    case "zoomIn": r.sc = 0.35 + 0.65 * e + 0.25 * ee; r.al = Math.min(1, age / 0.2) * (1 - ee); break;
    case "pop": r.sc = Math.max(0, spring(age, 0.45, 0.8)) * (1 - 0.6 * ee); r.rot = (1 - Math.min(1, age / 0.45)) * -0.15; r.al = 1 - ee; break;
    case "spin": r.sc = e * (1 - ee) + 0.001; r.rot = (1 - e) * -2.4 + ee * 2.4; break;
    case "float": r.dy = Math.sin(age * 1.8) * 0.012; r.rot = Math.sin(age * 1.3) * 0.02; r.sc = 1.02; break;
    case "shake": { const k = Math.max(0, 1 - age / 0.6); r.dx = Math.sin(age * 55) * 0.025 * k; r.rot = Math.sin(age * 47) * 0.03 * k; break; }
  }
  return r;
}
/** Panoramique lent (cadrage qui se déplace dans l'image) pour panLR / panRL. */
const panAt = (ov: Overlay, t: number): ZoomTarget | null => {
  if (ov.anim !== "panLR" && ov.anim !== "panRL") return null;
  const k = Math.min(1, Math.max(0, (t - ov.start) / Math.max(0.5, ov.end - ov.start))), x = ov.anim === "panLR" ? 0.15 + 0.7 * k : 0.85 - 0.7 * k;
  return { z: 1.45, x, y: 0.5 };
};
/** Applique l'animation autour du rectangle (x, y, w, h) puis dessine. */
function withAnim(ctx: Ctx, ov: Overlay, t: number, x: number, y: number, w: number, h: number, draw: () => void) {
  if (!ov.anim || ov.anim === "none" || ov.anim === "panLR" || ov.anim === "panRL") { draw(); return; }
  const m = animAt(ov, t); ctx.save(); ctx.globalAlpha *= Math.max(0, Math.min(1, m.al));
  ctx.translate(x + w / 2 + m.dx * w, y + h / 2 + m.dy * h); ctx.rotate(m.rot); ctx.scale(Math.max(0.001, m.sc), Math.max(0.001, m.sc)); ctx.translate(-(x + w / 2), -(y + h / 2));
  draw(); ctx.restore();
}

/** Avant / après : deux images côte à côte ; le rideau part de la droite et s'arrête au milieu, étiquettes en haut. */
function drawCompare(ctx: Ctx, W: number, H: number, t: number, ov: Overlay, a: Src, b: Src | null, speaker: (x: number, y: number, w: number, h: number) => void) {
  const al = fadeIn(ov, t), p = 0.5 + 0.42 * (1 - zoomEase(t - ov.start, 1.1)), xs = W * p;
  if (al < 1) speaker(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = al;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, xs, H); ctx.clip(); drawCover(ctx, a, 0, 0, xs, H); ctx.restore();
  if (b) { ctx.save(); ctx.beginPath(); ctx.rect(xs, 0, W - xs, H); ctx.clip(); drawCover(ctx, b, xs, 0, W - xs, H); ctx.restore(); }
  ctx.fillStyle = "#fff"; ctx.fillRect(xs - W * 0.006, 0, W * 0.012, H);
  const rB = W * 0.075; ctx.beginPath(); ctx.arc(xs, H * 0.5, rB, 0, Math.PI * 2); ctx.fillStyle = "#111"; ctx.fill(); ctx.lineWidth = W * 0.008; ctx.strokeStyle = "#fff"; ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = `900 ${rB * 0.75}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("VS", xs, H * 0.5);
  const [la, lb] = ov.labels ?? ["AVANT", "APRÈS"], fs = W * 0.042; font(ctx, 700, fs, 0.06);
  const tag = (txt: string, cx: number, col: string) => { const tw = ctx.measureText(txt).width + fs * 2.2; const ty = H * (TIKTOK_SAFE.top + 0.02); glass(ctx, cx - tw / 2, ty, tw, fs * 1.6, fs * 0.8, W); ctx.beginPath(); ctx.arc(cx - tw / 2 + fs * 0.75, ty + fs * 0.8, fs * 0.2, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.fillStyle = "#fff"; ctx.fillText(txt, cx + fs * 0.2, ty + fs * 0.8); };
  if (la) tag(la.toUpperCase(), xs / 2, "rgba(232,32,42,.92)"); if (lb && b) tag(lb.toUpperCase(), xs + (W - xs) / 2, "rgba(10,132,255,.92)");
  ctx.restore();
}

/** Temps à lire dans un extrait vidéo : il avance, puis reste figé à partir de `freeze`. */
export const clipTime = (ov: Overlay, t: number) => Math.max(0, Math.min(t - ov.start, ov.freeze ?? Infinity));
/** Progression du zoom d'un extrait à l'instant t (le zoom démarre au gel, sinon 0,3 s après l'apparition). */
export const overlayZoomK = (ov: Overlay, t: number) => (ov.zoom ? zoomEase(t - ov.start - (ov.kind === "video" && ov.freeze != null ? ov.freeze : 0.3)) : 0);
/** kind : bandeau (bas gauche), chapitre (carton plein écran), bulle (citation façon comic). */
/** timeline : frise (sub = « 1962 Création ; 1984 Secret Wars ; … »). */
/** hook : texte d'accroche géant ; question : question finale ; rank : classement (sub = numéro) ;
 *  tag : repère (text = « 1984 » ou « Terre-616 », sub = libellé « ÉPOQUE » / « UNIVERS ») ; term : concept mis en avant (« Force Phénix »). */
export interface Title { id: string; text: string; sub?: string; start: number; end: number; kind?: "lower" | "chapter" | "timeline" | "hook" | "question" | "rank" | "tag" | "term" }
/**
 * Zones masquées par l'interface TikTok (fractions de l'image 9:16) : onglets en haut, boutons à droite, légende en bas.
 * Tout ce que l'application place (bandeaux, sous-titres, incrustations) reste en dehors.
 */
export const TIKTOK_SAFE = { top: 0.11, bottom: 0.2, right: 0.15, rightFrom: 0.42 };
/** Dessine les zones TikTok (aperçu seulement) : ce qui est sous ces zones sera caché par l'appli TikTok. */
export function drawSafeZones(ctx: Ctx, W: number, H: number) {
  const s = TIKTOK_SAFE; ctx.save(); ctx.fillStyle = "rgba(255,45,85,.22)"; ctx.strokeStyle = "rgba(255,45,85,.8)"; ctx.lineWidth = Math.max(1, W * 0.004); ctx.setLineDash([W * 0.015, W * 0.012]);
  const box = (x: number, y: number, w: number, h: number) => { ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); };
  box(0, 0, W, H * s.top); box(0, H * (1 - s.bottom), W, H * s.bottom); box(W * (1 - s.right), H * s.rightFrom, W * s.right, H * (1 - s.bottom - s.rightFrom));
  ctx.setLineDash([]); ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.font = `700 ${W * 0.032}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("Onglets TikTok", W / 2, H * s.top / 2); ctx.fillText("Légende · musique", W / 2, H * (1 - s.bottom / 2));
  ctx.save(); ctx.translate(W * (1 - s.right / 2), H * (s.rightFrom + (1 - s.bottom - s.rightFrom) / 2)); ctx.rotate(-Math.PI / 2); ctx.fillText("♥  💬  ↗", 0, 0); ctx.restore();
  ctx.restore();
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Src = CanvasImageSource & { width?: number; height?: number; videoWidth?: number; videoHeight?: number; displayWidth?: number; displayHeight?: number };
const FONT = "'Inter Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const activeAt = <T extends { start: number; end: number }>(list: T[], t: number): T | null => {
  let best: T | null = null; for (const o of list) if (t >= o.start && t < o.end && (!best || o.start >= best.start)) best = o; return best;
};
const size = (s: Src) => ({ w: s.displayWidth ?? s.videoWidth ?? s.width ?? 1, h: s.displayHeight ?? s.videoHeight ?? s.height ?? 1 });
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** Opacité d'apparition / disparition (0,2 s). */
export const fadeIn = (o: { start: number; end: number }, t: number, d = 0.2) => ease(Math.min((t - o.start) / d, (o.end - t) / d, 1));

function rounded(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); (ctx as any).roundRect ? (ctx as any).roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}
/** Dessine src en remplissant (x, y, w, h) — recadrage centré — avec un zoom lent (« Ken Burns ») de 1 à 1,08, ou un zoom sur un détail. */
export function drawCover(ctx: Ctx, src: Src, x: number, y: number, w: number, h: number, kb = 0, zt?: ZoomTarget | null, zk = 0) {
  const s = size(src), r = zoomRect(s.w, s.h, w, h, zt, zk, zt && zk > 0 ? 1 : 1 + 0.08 * kb);
  const d = (src as any).draw; // VideoSample (export) : méthode draw de mediabunny ; sinon drawImage
  if (typeof d === "function" && !(src as any).getContext) d.call(src, ctx, r.sx, r.sy, r.sw, r.sh, x, y, w, h);
  else ctx.drawImage(src, r.sx, r.sy, r.sw, r.sh, x, y, w, h);
}

/**
 * Compose une image : `speaker(x, y, w, h)` dessine la personne (l'image filmée) dans le rectangle donné.
 * full : extrait plein écran ; pip : extrait dans une carte en haut, la personne reste visible ; me : extrait plein écran
 * et la personne en petit dans un coin.
 */
export function compose(ctx: Ctx, W: number, H: number, t: number, ov: Overlay | null, src: Src | null, speaker: (x: number, y: number, w: number, h: number) => void, src2: Src | null = null) {
  if (!ov || !src) { speaker(0, 0, W, H); return; }
  if (ov.mode === "compare") { drawCompare(ctx, W, H, t, ov, src, src2, speaker); return; }
  const pz = ov.path?.length ? pathAt(ov.path, ov.start, ov.end, t) : panAt(ov, t);
  const a = fadeIn(ov, t), kb = ov.freeze != null && t - ov.start >= ov.freeze ? Math.min(1, ov.freeze / Math.max(0.1, ov.end - ov.start)) : Math.min(1, Math.max(0, (t - ov.start) / Math.max(0.1, ov.end - ov.start))), zk = overlayZoomK(ov, t);
  if (ov.mode === "pip") {
    speaker(0, 0, W, H);
    const w = W * 0.88, h = Math.min(H * 0.42, w * 0.75), x = (W - w) / 2, y = H * (TIKTOK_SAFE.top + 0.02) + (1 - a) * H * 0.03, r = W * 0.05;
    ctx.save(); ctx.globalAlpha = a; ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = W * 0.05; ctx.shadowOffsetY = W * 0.015;
    withAnim(ctx, ov, t, x, y, w, h, () => {
      ctx.save(); rounded(ctx, x, y, w, h, r); ctx.fillStyle = "#000"; ctx.fill(); ctx.shadowColor = "transparent";
      rounded(ctx, x, y, w, h, r); ctx.clip(); drawCover(ctx, src, x, y, w, h, pz ? 0 : kb, pz ?? ov.zoom, pz ? 1 : zk); ctx.restore();
      ctx.save(); ctx.globalAlpha *= 0.6; rounded(ctx, x, y, w, h, r); ctx.lineWidth = Math.max(1, W * 0.002); ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.stroke(); ctx.restore();
    });
    ctx.restore();
    return;
  }
  // full / me : l'extrait remplit l'image (fondu depuis la personne)
  const moving = !!ov.anim && ov.anim !== "none" && ov.anim !== "panLR" && ov.anim !== "panRL";
  if (a < 1 || moving) speaker(0, 0, W, H); // l'image bouge : la personne reste visible derrière
  ctx.save(); ctx.globalAlpha = a; withAnim(ctx, ov, t, 0, 0, W, H, () => { if (moving) { ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = W * 0.04; } drawCover(ctx, src, 0, 0, W, H, pz ? 0 : kb, pz ?? ov.zoom, pz ? 1 : zk); }); ctx.restore();
  if (ov.mode === "me") {
    const w = W * 0.36, h = w * 16 / 9, x = W * 0.05, y = H * (1 - TIKTOK_SAFE.bottom) - h - H * 0.02, r = W * 0.06;
    ctx.save(); ctx.globalAlpha = a; ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = W * 0.05;
    rounded(ctx, x, y, w, h, r); ctx.fillStyle = "#000"; ctx.fill(); ctx.shadowColor = "transparent";
    rounded(ctx, x, y, w, h, r); ctx.clip(); speaker(x, y, w, h); ctx.restore();
    ctx.save(); ctx.globalAlpha = a; rounded(ctx, x, y, w, h, r); ctx.lineWidth = Math.max(2, W * 0.004); ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.stroke(); ctx.restore();
  }
}

/* ---------- Système visuel « pro » : verre dépoli, typographie Inter, mouvements sur ressort ---------- */
/** Découpe un texte en lignes qui tiennent dans maxW (police déjà réglée). */
function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const out: string[] = []; let line = "";
  for (const w of text.split(/\s+/)) { const tryL = line ? line + " " + w : w; if (line && ctx.measureText(tryL).width > maxW) { out.push(line); line = w; } else line = tryL; }
  if (line) out.push(line); return out;
}
/** Verre dépoli réel (flou de l'image derrière) : seulement là où le canvas contient la vidéo (export). L'aperçu, posé sur le lecteur, utilise un verre teinté. */
let glassBlur = false;
export const setGlassBlur = (on: boolean) => { glassBlur = on; };
const font = (ctx: Ctx, w: number, px: number, ls = -0.02) => { ctx.font = `${w} ${px}px ${FONT}`; try { (ctx as any).letterSpacing = `${(px * ls).toFixed(2)}px`; } catch { /* */ } };
/** Plaque de verre : ombre douce, flou de l'arrière-plan, teinte, liseré lumineux en haut. */
function glass(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, W: number, tint = "rgba(30,30,34,.5)") {
  // ombre seule (la forme est dessinée hors champ, seule son ombre tombe ici)
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.32)"; ctx.shadowBlur = W * 0.06; ctx.shadowOffsetY = W * 0.014; ctx.shadowOffsetX = 1e4;
  rounded(ctx, x - 1e4, y, w, h, r); ctx.fillStyle = "#000"; ctx.fill(); ctx.restore();
  ctx.save(); rounded(ctx, x, y, w, h, r); ctx.clip();
  if (glassBlur) {
    const m = ctx.getTransform(), pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f]);
    const pad = W * 0.06, bx = Math.max(0, Math.min(...pts.map((p) => p[0])) - pad), by = Math.max(0, Math.min(...pts.map((p) => p[1])) - pad);
    const cw = (ctx.canvas as any).width, ch = (ctx.canvas as any).height, bw = Math.min(cw, Math.max(...pts.map((p) => p[0])) + pad) - bx, bh = Math.min(ch, Math.max(...pts.map((p) => p[1])) + pad) - by;
    if (bw > 2 && bh > 2) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = `blur(${Math.max(4, Math.round(W * 0.03))}px) saturate(1.5)`; ctx.drawImage(ctx.canvas as any, bx, by, bw, bh, bx, by, bw, bh); ctx.filter = "none"; ctx.setTransform(m); }
    ctx.fillStyle = tint;
  } else ctx.fillStyle = "rgba(28,28,32,.78)";
  ctx.fillRect(x, y, w, h);
  const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, "rgba(255,255,255,.16)"); g.addColorStop(0.45, "rgba(255,255,255,0)"); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.save(); rounded(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); const s = ctx.createLinearGradient(0, y, 0, y + h); s.addColorStop(0, "rgba(255,255,255,.42)"); s.addColorStop(0.5, "rgba(255,255,255,.1)"); s.addColorStop(1, "rgba(255,255,255,.22)");
  ctx.lineWidth = Math.max(1, W * 0.0022); ctx.strokeStyle = s; ctx.stroke(); ctx.restore();
}
/** Texte blanc net avec ombre portée douce (pas de contour noir). */
function softText(ctx: Ctx, s: string, x: number, y: number, fs: number, color = "#fff", maxW?: number) {
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = fs * 0.45; ctx.shadowOffsetY = fs * 0.06; ctx.fillStyle = color;
  maxW ? ctx.fillText(s, x, y, maxW) : ctx.fillText(s, x, y); ctx.restore();
}
/** Mot « fort » d'un titre (mis en couleur) : chiffre, nom propre, sinon le dernier mot long. */
function keyWords(words: string[]): Set<number> {
  const k = new Set<number>(); words.forEach((w, i) => { if (/\d/.test(w) || (i > 0 && /^\p{Lu}\p{Ll}/u.test(w))) k.add(i); });
  if (!k.size) { let bi = words.length - 1; for (let i = words.length - 1; i >= 0; i--) if (words[i].replace(/\W/g, "").length >= 4) { bi = i; break; } k.add(bi); }
  return k;
}
/**
 * Titre « keynote » : mots qui montent un à un (ressort, 70 ms d'écart), blancs, mots forts en couleur, centrés en (0, 0).
 * Renvoie la hauteur occupée.
 */
function revealWords(ctx: Ctx, W: number, text: string, age: number, fs0: number, maxW: number, maxLines: number, accent: string, weight = 800, upper = false): number {
  let fs = fs0, lines: string[] = [];
  const T = upper ? text.toUpperCase() : text;
  for (;;) { font(ctx, weight, fs, -0.03); lines = wrap(ctx, T, maxW); if (lines.length <= maxLines || fs < W * 0.05) break; fs *= 0.92; }
  const all = T.split(/\s+/), key = keyWords(all), lh = fs * 1.1, top = -((lines.length - 1) * lh) / 2; let wi = 0;
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  lines.forEach((l, li) => {
    const ws = l.split(" "), sp = ctx.measureText(" ").width, widths = ws.map((w) => ctx.measureText(w).width), tw = widths.reduce((a, b) => a + b, 0) + sp * (ws.length - 1);
    let x = -tw / 2;
    ws.forEach((w, j) => {
      const k = spring(age - wi * 0.07, 0.42, 0.25), a = Math.min(1, Math.max(0, (age - wi * 0.07) / 0.18));
      if (a > 0) { ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, (1 - k) * fs * 0.55); softText(ctx, w, x, top + li * lh, fs, key.has(wi) ? accent : "#fff"); ctx.restore(); }
      x += widths[j] + sp; wi++;
    });
  });
  return lines.length * lh;
}
/** Bandeau (haut gauche, sous les onglets TikTok) : plaque de verre, pastille de couleur, titre et sous-titre. */
function drawLower(ctx: Ctx, W: number, H: number, t: number, ti: Title, accent: string) {
  const age = t - ti.start, e = spring(age, 0.5, 0.2), out = Math.min(1, Math.max(0, (ti.end - t) / 0.25)), fs = W * 0.048, sfs = W * 0.032, pad = W * 0.04;
  font(ctx, 700, fs); const tw = ctx.measureText(ti.text).width; font(ctx, 500, sfs, 0); const sw = ti.sub ? ctx.measureText(ti.sub).width : 0;
  const dot = fs * 0.36, w = Math.min(W * 0.86, Math.max(tw, sw) + pad * 2 + dot * 2.2), h = fs * 1.35 + (ti.sub ? sfs * 1.45 : 0) + pad * 0.7, x = W * 0.05, y = H * (TIKTOK_SAFE.top + 0.015);
  ctx.save(); ctx.globalAlpha = out * Math.min(1, age / 0.15); ctx.translate(0, (1 - e) * -H * 0.03);
  glass(ctx, x, y, w, h, Math.min(h / 2, W * 0.05), W);
  ctx.beginPath(); ctx.arc(x + pad + dot / 2, y + pad * 0.35 + fs * 0.68, dot / 2, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = dot; ctx.fill(); ctx.shadowBlur = 0;
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; font(ctx, 700, fs); ctx.fillStyle = "#fff"; ctx.fillText(ti.text, x + pad + dot * 2, y + pad * 0.35 + fs * 0.68, w - pad * 2 - dot * 2);
  if (ti.sub) { font(ctx, 500, sfs, 0); ctx.fillStyle = "rgba(235,235,245,.68)"; ctx.fillText(ti.sub, x + pad + dot * 2, y + pad * 0.35 + fs * 1.38 + sfs * 0.62, w - pad * 2 - dot * 2); }
  ctx.restore();
}
/** Carton de chapitre : image assombrie en dégradé, petit surtitre espacé en couleur, titre qui se révèle mot à mot, filet qui s'étire. */
function drawChapter(ctx: Ctx, W: number, H: number, t: number, ti: Title, accent: string) {
  const a = fadeIn(ti, t, 0.3), age = t - ti.start;
  ctx.save(); ctx.globalAlpha = a;
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(0,0,0,.45)"); g.addColorStop(0.5, "rgba(0,0,0,.7)"); g.addColorStop(1, "rgba(0,0,0,.45)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H * 0.46);
  const h = revealWords(ctx, W, ti.text, age - 0.1, W * 0.1, W * 0.84, 3, accent, 800);
  if (ti.sub) { ctx.textAlign = "center"; font(ctx, 700, W * 0.032, 0.22); ctx.fillStyle = accent; ctx.globalAlpha = a * Math.min(1, age / 0.3); ctx.fillText(ti.sub.toUpperCase(), 0, -h / 2 - W * 0.06); }
  const bw = W * 0.14 * spring(age - 0.25, 0.5, 0.1); ctx.globalAlpha = a; ctx.fillStyle = accent; rounded(ctx, -bw / 2, h / 2 + W * 0.04, bw, W * 0.008, W * 0.004); ctx.fill();
  ctx.restore();
}
/** Frise chronologique : panneau de verre, ligne qui se trace, points lumineux, dates en couleur (sub = « 1962 Création ; 1984 … »). */
function drawTimeline(ctx: Ctx, W: number, H: number, t: number, ti: Title, accent: string) {
  const a = fadeIn(ti, t, 0.3), ev = (ti.sub ?? "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 6), n = Math.max(1, ev.length);
  const dur = Math.max(1, (ti.end - ti.start) * 0.7), step = H * 0.105, x0 = W * 0.17, top = H * (TIKTOK_SAFE.top + 0.02), y0 = top + W * 0.2, y1 = y0 + (n - 1) * step, p = Math.min(1, (t - ti.start) / dur);
  ctx.save(); ctx.globalAlpha = a;
  glass(ctx, W * 0.05, top, W * 0.8, y1 - top + W * 0.14, W * 0.06, W);
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; font(ctx, 800, W * 0.056, -0.02); ctx.fillStyle = "#fff"; ctx.fillText(ti.text, W * 0.1, top + W * 0.09, W * 0.7);
  ctx.lineCap = "round"; ctx.lineWidth = W * 0.006; ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();
  ctx.strokeStyle = accent; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + (y1 - y0) * p); ctx.stroke();
  ev.forEach((e1, i) => {
    const at = n > 1 ? i / (n - 1) : 0, ra = Math.min(1, Math.max(0, (p - at) * n * 1.5 + 0.3)); if (ra <= 0) return;
    const y = y0 + (y1 - y0) * at, [d, ...rest] = e1.split(/\s+/), sc = spring(ra * 0.6, 0.35, 0.5);
    ctx.save(); ctx.globalAlpha = a * Math.min(1, ra * 1.5);
    ctx.beginPath(); ctx.arc(x0, y, W * 0.018 * sc, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = W * 0.03; ctx.fill(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(x0, y, W * 0.007 * sc, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.translate((1 - ra) * W * 0.04, 0);
    font(ctx, 800, W * 0.046, -0.01); ctx.fillStyle = accent; ctx.fillText(d, x0 + W * 0.05, y - W * 0.024);
    font(ctx, 600, W * 0.04, -0.01); ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillText(rest.join(" "), x0 + W * 0.05, y + W * 0.03, W * 0.6);
    ctx.restore();
  });
  ctx.restore();
}
/** Accroche des premières secondes : grand titre « keynote », mots qui montent un à un, mot fort en couleur. */
function drawHook(ctx: Ctx, W: number, H: number, t: number, ti: Title, accent: string) {
  const age = t - ti.start, out = Math.min(1, Math.max(0, (ti.end - t) / 0.22));
  ctx.save(); ctx.globalAlpha = out;
  const g = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, W * 0.75); g.addColorStop(0, "rgba(0,0,0,.42)"); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = out * Math.min(1, age / 0.2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.62); ctx.globalAlpha = out;
  ctx.translate(W / 2, H * 0.3); revealWords(ctx, W, ti.text, age, W * 0.105, W * 0.86, 3, accent, 900);
  ctx.restore();
}
/** Chevron animé (invitation à commenter). */
function chevron(ctx: Ctx, x: number, y: number, s: number, color: string) {
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = s * 0.22; ctx.strokeStyle = color;
  ctx.beginPath(); ctx.moveTo(x - s, y - s * 0.4); ctx.lineTo(x, y + s * 0.45); ctx.lineTo(x + s, y - s * 0.4); ctx.stroke(); ctx.restore();
}
/** Question de fin : plaque de verre centrée, petit libellé « À VOUS », la question, chevron qui invite aux commentaires. */
function drawQuestion(ctx: Ctx, W: number, H: number, t: number, ti: Title, accent: string) {
  const age = t - ti.start, sc = 0.9 + 0.1 * spring(age, 0.45, 0.35), a = fadeIn(ti, t, 0.2), fs = W * 0.06, pad = W * 0.06;
  font(ctx, 750, fs, -0.02); const lines = wrap(ctx, ti.text, W * 0.7), lh = fs * 1.22, bw = Math.min(W * 0.86, Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2), bh = lines.length * lh + pad * 1.6 + W * 0.04;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, H * 0.46); ctx.scale(sc, sc);
  glass(ctx, -bw / 2, -bh / 2, bw, bh, W * 0.06, W);
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; font(ctx, 700, W * 0.028, 0.2); ctx.fillStyle = accent; ctx.fillText("À VOUS", 0, -bh / 2 + pad * 0.75);
  font(ctx, 750, fs, -0.02); ctx.fillStyle = "#fff"; lines.forEach((l, i) => ctx.fillText(l, 0, -bh / 2 + pad * 0.75 + W * 0.045 + lh * 0.55 + i * lh));
  ctx.restore();
  ctx.save(); ctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(age * 5)); chevron(ctx, W / 2, H * 0.46 + bh / 2 * sc + W * 0.07 + Math.sin(age * 5) * W * 0.012, W * 0.035, "#fff"); ctx.restore();
}
/** Classement : plaque de verre sous les onglets, grand numéro en couleur, nom en blanc ; glisse depuis la gauche. */
function drawRank(ctx: Ctx, W: number, H: number, t: number, ti: Title, accent: string) {
  const age = t - ti.start, e = spring(age, 0.5, 0.2), out = Math.min(1, Math.max(0, (ti.end - t) / 0.25)), num = (ti.sub ?? "1").replace(/^#/, "");
  const nfs = W * 0.15, fs = W * 0.06, pad = W * 0.045; font(ctx, 800, nfs, -0.04); const nw = ctx.measureText(num).width; font(ctx, 750, fs, -0.02); const tw = Math.min(W * 0.5, ctx.measureText(ti.text).width);
  const h = nfs * 1.05 + pad * 0.6, w = pad * 2.4 + nw + W * 0.12 + tw, x = W * 0.05, y = H * (TIKTOK_SAFE.top + 0.015);
  ctx.save(); ctx.globalAlpha = out * Math.min(1, age / 0.12); ctx.translate(-(1 - e) * W * 0.25, 0);
  glass(ctx, x, y, w, h, W * 0.055, W);
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; font(ctx, 600, W * 0.032, 0.04); const nn = ctx.measureText("N°").width; ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fillText("N°", x + pad, y + h * 0.62);
  const nx = x + pad + nn + W * 0.012; font(ctx, 800, nfs, -0.04); ctx.fillStyle = accent; ctx.fillText(num, nx, y + h * 0.56);
  ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(nx + nw + W * 0.03, y + h * 0.22, Math.max(1, W * 0.003), h * 0.56);
  font(ctx, 750, fs, -0.02); ctx.fillStyle = "#fff"; ctx.fillText(ti.text, nx + nw + W * 0.06, y + h * 0.54, W * 0.5);
  ctx.restore();
}
/** Repère (époque, univers) : petite plaque de verre en haut à droite, libellé espacé et valeur en grand ; descend sur ressort. */
function drawTag(ctx: Ctx, W: number, H: number, t: number, ti: Title, accent: string) {
  const age = t - ti.start, e = spring(age, 0.45, 0.25), out = Math.min(1, Math.max(0, (ti.end - t) / 0.25)), lab = (ti.sub ?? "").toUpperCase(), fs = W * 0.062, lfs = W * 0.026, pad = W * 0.04;
  font(ctx, 800, fs, -0.02); const vw = ctx.measureText(ti.text).width; font(ctx, 700, lfs, 0.2); const lw = lab ? ctx.measureText(lab).width : 0;
  const w = Math.max(vw, lw) + pad * 2, h = fs * 1.15 + (lab ? lfs * 1.6 : 0) + pad * 0.6, x = W * 0.95 - w, y = H * (TIKTOK_SAFE.top + 0.015);
  ctx.save(); ctx.globalAlpha = out * Math.min(1, age / 0.15); ctx.translate(0, (1 - e) * -H * 0.04);
  glass(ctx, x, y, w, h, W * 0.045, W);
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  if (lab) { font(ctx, 700, lfs, 0.2); ctx.fillStyle = accent; ctx.fillText(lab, x + w - pad, y + pad * 0.45 + lfs * 0.7); }
  font(ctx, 800, fs, -0.02); ctx.fillStyle = "#fff"; ctx.fillText(ti.text, x + w - pad, y + h - pad * 0.3 - fs * 0.6);
  ctx.restore();
}
/** Concept mis en avant : libellé « CONCEPT », le terme en très grand (révélé mot à mot), filet de couleur qui s'étire. */
function drawTerm(ctx: Ctx, W: number, H: number, t: number, ti: Title, accent: string) {
  const age = t - ti.start, out = Math.min(1, Math.max(0, (ti.end - t) / 0.25));
  ctx.save(); ctx.globalAlpha = out;
  const g = ctx.createRadialGradient(W / 2, H * 0.34, 0, W / 2, H * 0.34, W * 0.7); g.addColorStop(0, "rgba(0,0,0,.4)"); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = out * Math.min(1, age / 0.2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.6); ctx.globalAlpha = out;
  ctx.translate(W / 2, H * 0.34);
  const h = revealWords(ctx, W, ti.text, age - 0.08, W * 0.12, W * 0.86, 2, "#fff", 900);
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; font(ctx, 700, W * 0.03, 0.24); ctx.fillStyle = accent; ctx.globalAlpha = out * Math.min(1, age / 0.25);
  ctx.fillText((ti.sub || "CONCEPT").toUpperCase(), 0, -h / 2 - W * 0.05);
  const bw = W * 0.2 * spring(age - 0.2, 0.5, 0.1); ctx.globalAlpha = out; ctx.fillStyle = accent; rounded(ctx, -bw / 2, h / 2 + W * 0.035, bw, W * 0.008, W * 0.004); ctx.fill();
  ctx.restore();
}
/** Nom affiché avec une image de la banque (« Venom ») : pastille de verre posée sous l'image. */
export function drawLabel(ctx: Ctx, W: number, H: number, t: number, ov: Overlay, accent = "#30d158") {
  if (!ov.label) return;
  const a = fadeIn(ov, t, 0.25), age = t - ov.start, e = spring(age - 0.15, 0.45, 0.25), fs = W * 0.05, pad = W * 0.04;
  font(ctx, 750, fs, -0.02); const w = ctx.measureText(ov.label).width + pad * 2 + fs * 0.8, h = fs * 1.7;
  let x = W * 0.05, y = H * (1 - TIKTOK_SAFE.bottom) - h - H * 0.02;
  if (ov.mode === "pip") { const pw = W * 0.88, ph = Math.min(H * 0.42, pw * 0.75); x = (W - pw) / 2 + W * 0.03; y = H * (TIKTOK_SAFE.top + 0.02) + ph - h - W * 0.03; }
  ctx.save(); ctx.globalAlpha = a * Math.min(1, Math.max(0, (age - 0.15) / 0.15)); ctx.translate((1 - e) * -W * 0.05, 0);
  glass(ctx, x, y, w, h, h / 2, W);
  ctx.beginPath(); ctx.arc(x + pad + fs * 0.15, y + h / 2, fs * 0.17, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
  ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.fillText(ov.label, x + pad + fs * 0.6, y + h / 2 + fs * 0.03);
  ctx.restore();
}
/** Barre de progression fine et arrondie en haut, avec un léger halo. */
export function drawProgress(ctx: Ctx, W: number, H: number, p: number, accent = "#30d158") {
  const h = Math.max(3, H * 0.0045), m = W * 0.02, y = H * 0.008, w = W - m * 2, q = Math.max(0, Math.min(1, p));
  ctx.save(); rounded(ctx, m, y, w, h, h / 2); ctx.fillStyle = "rgba(255,255,255,.22)"; ctx.fill();
  if (q > 0) { ctx.shadowColor = accent; ctx.shadowBlur = h * 3; rounded(ctx, m, y, Math.max(h, w * q), h, h / 2); ctx.fillStyle = accent; ctx.fill(); }
  ctx.restore();
}
export function drawTitle(ctx: Ctx, W: number, H: number, t: number, ti: Title | null, accent = "#30d158") {
  if (!ti || !ti.text.trim()) return;
  if (ti.kind === "hook") return drawHook(ctx, W, H, t, ti, accent);
  if (ti.kind === "question") return drawQuestion(ctx, W, H, t, ti, accent);
  if (ti.kind === "rank") return drawRank(ctx, W, H, t, ti, accent);
  if (ti.kind === "tag") return drawTag(ctx, W, H, t, ti, accent);
  if (ti.kind === "term") return drawTerm(ctx, W, H, t, ti, accent);
  if (ti.kind === "timeline") return drawTimeline(ctx, W, H, t, ti, accent);
  if (ti.kind === "chapter") return drawChapter(ctx, W, H, t, ti, accent);
  if (ti.kind && ti.kind !== "lower") return; // anciens types retirés (bulle, fiche)
  drawLower(ctx, W, H, t, ti, accent);
}

/* ---------- Annotations et onomatopées (temps source, coordonnées 0–1 de l'image) ---------- */
/** arrow : flèche de (x1, y1) vers (x2, y2) ; circle : cercle dans le rectangle ; sfx : onomatopée centrée en (x1, y1), taille x2. */
export interface Mark { id: string; type: "arrow" | "circle" | "sfx"; start: number; end: number; x1: number; y1: number; x2: number; y2: number; color?: string; text?: string }
export const SFX = ["BAM !", "POW !", "BOOM !", "WHAM !", "ZAP !", "CRAC !", "KRAKOOM !", "SNIKT !", "THWIP !", "BANG !", "SPLASH !", "WOW !"];
/** Mots dits qui appellent une onomatopée (transcription) → texte affiché. */
export const SFX_WORDS: Record<string, string> = { boum: "BOOM !", boom: "BOOM !", bam: "BAM !", pow: "POW !", paf: "PAF !", pif: "PIF !", bang: "BANG !", crac: "CRAC !", crack: "CRAC !", zap: "ZAP !", wham: "WHAM !", vlan: "VLAN !", splash: "SPLASH !", snikt: "SNIKT !", thwip: "THWIP !", kaboom: "KABOOM !", badaboum: "BADABOUM !", pan: "PAN !" };
export const activeMarks = (marks: Mark[], t: number) => marks.filter((m) => t >= m.start && t < m.end);

export function drawMark(ctx: Ctx, W: number, H: number, t: number, m: Mark) {
  const age = t - m.start, out = Math.min(1, Math.max(0, (m.end - t) / 0.15)), col = m.color ?? "#ffd60a";
  ctx.save(); ctx.globalAlpha = out; ctx.lineCap = "round"; ctx.lineJoin = "round";
  const X = (x: number) => x * W, Y = (y: number) => y * H, lw = W * 0.013;
  const stroke2 = (path: () => void) => { // trait coloré bordé de noir : lisible sur tout fond
    ctx.lineWidth = lw * 1.9; ctx.strokeStyle = "rgba(0,0,0,.75)"; path(); ctx.stroke();
    ctx.lineWidth = lw; ctx.strokeStyle = col; path(); ctx.stroke();
  };
  if (m.type === "arrow") {
    const p = zoomEase(age, 0.35), x1 = X(m.x1), y1 = Y(m.y1), x2 = x1 + (X(m.x2) - x1) * p, y2 = y1 + (Y(m.y2) - y1) * p;
    const an = Math.atan2(y2 - y1, x2 - x1), hl = W * 0.05;
    stroke2(() => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); });
    if (p > 0.6) stroke2(() => { ctx.beginPath(); ctx.moveTo(x2 - hl * Math.cos(an - 0.5), y2 - hl * Math.sin(an - 0.5)); ctx.lineTo(x2, y2); ctx.lineTo(x2 - hl * Math.cos(an + 0.5), y2 - hl * Math.sin(an + 0.5)); });
  } else if (m.type === "circle") {
    const p = zoomEase(age, 0.45), cx = X((m.x1 + m.x2) / 2), cy = Y((m.y1 + m.y2) / 2), rx = Math.max(8, Math.abs(X(m.x2) - X(m.x1)) / 2), ry = Math.max(8, Math.abs(Y(m.y2) - Y(m.y1)) / 2);
    const a0 = -Math.PI * 0.6; // trait façon feutre : le cercle se dessine et dépasse un peu son point de départ
    stroke2(() => { ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, -0.08, a0, a0 + Math.PI * 2.12 * p); });
  } else {
    const size = (m.x2 || 0.16) * W, pop = age < 0.12 ? 0.3 + 0.95 * (age / 0.12) : age < 0.22 ? 1.25 - 0.25 * ((age - 0.12) / 0.1) : 1;
    const shake = age < 0.35 ? Math.sin(age * 90) * size * 0.03 * (1 - age / 0.35) : 0;
    ctx.font = `900 ${size}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const tw = ctx.measureText(m.text ?? "BAM !").width, R = Math.max(tw * 0.62, size * 0.9), n = 14;
    const px = Math.min(W - R * 1.15, Math.max(R * 1.15, X(m.x1))), py = Math.min(H - R * 0.9, Math.max(R * 0.9, Y(m.y1))); // toujours dans l'image
    ctx.translate(px + shake, py); ctx.rotate(-0.12); ctx.scale(pop, pop);
    ctx.beginPath(); for (let i = 0; i < n * 2; i++) { const r = i % 2 ? R * 0.68 : R * (1 + 0.12 * Math.sin(i * 1.7)), a = (i / (n * 2)) * Math.PI * 2; i ? ctx.lineTo(r * Math.cos(a), r * 0.72 * Math.sin(a)) : ctx.moveTo(r * Math.cos(a), r * 0.72 * Math.sin(a)); }
    ctx.closePath(); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = size * 0.07; ctx.strokeStyle = "#111"; ctx.stroke();
    ctx.lineWidth = size * 0.16; ctx.strokeStyle = "#111"; ctx.strokeText(m.text ?? "BAM !", 0, size * 0.04);
    ctx.fillStyle = col === "#e8202a" ? "#ffd60a" : "#e8202a"; ctx.fillText(m.text ?? "BAM !", 0, size * 0.04);
  }
  ctx.restore();
}
/** Onomatopées à placer d'après la transcription (mot dit → onomatopée, au moment du mot, côtés alternés). */
export function sfxFromWords(words: { text: string; start: number; end: number }[], cut: (t: number) => boolean): Mark[] {
  const out: Mark[] = []; let side = 0;
  for (const w of words) {
    const k = w.text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, ""), txt = SFX_WORDS[k];
    if (!txt || cut((w.start + w.end) / 2) || out.some((m) => Math.abs(m.start - w.start) < 1.5)) continue;
    out.push({ id: "sfx" + Math.round(w.start * 100), type: "sfx", start: Math.max(0, w.start - 0.05), end: w.start + 1.3, x1: side++ % 2 ? 0.66 : 0.34, y1: 0.24, x2: 0.15, y2: 0, text: txt, color: "#ffd60a" });
  }
  return out;
}
