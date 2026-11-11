/** Habillage : images/extraits par-dessus la vidéo (plein écran, incrustation, « moi en petit ») et bandeaux titres.
 *  Le même dessin sert à l'aperçu (lecteur) et à l'export : ce que l'on voit est ce que l'on obtient. Temps = temps source. */

export type OverlayMode = "full" | "pip" | "me";
export interface Overlay { id: string; kind: "image" | "video"; start: number; end: number; mode: OverlayMode }
export interface Title { id: string; text: string; sub?: string; start: number; end: number }

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
/** Dessine src en remplissant (x, y, w, h) — recadrage centré — avec un zoom lent (« Ken Burns ») de 1 à 1,08. */
export function drawCover(ctx: Ctx, src: Src, x: number, y: number, w: number, h: number, kb = 0) {
  const s = size(src), z = 1 + 0.08 * kb, k = Math.max(w / s.w, h / s.h) * z, dw = s.w * k, dh = s.h * k;
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/**
 * Compose une image : `speaker(x, y, w, h)` dessine la personne (l'image filmée) dans le rectangle donné.
 * full : extrait plein écran ; pip : extrait dans une carte en haut, la personne reste visible ; me : extrait plein écran
 * et la personne en petit dans un coin.
 */
export function compose(ctx: Ctx, W: number, H: number, t: number, ov: Overlay | null, src: Src | null, speaker: (x: number, y: number, w: number, h: number) => void) {
  if (!ov || !src) { speaker(0, 0, W, H); return; }
  const a = fadeIn(ov, t), kb = Math.min(1, Math.max(0, (t - ov.start) / Math.max(0.1, ov.end - ov.start)));
  if (ov.mode === "pip") {
    speaker(0, 0, W, H);
    const w = W * 0.88, h = Math.min(H * 0.42, w * 0.75), x = (W - w) / 2, y = H * 0.1 + (1 - a) * H * 0.03, r = W * 0.05;
    ctx.save(); ctx.globalAlpha = a; ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = W * 0.05; ctx.shadowOffsetY = W * 0.015;
    rounded(ctx, x, y, w, h, r); ctx.fillStyle = "#000"; ctx.fill(); ctx.shadowColor = "transparent";
    rounded(ctx, x, y, w, h, r); ctx.clip(); drawCover(ctx, src, x, y, w, h, kb); ctx.restore();
    ctx.save(); ctx.globalAlpha = a * 0.6; rounded(ctx, x, y, w, h, r); ctx.lineWidth = Math.max(1, W * 0.002); ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.stroke(); ctx.restore();
    return;
  }
  // full / me : l'extrait remplit l'image (fondu depuis la personne)
  if (a < 1) speaker(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = a; drawCover(ctx, src, 0, 0, W, H, kb); ctx.restore();
  if (ov.mode === "me") {
    const w = W * 0.36, h = w * 16 / 9, x = W - w - W * 0.05, y = H - h - H * 0.16, r = W * 0.06;
    ctx.save(); ctx.globalAlpha = a; ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = W * 0.05;
    rounded(ctx, x, y, w, h, r); ctx.fillStyle = "#000"; ctx.fill(); ctx.shadowColor = "transparent";
    rounded(ctx, x, y, w, h, r); ctx.clip(); speaker(x, y, w, h); ctx.restore();
    ctx.save(); ctx.globalAlpha = a; rounded(ctx, x, y, w, h, r); ctx.lineWidth = Math.max(2, W * 0.004); ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.stroke(); ctx.restore();
  }
}

/** Bandeau titre (bas gauche) en verre sombre : glisse en entrant, s'efface en sortant. */
export function drawTitle(ctx: Ctx, W: number, H: number, t: number, ti: Title | null, accent = "#30d158") {
  if (!ti || !ti.text.trim()) return;
  const a = fadeIn(ti, t, 0.3), fs = W * 0.052, sfs = W * 0.034, pad = W * 0.04, x0 = W * 0.05 - (1 - a) * W * 0.08, y1 = H * 0.79;
  ctx.save(); ctx.globalAlpha = a;
  ctx.font = `800 ${fs}px ${FONT}`; const tw = ctx.measureText(ti.text).width;
  ctx.font = `600 ${sfs}px ${FONT}`; const sw = ti.sub ? ctx.measureText(ti.sub).width : 0;
  const w = Math.min(W * 0.9, Math.max(tw, sw) + pad * 2 + W * 0.02), h = fs * 1.5 + (ti.sub ? sfs * 1.5 : 0) + pad * 0.6;
  ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = W * 0.04;
  rounded(ctx, x0, y1 - h, w, h, W * 0.045); ctx.fillStyle = "rgba(20,20,24,.72)"; ctx.fill(); ctx.shadowColor = "transparent";
  ctx.lineWidth = Math.max(1, W * 0.0015); ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.stroke();
  ctx.fillStyle = accent; rounded(ctx, x0 + pad * 0.55, y1 - h + pad * 0.45, W * 0.01, h - pad * 0.9, W * 0.005); ctx.fill();
  ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.font = `800 ${fs}px ${FONT}`;
  ctx.fillText(ti.text, x0 + pad + W * 0.01, y1 - h + pad * 0.3 + fs * 0.75, w - pad * 2);
  if (ti.sub) { ctx.font = `600 ${sfs}px ${FONT}`; ctx.fillStyle = "rgba(235,235,245,.75)"; ctx.fillText(ti.sub, x0 + pad + W * 0.01, y1 - h + pad * 0.3 + fs * 1.5 + sfs * 0.7, w - pad * 2); }
  ctx.restore();
}
