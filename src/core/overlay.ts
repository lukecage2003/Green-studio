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
export interface Overlay { id: string; kind: "image" | "video"; start: number; end: number; mode: OverlayMode; freeze?: number; zoom?: ZoomTarget; path?: ZoomTarget[]; anim?: OverlayAnim; with?: string; labels?: [string, string] }
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
  const [la, lb] = ov.labels ?? ["AVANT", "APRÈS"], fs = W * 0.05; ctx.font = `900 ${fs}px ${FONT}`;
  const tag = (txt: string, cx: number, col: string) => { const tw = ctx.measureText(txt).width + fs; const ty = H * (TIKTOK_SAFE.top + 0.02); rounded(ctx, cx - tw / 2, ty, tw, fs * 1.6, fs * 0.5); ctx.fillStyle = col; ctx.fill(); ctx.fillStyle = "#fff"; ctx.fillText(txt, cx, ty + fs * 0.8); };
  if (la) tag(la.toUpperCase(), xs / 2, "rgba(232,32,42,.92)"); if (lb && b) tag(lb.toUpperCase(), xs + (W - xs) / 2, "rgba(10,132,255,.92)");
  ctx.restore();
}

/** Temps à lire dans un extrait vidéo : il avance, puis reste figé à partir de `freeze`. */
export const clipTime = (ov: Overlay, t: number) => Math.max(0, Math.min(t - ov.start, ov.freeze ?? Infinity));
/** Progression du zoom d'un extrait à l'instant t (le zoom démarre au gel, sinon 0,3 s après l'apparition). */
export const overlayZoomK = (ov: Overlay, t: number) => (ov.zoom ? zoomEase(t - ov.start - (ov.kind === "video" && ov.freeze != null ? ov.freeze : 0.3)) : 0);
/** kind : bandeau (bas gauche), chapitre (carton plein écran), bulle (citation façon comic). */
/** timeline : frise (sub = « 1962 Création ; 1984 Secret Wars ; … »). */
export interface Title { id: string; text: string; sub?: string; start: number; end: number; kind?: "lower" | "chapter" | "timeline" }
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

/** Bandeau titre (bas gauche) en verre sombre : glisse en entrant, s'efface en sortant. */
/** Découpe un texte en lignes qui tiennent dans maxW (police déjà réglée). */
function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const out: string[] = []; let line = "";
  for (const w of text.split(/\s+/)) { const tryL = line ? line + " " + w : w; if (line && ctx.measureText(tryL).width > maxW) { out.push(line); line = w; } else line = tryL; }
  if (line) out.push(line); return out;
}
/** Carton de chapitre : image assombrie, petit surtitre (« PARTIE 2 »), grand titre, trait d'accent ; entrée en zoom léger. */
function drawChapter(ctx: Ctx, W: number, H: number, t: number, ti: Title, accent: string) {
  const a = fadeIn(ti, t, 0.35), sc = 1.06 - 0.06 * a;
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = "rgba(6,6,10,.62)"; ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H * 0.46); ctx.scale(sc, sc); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const fs = W * 0.095, sfs = W * 0.042;
  ctx.font = `900 ${fs}px ${FONT}`; const lines = wrap(ctx, ti.text.toUpperCase(), W * 0.84), lh = fs * 1.08, top = -((lines.length - 1) * lh) / 2;
  if (ti.sub) { ctx.font = `800 ${sfs}px ${FONT}`; ctx.fillStyle = accent; ctx.fillText(ti.sub.toUpperCase(), 0, top - fs * 0.95); }
  ctx.font = `900 ${fs}px ${FONT}`; ctx.lineJoin = "round"; ctx.lineWidth = fs * 0.12; ctx.strokeStyle = "rgba(0,0,0,.85)"; ctx.fillStyle = "#fff";
  lines.forEach((l, i) => { ctx.strokeText(l, 0, top + i * lh); ctx.fillText(l, 0, top + i * lh); });
  ctx.fillStyle = accent; const bw = W * 0.18 * a; ctx.fillRect(-bw / 2, top + (lines.length - 1) * lh + fs * 0.85, bw, W * 0.012);
  ctx.restore();
}
/** Frise chronologique : ligne qui se trace, points datés qui apparaissent un à un (sub = « 1962 Création ; 1984 … »). */
function drawTimeline(ctx: Ctx, W: number, H: number, t: number, ti: Title, accent: string) {
  const a = fadeIn(ti, t, 0.3), ev = (ti.sub ?? "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 6), n = Math.max(1, ev.length);
  const dur = Math.max(1, (ti.end - ti.start) * 0.7), y0 = H * 0.22, y1 = H * 0.22 + (n - 1) * H * 0.12, x0 = W * 0.16, p = Math.min(1, (t - ti.start) / dur);
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff"; ctx.font = `900 ${W * 0.065}px ${FONT}`; ctx.textBaseline = "middle"; ctx.fillText(ti.text.toUpperCase(), x0 - W * 0.06, H * 0.155, W * 0.8);
  ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = W * 0.008; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();
  ctx.strokeStyle = accent; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + (y1 - y0) * p); ctx.stroke();
  ev.forEach((e1, i) => {
    const at = n > 1 ? i / (n - 1) : 0, ra = Math.min(1, Math.max(0, (p - at) * n * 1.5 + 0.3)); if (ra <= 0) return;
    const y = y0 + (y1 - y0) * at, [d, ...rest] = e1.split(/\s+/), sc = spring(ra * 0.6, 0.35, 0.6);
    ctx.save(); ctx.globalAlpha = a * Math.min(1, ra * 1.5);
    ctx.beginPath(); ctx.arc(x0, y, W * 0.025 * sc, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill(); ctx.lineWidth = W * 0.006; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.fillStyle = accent; ctx.font = `900 ${W * 0.055}px ${FONT}`; ctx.fillText(d, x0 + W * 0.06, y - W * 0.025);
    ctx.fillStyle = "#fff"; ctx.font = `700 ${W * 0.045}px ${FONT}`; ctx.fillText(rest.join(" "), x0 + W * 0.06, y + W * 0.035, W * 0.74);
    ctx.restore();
  });
  ctx.restore();
}
export function drawTitle(ctx: Ctx, W: number, H: number, t: number, ti: Title | null, accent = "#30d158") {
  if (!ti || !ti.text.trim()) return;
  if (ti.kind === "timeline") return drawTimeline(ctx, W, H, t, ti, accent);
  if (ti.kind === "chapter") return drawChapter(ctx, W, H, t, ti, accent);
  if (ti.kind && ti.kind !== "lower") return; // anciens types retirés (bulle, fiche)
  const a = fadeIn(ti, t, 0.3), fs = W * 0.052, sfs = W * 0.034, pad = W * 0.04, x0 = W * 0.05 - (1 - a) * W * 0.08, y1 = 0; // en haut, sous les onglets TikTok
  ctx.save(); ctx.globalAlpha = a;
  ctx.font = `800 ${fs}px ${FONT}`; const tw = ctx.measureText(ti.text).width;
  ctx.font = `600 ${sfs}px ${FONT}`; const sw = ti.sub ? ctx.measureText(ti.sub).width : 0;
  const w = Math.min(W * 0.84, Math.max(tw, sw) + pad * 2 + W * 0.02), h = fs * 1.5 + (ti.sub ? sfs * 1.5 : 0) + pad * 0.6;
  ctx.translate(0, H * (TIKTOK_SAFE.top + 0.015) + h);
  ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = W * 0.04;
  rounded(ctx, x0, y1 - h, w, h, W * 0.045); ctx.fillStyle = "rgba(20,20,24,.72)"; ctx.fill(); ctx.shadowColor = "transparent";
  ctx.lineWidth = Math.max(1, W * 0.0015); ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.stroke();
  ctx.fillStyle = accent; rounded(ctx, x0 + pad * 0.55, y1 - h + pad * 0.45, W * 0.01, h - pad * 0.9, W * 0.005); ctx.fill();
  ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.font = `800 ${fs}px ${FONT}`;
  ctx.fillText(ti.text, x0 + pad + W * 0.01, y1 - h + pad * 0.3 + fs * 0.75, w - pad * 2);
  if (ti.sub) { ctx.font = `600 ${sfs}px ${FONT}`; ctx.fillStyle = "rgba(235,235,245,.75)"; ctx.fillText(ti.sub, x0 + pad + W * 0.01, y1 - h + pad * 0.3 + fs * 1.5 + sfs * 0.7, w - pad * 2); }
  ctx.restore();
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
