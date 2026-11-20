/**
 * Décors animés générés sur le téléphone (aucun fichier, aucun droit) : courte vidéo en boucle parfaite (6 s), utilisée comme décor vidéo.
 * Cosmos : étoiles qui défilent sur trois plans, nébuleuses qui respirent. Multivers : anneaux et sphères en orbite.
 * Labo : grille, balayage lumineux et particules.
 */
import { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, VideoSampleSource, VideoSample, canEncodeVideo } from "mediabunny";

export type DecorKind = "cosmos" | "multivers" | "labo";
const T = 6, FPS = 30;

/** Image du décor à l'instant t (0 ≤ t < T) ; t et t + T donnent la même image (boucle sans saut). */
export function drawDecor(g: OffscreenCanvasRenderingContext2D, W: number, H: number, kind: DecorKind, t: number) {
  const a = (2 * Math.PI * t) / T; let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (kind === "cosmos") {
    const bg = g.createLinearGradient(0, 0, W * 0.3, H); bg.addColorStop(0, "#1b0f3d"); bg.addColorStop(0.55, "#0b0b26"); bg.addColorStop(1, "#04040b"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (const [x, y, rad, col, ph] of [[0.75, 0.22, 0.55, "236,72,153", 0], [0.2, 0.6, 0.6, "99,102,241", 2], [0.6, 0.85, 0.5, "34,211,238", 4]] as const) {
      const k = 1 + 0.08 * Math.sin(a + ph), cx = W * (x + 0.02 * Math.cos(a + ph)), cy = H * (y + 0.015 * Math.sin(a + ph)), n = g.createRadialGradient(cx, cy, 0, cx, cy, W * rad * k);
      n.addColorStop(0, `rgba(${col},.42)`); n.addColorStop(0.5, `rgba(${col},.12)`); n.addColorStop(1, `rgba(${col},0)`); g.fillStyle = n; g.fillRect(0, 0, W, H);
    }
    for (const [cnt, sp, sz, al] of [[220, 1, 1.1, 0.5], [110, 2, 1.8, 0.75], [40, 3, 2.8, 1]] as const) // trois plans : un tour complet de l'image en T (×1, ×2, ×3)
      for (let i = 0; i < cnt; i++) { const x0 = r(), y0 = r(), tw = 0.6 + 0.4 * Math.sin(a * 2 + i), y = ((y0 + (sp * t) / T) % 1) * H;
        g.globalAlpha = al * tw; g.fillStyle = "#fff"; g.beginPath(); g.arc(x0 * W, y, sz * (W / 720), 0, 7); g.fill(); }
    g.globalAlpha = 1;
  } else if (kind === "multivers") {
    const bg = g.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.45, H * 0.8); bg.addColorStop(0, "#2a1458"); bg.addColorStop(0.6, "#0d0a24"); bg.addColorStop(1, "#030308"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 160; i++) { g.globalAlpha = 0.25 + 0.5 * r(); g.fillStyle = "#fff"; g.fillRect(r() * W, r() * H, 1.5, 1.5); } g.globalAlpha = 1;
    for (let k = 0; k < 4; k++) { // anneaux qui tournent (un tour en T ou T/2)
      const rx = W * (0.25 + k * 0.12), ry = rx * 0.32, rot = -0.35 + 0.08 * Math.sin(a + k);
      g.save(); g.translate(W / 2, H * 0.42); g.rotate(rot); g.strokeStyle = `rgba(${k % 2 ? "167,139,250" : "56,189,248"},${0.35 - k * 0.06})`; g.lineWidth = 2 * (W / 720);
      g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 7); g.stroke();
      const ang = a * (k % 2 ? -1 : 1) * (1 + (k % 2)) + k, ox = Math.cos(ang) * rx, oy = Math.sin(ang) * ry, s = W * (0.018 + 0.006 * k), o = g.createRadialGradient(ox, oy, 0, ox, oy, s * 2.5);
      o.addColorStop(0, "rgba(255,255,255,.95)"); o.addColorStop(0.3, k % 2 ? "rgba(167,139,250,.8)" : "rgba(56,189,248,.8)"); o.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = o; g.beginPath(); g.arc(ox, oy, s * 2.5, 0, 7); g.fill();
      g.restore();
    }
    const c = g.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, W * 0.12 * (1 + 0.1 * Math.sin(a * 2))); c.addColorStop(0, "rgba(253,230,138,.9)"); c.addColorStop(1, "rgba(253,230,138,0)"); g.fillStyle = c; g.fillRect(0, 0, W, H);
  } else {
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#071a24"); bg.addColorStop(1, "#02070a"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const step = W / 9, off = (t / T) * step; g.strokeStyle = "rgba(45,212,191,.13)"; g.lineWidth = 1;
    for (let x = -step; x < W + step; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = -step + off; y < H + step; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const sy = ((t / T) % 1) * H * 1.3 - H * 0.15, sc = g.createLinearGradient(0, sy - H * 0.12, 0, sy + H * 0.02); sc.addColorStop(0, "rgba(45,212,191,0)"); sc.addColorStop(1, "rgba(45,212,191,.22)"); g.fillStyle = sc; g.fillRect(0, sy - H * 0.12, W, H * 0.14);
    for (let i = 0; i < 70; i++) { const x0 = r(), y0 = r(), y = ((y0 - t / T + 1) % 1) * H; g.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(a + i)); g.fillStyle = "#5eead4"; g.fillRect(x0 * W, y, 2, 2); } g.globalAlpha = 1;
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.6)"); g.fillStyle = v; g.fillRect(0, 0, W, H);
  }
}

/** Fabrique la vidéo du décor (MP4 H.264 si possible, sinon WebM). */
export async function makeAnimatedDecor(kind: DecorKind, onProgress?: (p: number) => void, W = 720, H = 1280): Promise<File> {
  const mp4 = await canEncodeVideo("avc", { width: W, height: H, bitrate: 4e6 }), codec = mp4 ? "avc" : "vp9";
  const target = new BufferTarget(), out = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(), target });
  const src = new VideoSampleSource({ codec, bitrate: 4e6, keyFrameInterval: 2 }); out.addVideoTrack(src, { frameRate: FPS }); await out.start();
  const cv = new OffscreenCanvas(W, H), g = cv.getContext("2d")!, n = T * FPS;
  for (let i = 0; i < n; i++) { drawDecor(g, W, H, kind, i / FPS); const s = new VideoSample(cv, { timestamp: i / FPS, duration: 1 / FPS }); await src.add(s, i % (FPS * 2) === 0 ? { keyFrame: true } : undefined); s.close(); if (i % 15 === 0) onProgress?.(i / n); }
  await out.finalize(); const name = { cosmos: "Cosmos", multivers: "Multivers", labo: "Labo" }[kind];
  return new File([target.buffer!], `decor-${name}.${mp4 ? "mp4" : "webm"}`, { type: mp4 ? "video/mp4" : "video/webm" });
}
