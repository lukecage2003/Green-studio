/**
 * Présentateur de planche pendant le tournage : la planche s'affiche en haut de l'image (même place que l'incrustation du montage).
 * Toucher une case → zoom dessus ; toucher à nouveau → vue d'ensemble ; ‹ › → case précédente / suivante (puis page suivante).
 * Pendant l'enregistrement, chaque geste est noté (instant, page, cadrage) ; le montage rejoue exactement la même chose.
 */
import { detectPanels, panelTarget, panelAt, pageTarget, type Panel } from "../core/panels.ts";
import { zoomRect, zoomEase, type ZoomTarget } from "../core/overlay.ts";
import { mediaPut } from "./mediastore.ts";

export interface PresEvent { t: number; page: number; panel: number; target: ZoomTarget | null }
export interface PresData { pages: string[]; events: PresEvent[]; end: number; aspect: number; at: number }
/** Géométrie de la planche dans l'image 9:16 (fractions) : identique au mode « Incrustation » du montage. */
export const PRES_BOX = { left: 0.06, width: 0.88, top: 0.145 };
export const presBoxH = (W: number, H: number) => Math.min(H * 0.42, W * 0.88 * 0.75) / H;
const ALL: ZoomTarget = { z: 1, x: 0.5, y: 0.5 };
const lerp = (a: ZoomTarget, b: ZoomTarget, k: number): ZoomTarget => ({ z: a.z + (b.z - a.z) * k, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

const CSS = `
.pres{position:absolute;left:${PRES_BOX.left * 100}%;width:${PRES_BOX.width * 100}%;top:${PRES_BOX.top * 100}%;border-radius:4.5%/6%;overflow:hidden;z-index:6;box-shadow:0 10px 30px rgba(0,0,0,.45);touch-action:manipulation;background:#000}
.pres canvas{display:block;width:100%;height:100%}
.pres .hint{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);font:600 11px/1 var(--font,system-ui);color:#fff;background:rgba(0,0,0,.55);padding:6px 10px;border-radius:12px;pointer-events:none;transition:opacity .4s;white-space:nowrap}
.presbar{position:absolute;left:50%;transform:translateX(-50%);z-index:7;display:flex;gap:8px;align-items:center;padding:6px;border-radius:24px;background:rgba(40,40,46,.55);-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);border:.5px solid rgba(255,255,255,.22)}
.presbar button{min-width:44px;height:40px;border-radius:20px;border:0;background:rgba(255,255,255,.12);color:#fff;font:700 18px/1 var(--font,system-ui);padding:0 12px}
.presbar span{font:600 13px/1 var(--font,system-ui);color:rgba(255,255,255,.8);padding:0 4px;min-width:96px;text-align:center;white-space:nowrap}
.presbar .rec{width:9px;height:9px;min-width:0;border-radius:50%;background:#ff453a;padding:0;display:none}.presbar.on .rec{display:block}`;

export class Presenter {
  private box: HTMLDivElement; private cv: HTMLCanvasElement; private bar: HTMLDivElement; private hint: HTMLDivElement;
  private imgs: ImageBitmap[] = []; private panels: Panel[][] = []; private ids: string[] = [];
  private page = 0; private panel = -1; private from: ZoomTarget = ALL; private to: ZoomTarget | null = null; private t0 = 0; private raf = 0;
  private events: PresEvent[] = []; private recording = false;
  private frame: HTMLElement; private recT: () => number | null;
  constructor(frame: HTMLElement, recT: () => number | null) {
    this.frame = frame; this.recT = recT;
    if (!document.getElementById("presCss")) { const st = document.createElement("style"); st.id = "presCss"; st.textContent = CSS; document.head.appendChild(st); }
    this.box = document.createElement("div"); this.box.className = "pres"; this.box.hidden = true;
    this.cv = document.createElement("canvas"); this.hint = document.createElement("div"); this.hint.className = "hint"; this.hint.textContent = "Touchez une case pour zoomer";
    this.box.append(this.cv, this.hint);
    this.bar = document.createElement("div"); this.bar.className = "presbar"; this.bar.hidden = true;
    this.bar.innerHTML = `<i class="rec" aria-hidden="true"></i><button data-p="prev" aria-label="Case précédente">‹</button><span data-p="n"></span><button data-p="next" aria-label="Case suivante">›</button><button data-p="close" aria-label="Fermer la planche">✕</button>`;
    frame.append(this.box, this.bar);
    this.cv.addEventListener("pointerup", (e) => this.tap(e));
    this.bar.addEventListener("click", (e) => { const a = (e.target as HTMLElement).closest<HTMLElement>("[data-p]")?.dataset.p; if (a === "prev") this.step(-1); else if (a === "next") this.step(1); else if (a === "close") this.close(); });
    addEventListener("resize", () => this.layout());
  }
  get open() { return !this.box.hidden; }
  /** Charge une ou plusieurs planches (images) : rangées sur le téléphone, cases détectées. */
  async load(files: File[]) {
    this.imgs = []; this.panels = []; this.ids = [];
    for (const [i, f] of files.entries()) {
      const bmp = await createImageBitmap(f); this.imgs.push(bmp);
      const k = Math.min(1, 420 / bmp.width), c = new OffscreenCanvas(Math.max(8, Math.round(bmp.width * k)), Math.max(8, Math.round(bmp.height * k))), g = c.getContext("2d")!;
      g.drawImage(bmp, 0, 0, c.width, c.height); this.panels.push(detectPanels(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height));
      const id = "pg" + Date.now().toString(36) + i; this.ids.push(id); await mediaPut(id, f).catch(() => {});
    }
    this.page = 0; this.panel = -1; this.events = []; this.from = this.to = this.whole();
    this.box.hidden = false; this.bar.hidden = false; this.hint.style.opacity = "1"; this.layout(); this.log(); this.loop();
    return this.panels.map((p) => p.length);
  }
  close() { this.log(true); this.box.hidden = true; this.bar.hidden = true; cancelAnimationFrame(this.raf); }
  /** Début d'une prise : l'état actuel est la première étape. */
  recStart() { this.events = []; this.recording = true; this.bar.classList.add("on"); if (this.open) this.log(); }
  /** Fin de la prise : renvoie ce qu'il faut rejouer au montage (null si la planche n'a pas servi). */
  recStop(end: number): PresData | null {
    this.recording = false; this.bar.classList.remove("on");
    if (!this.events.length) return null;
    const d: PresData = { pages: this.ids, events: this.events, end, aspect: this.aspect(), at: Date.now() }; this.events = []; return d;
  }
  private aspect() { const W = this.frame.clientWidth || 9, H = this.frame.clientHeight || 16; return (W * PRES_BOX.width) / (H * presBoxH(W, H)); }
  private layout() {
    const W = this.frame.clientWidth, H = this.frame.clientHeight; if (!W || !H) return;
    const h = presBoxH(W, H) * H; this.box.style.height = h + "px";
    const dpr = devicePixelRatio || 1; this.cv.width = Math.round(W * PRES_BOX.width * dpr); this.cv.height = Math.round(h * dpr);
    this.bar.style.top = (PRES_BOX.top * H + h + 10) + "px";
  }
  /** Vue d'ensemble : toute la page visible. */
  private whole(): ZoomTarget { const img = this.imgs[this.page]; return img ? pageTarget(img.width, img.height, this.aspect()) : ALL; }
  private cur(): ZoomTarget { return lerp(this.from, this.to ?? this.whole(), zoomEase((performance.now() - this.t0) / 1000, 0.55)); }
  private go(panel: number) {
    const img = this.imgs[this.page]; if (!img) return;
    this.from = this.cur(); this.panel = panel; this.to = panel >= 0 ? panelTarget(this.panels[this.page][panel], img.width, img.height, this.aspect()) : this.whole(); this.t0 = performance.now();
    this.hint.style.opacity = "0"; this.log();
  }
  private tap(e: PointerEvent) {
    if (this.panel >= 0) return this.go(-1); // zoomé : retour à la page entière
    const img = this.imgs[this.page]; if (!img) return; const r = this.cv.getBoundingClientRect();
    const z = zoomRect(img.width, img.height, this.cv.width, this.cv.height, this.cur(), 1), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    this.go(panelAt(this.panels[this.page], (z.sx + fx * z.sw) / img.width, (z.sy + fy * z.sh) / img.height));
  }
  /** Case suivante / précédente ; au bout de la page, page suivante (vue d'ensemble). */
  private step(d: number) {
    const n = this.panels[this.page]?.length ?? 0, p = this.panel + d;
    if (p >= 0 && p < n) return this.go(p);
    const np = this.page + d; if (np < 0 || np >= this.imgs.length) { if (this.panel >= 0) this.go(-1); return; }
    this.page = np; this.panel = -1; this.from = this.to = this.whole(); this.t0 = performance.now(); this.log();
  }
  private log(hide = false) {
    const t = this.recording ? this.recT() : null;
    (this.bar.querySelector("[data-p=n]") as HTMLElement).textContent = `${this.panel >= 0 ? `Case ${this.panel + 1}/${this.panels[this.page]?.length ?? 0}` : "Page"} · ${this.page + 1}/${this.imgs.length}`;
    if (t == null) return;
    this.events.push({ t: Math.max(0, t), page: hide ? -1 : this.page, panel: this.panel, target: this.to });
  }
  private loop() {
    cancelAnimationFrame(this.raf);
    const draw = () => {
      if (this.box.hidden) return; const img = this.imgs[this.page], g = this.cv.getContext("2d")!;
      if (img) { const r = zoomRect(img.width, img.height, this.cv.width, this.cv.height, this.cur(), 1); g.fillStyle = "#111"; g.fillRect(0, 0, this.cv.width, this.cv.height); g.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, this.cv.width, this.cv.height); }
      this.raf = requestAnimationFrame(draw);
    };
    draw();
  }
}

/** Étapes de montage à partir des gestes enregistrés : une incrustation par étape, le cadrage glisse de l'une à l'autre. */
export function presToOverlays(d: PresData, duration: number) {
  const ev = d.events.filter((e) => e.t < duration).sort((a, b) => a.t - b.t), out: { src: string; start: number; end: number; zfrom?: ZoomTarget; zoom?: ZoomTarget; page: number }[] = [];
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i], end = Math.min(duration, ev[i + 1]?.t ?? Math.min(d.end, duration)); if (e.page < 0 || end - e.t < 0.05 || !d.pages[e.page]) continue;
    const prev = out[out.length - 1], same = prev && prev.page === e.page && Math.abs(prev.end - e.t) < 0.06;
    out.push({ src: d.pages[e.page], start: e.t, end, zfrom: same ? prev.zoom : e.target ?? undefined, zoom: e.target ?? undefined, page: e.page });
  }
  // fondus seulement au début et à la fin d'une suite d'étapes de la même page
  return out.map((o, i) => { const a = i > 0 && out[i - 1].page === o.page && Math.abs(out[i - 1].end - o.start) < 0.06, b = i + 1 < out.length && out[i + 1].page === o.page && Math.abs(out[i + 1].start - o.end) < 0.06;
    return { ...o, seq: (a && b ? "mid" : a ? "last" : b ? "first" : "only") as "first" | "mid" | "last" | "only" }; });
}
