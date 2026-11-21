/**
 * Planche en direct pendant le tournage : la planche devient le DÉCOR (vous êtes devant, détouré) ; toucher une case → le décor
 * zoome dessus en douceur ; toucher à nouveau → page entière ; ‹ › → case précédente / suivante, puis page suivante.
 * Le zoom passe par les réglages du décor (même moteur que le cadrage du fond) : il est gravé dans la vidéo pendant la prise.
 * Cases : IA sur le téléphone + bordures (panelsml.ts), corrigeables (✎).
 */
import { readingOrder, type Panel } from "../core/panels.ts";
import { detectPageSmart, warmPanels } from "../core/panelsml.ts";
import { zoomEase, type ZoomTarget } from "../core/overlay.ts";

/** Ce que l'écran de tournage met à disposition : le décor et ses réglages de cadrage (zoom, décalages). */
export interface Stage {
  /** Affiche cette image comme décor (temporaire) ; renvoie sa taille quand elle est prête. */
  show(blob: Blob): Promise<{ w: number; h: number }>;
  /** Cadrage actuel du décor et application d'un nouveau cadrage. */
  get(): { zoom: number; px: number; py: number }; set(v: { zoom: number; px: number; py: number }): void;
  /** Zone de l'image du décor visible pour un cadrage : [largeur, hauteur, gauche, haut] en fractions de l'image. */
  cover(zoom: number, px: number, py: number): number[];
  /** Avant / après la planche : sauvegarde et rétablissement du décor et du cadrage d'origine (parallaxe coupée pendant la planche). */
  begin(): void; end(): void;
}
type View = { zoom: number; px: number; py: number; pan?: [number, number] }; // pan : panoramique (px de départ → px d'arrivée) pour les cases larges
const PAN_S = 4;
const WHOLE: View = { zoom: 1, px: 0, py: 0 };

const CSS = `
.prestap{position:absolute;inset:0;z-index:5;touch-action:none}
.prestap canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.prestap .hint{position:absolute;left:50%;top:14%;transform:translateX(-50%);font:600 13px/1.2 var(--font,system-ui);color:#fff;background:rgba(20,20,24,.6);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);padding:8px 12px;border-radius:14px;pointer-events:none;transition:opacity .4s;text-align:center;max-width:86%}
.presbar{position:absolute;left:50%;top:8.5%;transform:translateX(-50%);z-index:7;display:flex;gap:6px;align-items:center;padding:5px;border-radius:22px;background:rgba(30,30,34,.5);-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);border:.5px solid rgba(255,255,255,.22)}
.presbar button{min-width:40px;height:36px;border-radius:18px;border:0;background:rgba(255,255,255,.12);color:#fff;font:700 17px/1 var(--font,system-ui);padding:0 10px}
.presbar span{font:600 13px/1 var(--font,system-ui);color:rgba(255,255,255,.85);padding:0 4px;min-width:96px;text-align:center;white-space:nowrap}
.presbar .rec{width:9px;height:9px;min-width:0;border-radius:50%;background:#ff453a;padding:0;display:none}.presbar.on .rec{display:block}`;

export class Presenter {
  private tapEl: HTMLDivElement; private cv: HTMLCanvasElement; private bar: HTMLDivElement; private hint: HTMLDivElement;
  private files: File[] = []; private keys: string[] = []; private sizes: { w: number; h: number }[] = []; private panels: Panel[][] = []; private bubbles: Panel[][] = [];
  private lastTap = { t: 0, x: 0, y: 0 }; private prevView: { v: View; panel: number } | null = null;
  private page = 0; private panel = -1; private from: View = WHOLE; private to: View = WHOLE; private t0 = 0; private raf = 0;
  private editing = false; private down: { x: number; y: number } | null = null; private shownAt = 0; private active = false; private recording = false;
  private rtl = (() => { try { return localStorage.getItem("gs.manga") === "1"; } catch { return false; } })();
  private frame: HTMLElement; private stage: Stage;
  constructor(frame: HTMLElement, stage: Stage) {
    this.frame = frame; this.stage = stage;
    if (!document.getElementById("presCss")) { const st = document.createElement("style"); st.id = "presCss"; st.textContent = CSS; document.head.appendChild(st); }
    this.tapEl = document.createElement("div"); this.tapEl.className = "prestap"; this.tapEl.hidden = true;
    this.cv = document.createElement("canvas"); this.hint = document.createElement("div"); this.hint.className = "hint"; this.tapEl.append(this.cv, this.hint);
    this.bar = document.createElement("div"); this.bar.className = "presbar"; this.bar.hidden = true;
    this.bar.innerHTML = `<i class="rec" aria-hidden="true"></i><button data-p="prev" aria-label="Case précédente">‹</button><span data-p="n"></span><button data-p="next" aria-label="Case suivante">›</button><button data-p="edit" aria-label="Revoir les cases">✎</button><button data-p="close" aria-label="Fermer la planche">✕</button>`;
    frame.append(this.tapEl, this.bar);
    this.tapEl.addEventListener("pointerdown", (e) => { this.down = { x: e.clientX, y: e.clientY }; });
    this.tapEl.addEventListener("pointerup", (e) => (this.editing ? this.editTap(e) : this.tap(e)));
    this.bar.addEventListener("click", (e) => { const a = (e.target as HTMLElement).closest<HTMLElement>("[data-p]")?.dataset.p;
      if (a === "prev") this.step(-1); else if (a === "next") this.step(1); else if (a === "close") this.close(); else if (a === "edit") this.setEdit(!this.editing);
      else if (a === "manga") { this.rtl = !this.rtl; try { localStorage.setItem("gs.manga", this.rtl ? "1" : "0"); } catch { /* */ } this.panels = this.panels.map((p) => readingOrder(p, this.rtl)); this.label(); } });
    warmPanels();
  }
  get open() { return this.active; }
  /** Charge une ou plusieurs planches : la première devient le décor, les cases sont repérées (IA + bordures). */
  async load(files: File[], onStatus?: (s: string) => void) {
    if (!this.active) this.stage.begin();
    this.files = files; this.sizes = []; this.panels = []; this.bubbles = [];
    for (const [i, f] of files.entries()) {
      onStatus?.(`Analyse des cases… ${i + 1}/${files.length}`);
      const bmp = await createImageBitmap(f); this.sizes.push({ w: bmp.width, h: bmp.height });
      const key = `gs.cases2.${f.name}.${f.size}.${f.lastModified}`; let d: { panels: Panel[]; bubbles: Panel[] } | null = null; // planche déjà analysée (ou corrigée) : immédiat
      try { d = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { /* */ }
      if (!d) { d = await detectPageSmart(bmp, bmp.width, bmp.height, { rtl: this.rtl }); try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* */ } }
      this.keys[i] = key; this.panels.push(readingOrder(d.panels, this.rtl)); this.bubbles.push(d.bubbles ?? []); bmp.close();
    }
    this.active = true; this.tapEl.hidden = false; this.bar.hidden = false;
    await this.showPage(0);
    return this.panels.map((p) => p.length);
  }
  close() {
    if (!this.active) return; this.active = false; this.editing = false; cancelAnimationFrame(this.raf);
    this.tapEl.hidden = true; this.bar.hidden = true; this.stage.end();
  }
  /** Début / fin d'une prise : le zoom est déjà dans la vidéo (décor), rien à rejouer au montage. */
  recStart() { this.recording = true; this.bar.classList.add("on"); }
  recStop(_end: number): null { this.recording = false; this.bar.classList.remove("on"); return null; }

  private async showPage(i: number) {
    this.page = i; this.panel = -1; await this.stage.show(this.files[i]);
    this.from = this.to = WHOLE; this.stage.set(WHOLE); this.t0 = performance.now(); this.shownAt = performance.now();
    this.hint.textContent = "Touchez une case pour zoomer · deux fois pour zoomer où vous voulez"; this.hint.style.opacity = "1"; this.label(); this.loop();
  }
  /** Cadrage du décor qui montre toute la case (marge de 8 %). */
  private viewFor(p: Panel): View {
    const [sx1, sy1] = this.stage.cover(1, 0, 0), fitAll = Math.min(sx1 / p.w, sy1 / p.h) * 0.92;
    const off = (c: number, s: number) => (s >= 1 ? 0 : (2 * Math.max(0, Math.min(1 - s, c - s / 2))) / (1 - s) - 1);
    if (fitAll < 1.3 && p.w / p.h > 1.2) { // case large sur écran vertical : zoom sur sa hauteur puis panoramique de gauche à droite
      const zoom = Math.max(1.3, Math.min(2.6, (sy1 / p.h) * 0.9)), sx = sx1 / zoom, sy = sy1 / zoom;
      const a = off(p.x + sx / 2, sx), b = off(p.x + p.w - sx / 2, sx);
      return { zoom, px: a, py: off(p.y + p.h / 2, sy), pan: [a, b] };
    }
    const zoom = Math.max(1, Math.min(6, fitAll)), sx = sx1 / zoom, sy = sy1 / zoom;
    return { zoom, px: off(p.x + p.w / 2, sx), py: off(p.y + p.h / 2, sy) };
  }
  private cur(): View {
    const t = (performance.now() - this.t0) / 1000, k = zoomEase(t, 0.55), to = this.to;
    let px = this.from.px + (to.px - this.from.px) * k;
    if (to.pan && t > 0.6) { const q = Math.min(1, (t - 0.6) / PAN_S), e = q * q * (3 - 2 * q); px = to.pan[0] + (to.pan[1] - to.pan[0]) * e; }
    return { zoom: this.from.zoom + (to.zoom - this.from.zoom) * k, px, py: this.from.py + (to.py - this.from.py) * k };
  }
  /** Point de l'écran → point de la page (fractions), avec le cadrage actuel. */
  private toPage(cx: number, cy: number, v: View = this.cur()) { const r = this.tapEl.getBoundingClientRect(), [sx, sy, ox, oy] = this.stage.cover(v.zoom, v.px, v.py); return [ox + ((cx - r.left) / r.width) * sx, oy + ((cy - r.top) / r.height) * sy]; }
  private go(panel: number) {
    this.from = this.cur(); this.panel = panel; this.to = panel >= 0 ? this.viewFor(this.panels[this.page][panel]) : WHOLE; this.t0 = performance.now();
    this.hint.style.opacity = "0"; this.label(); this.loop();
  }
  /** Appui : simple → case (ou retour à la page) ; double → zoom à l'endroit touché (ou sur la bulle touchée). */
  private tap(e: PointerEvent) {
    const d = this.down; this.down = null; if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 14) return; // glissé : ignoré
    const now = performance.now(), dbl = now - this.lastTap.t < 320 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 48;
    // le simple appui agit tout de suite ; un second appui rapproché prend le relais (zoom à l'endroit touché), sans saut
    if (dbl) { this.lastTap.t = 0; const base = this.prevView?.v; if (this.prevView) this.panel = this.prevView.panel; this.zoomAt(e.clientX, e.clientY, base); return; }
    this.lastTap = { t: now, x: e.clientX, y: e.clientY }; this.prevView = { v: this.cur(), panel: this.panel };
    this.single(e.clientX, e.clientY);
  }
  /** Double appui : zoom sur la bulle touchée, sinon ×2,5 centré sur le point touché ; encore une fois au même endroit → plus près. */
  private zoomAt(cx: number, cy: number, base: View = this.cur()) {
    const [x, y] = this.toPage(cx, cy, base), b = (this.bubbles[this.page] ?? []).find((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h);
    if (b && this.panel !== -2) { const m = 0.35; this.from = this.cur(); this.panel = -2; this.to = this.viewFor({ x: b.x - b.w * m, y: b.y - b.h * m, w: b.w * (1 + 2 * m), h: b.h * (1 + 2 * m) }); this.to.pan = undefined; this.t0 = performance.now(); this.hint.style.opacity = "0"; this.label(); this.loop(); return; }
    const v = this.cur(), [sx1, sy1] = this.stage.cover(1, 0, 0), zoom = Math.max(2.5, Math.min(6, base.zoom * 2)), sx = sx1 / zoom, sy = sy1 / zoom;
    const off = (c: number, s2: number) => (s2 >= 1 ? 0 : (2 * Math.max(0, Math.min(1 - s2, c - s2 / 2))) / (1 - s2) - 1);
    this.from = v; this.panel = -2; this.to = { zoom, px: off(x, sx), py: off(y, sy) }; this.t0 = performance.now(); this.hint.style.opacity = "0"; this.label(); this.loop();
  }
  private single(cx: number, cy: number) {
    if (this.panel !== -1) return this.go(-1);
    const e = { clientX: cx, clientY: cy };
    const [x, y] = this.toPage(e.clientX, e.clientY), list = this.panels[this.page] ?? [];
    const i = list.findIndex((p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h);
    if (i < 0) return this.zoomAt(cx, cy); // aucune case sous le doigt : zoom à l'endroit touché
    this.go(i);
  }
  private step(d: number) {
    const n = this.panels[this.page]?.length ?? 0, p = Math.max(-1, this.panel) + d;
    if (p >= 0 && p < n) return this.go(p);
    const np = this.page + d; if (np < 0 || np >= this.files.length) { if (this.panel >= 0) this.go(-1); return; }
    void this.showPage(np);
  }
  private setEdit(on: boolean) {
    this.editing = on; if (on && this.panel >= 0) this.go(-1);
    const b = this.bar.querySelector<HTMLElement>("[data-p=edit]")!; b.textContent = on ? "✓" : "✎"; b.setAttribute("aria-label", on ? "Terminer" : "Revoir les cases");
    let m = this.bar.querySelector<HTMLElement>("[data-p=manga]"); if (on && !m) { m = document.createElement("button"); m.dataset.p = "manga"; m.textContent = "⇄"; m.setAttribute("aria-label", "Sens de lecture manga"); this.bar.insertBefore(m, b); } else if (!on) m?.remove();
    this.hint.textContent = on ? "Touchez une case pour la retirer · glissez pour en dessiner une (bulles en bleu)" : "Touchez une case pour zoomer · deux fois pour zoomer où vous voulez"; this.hint.style.opacity = on ? "1" : "0"; this.label(); this.loop();
  }
  private editTap(e: PointerEvent) {
    const [x1, y1] = this.toPage(e.clientX, e.clientY), d = this.down; this.down = null; const list = this.panels[this.page];
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 14) { const [x0, y0] = this.toPage(d.x, d.y), p = { x: Math.max(0, Math.min(x0, x1)), y: Math.max(0, Math.min(y0, y1)), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }; if (p.w > 0.04 && p.h > 0.03) list.push(p); }
    else { const i = list.findIndex((p) => x1 >= p.x && x1 <= p.x + p.w && y1 >= p.y && y1 <= p.y + p.h); if (i >= 0) list.splice(i, 1); }
    this.panels[this.page] = readingOrder(list, this.rtl); this.label();
    try { localStorage.setItem(this.keys[this.page], JSON.stringify({ panels: this.panels[this.page], bubbles: this.bubbles[this.page] })); } catch { /* */ } // correction mémorisée
  }
  private label() { (this.bar.querySelector("[data-p=n]") as HTMLElement).textContent = this.editing ? `${this.panels[this.page]?.length ?? 0} case(s)${this.rtl ? " · manga" : ""}` : `${this.panel >= 0 ? `Case ${this.panel + 1}/${this.panels[this.page]?.length ?? 0}` : this.panel === -2 ? "Zoom" : "Page"} · ${this.page + 1}/${this.files.length}`; }
  /** Boucle : cadrage animé du décor, et contours numérotés (correction, ou 3 s à l'ouverture d'une page, jamais pendant une prise). */
  private loop() {
    cancelAnimationFrame(this.raf);
    const draw = () => {
      if (!this.active) return;
      const v = this.cur(); this.stage.set(v);
      const r = this.tapEl.getBoundingClientRect(), dpr = devicePixelRatio || 1, W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
      if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
      const g = this.cv.getContext("2d")!; g.clearRect(0, 0, W, H);
      const since = (performance.now() - this.shownAt) / 1000, alpha = this.editing ? 1 : this.panel < 0 && !this.recording && since < 3 ? Math.min(1, (3 - since) / 0.6) : 0;
      if (alpha > 0) this.outlines(g, W, H, v, alpha);
      const moving = performance.now() - this.t0 < (this.to.pan ? 700 + PAN_S * 1000 : 700);
      if (moving || alpha > 0) this.raf = requestAnimationFrame(draw);
    };
    draw();
  }
  private outlines(g: CanvasRenderingContext2D, W: number, H: number, v: View, alpha: number) {
    const [sx, sy, ox, oy] = this.stage.cover(v.zoom, v.px, v.py), X = (x: number) => ((x - ox) / sx) * W, Y = (y: number) => ((y - oy) / sy) * H;
    g.save(); g.globalAlpha = alpha; g.lineWidth = Math.max(2, W * 0.006); g.strokeStyle = "#ffd60a"; g.font = `800 ${Math.round(W * 0.05)}px system-ui`; g.textAlign = "center"; g.textBaseline = "middle";
    g.save(); g.setLineDash([W * 0.012, W * 0.01]); g.strokeStyle = "rgba(100,210,255,.95)"; g.lineWidth = Math.max(1.5, W * 0.004); // bulles et cartouches : pointillés bleus (ce ne sont pas des cases)
    for (const b of this.bubbles[this.page] ?? []) { g.beginPath(); (g as any).roundRect ? (g as any).roundRect(X(b.x), Y(b.y), X(b.x + b.w) - X(b.x), Y(b.y + b.h) - Y(b.y), W * 0.02) : g.rect(X(b.x), Y(b.y), X(b.x + b.w) - X(b.x), Y(b.y + b.h) - Y(b.y)); g.stroke(); }
    g.restore();
    (this.panels[this.page] ?? []).forEach((p, i) => {
      g.beginPath(); g.rect(X(p.x), Y(p.y), X(p.x + p.w) - X(p.x), Y(p.y + p.h) - Y(p.y)); g.fillStyle = "rgba(255,214,10,.1)"; g.fill(); g.stroke();
      const cx = X(p.x + p.w / 2), cy = Y(p.y + p.h / 2), rr = W * 0.045; g.fillStyle = "#ffd60a"; g.beginPath(); g.arc(cx, cy, rr, 0, 7); g.fill(); g.fillStyle = "#000"; g.fillText(String(i + 1), cx, cy + 1);
    });
    g.restore();
  }
}

/* ---- Ancien mode (incrustation rejouée au montage) : conservé pour les projets enregistrés avec des gestes ---- */
export interface PresEvent { t: number; page: number; panel: number; target: ZoomTarget | null }
export interface PresData { pages: string[]; events: PresEvent[]; end: number; aspect: number; at: number }
/** Étapes de montage à partir des gestes enregistrés : une incrustation par étape, le cadrage glisse de l'une à l'autre. */
export function presToOverlays(d: PresData, duration: number) {
  const ev = d.events.filter((e) => e.t < duration).sort((a, b) => a.t - b.t), out: { src: string; start: number; end: number; zfrom?: ZoomTarget; zoom?: ZoomTarget; page: number }[] = [];
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i], end = Math.min(duration, ev[i + 1]?.t ?? Math.min(d.end, duration)); if (e.page < 0 || end - e.t < 0.05 || !d.pages[e.page]) continue;
    const prev = out[out.length - 1], same = prev && prev.page === e.page && Math.abs(prev.end - e.t) < 0.06;
    out.push({ src: d.pages[e.page], start: e.t, end, zfrom: same ? prev.zoom : e.target ?? undefined, zoom: e.target ?? undefined, page: e.page });
  }
  return out.map((o, i) => { const a = i > 0 && out[i - 1].page === o.page && Math.abs(out[i - 1].end - o.start) < 0.06, b = i + 1 < out.length && out[i + 1].page === o.page && Math.abs(out[i + 1].start - o.end) < 0.06;
    return { ...o, seq: (a && b ? "mid" : a ? "last" : b ? "first" : "only") as "first" | "mid" | "last" | "only" }; });
}
