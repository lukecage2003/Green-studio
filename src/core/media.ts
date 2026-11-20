/** Lecture et export de vidéos dans le navigateur (WebCodecs via mediabunny). Lit le fichier par morceaux : jamais tout en mémoire. */
import {
  Input, MP4, QTFF, WEBM, MATROSKA, BlobSource, AudioSampleSink, VideoSampleSink, Output, Mp4OutputFormat, WebMOutputFormat,
  BufferTarget, StreamTarget, VideoSampleSource, VideoSample, AudioSampleSource, AudioSample, QUALITY_HIGH,
  getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, canEncodeVideo, type StreamTargetChunk,
} from "mediabunny";
import { kept, type Range } from "./timeline.ts";
import { Resampler, toMono, fadeGain, softLimit } from "./audio.ts";
import { StudioVoice, loadDenoiser } from "./voice.ts";
import { compose, drawTitle, activeAt, activeMarks, drawMark, drawProgress, drawLabel, setGlassBlur, clipTime, zoomRect, zoomEase, type Freeze, type Mark, type Overlay, type Title } from "./overlay.ts";
import { lineAt, drawCaption, type CapLine, type CaptionStyle } from "./captions.ts";

const FORMATS = [MP4, QTFF, WEBM, MATROSKA]; // vidéos de téléphone (dont .mov iPhone) : module plus léger que ALL_FORMATS
const abortErr = () => new DOMException("Annulé", "AbortError");
const planes = (s: AudioSample) => {
  const out: Float32Array[] = [];
  for (let c = 0; c < s.numberOfChannels; c++) { const p = new Float32Array(s.numberOfFrames); s.copyTo(p, { planeIndex: c, format: "f32-planar" }); out.push(p); }
  return out;
};

export const webCodecsAvailable = () => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof VideoDecoder !== "undefined";

/** Durée et piste audio d'un fichier. */
export async function probe(file: Blob) {
  const input = new Input({ source: new BlobSource(file), formats: FORMATS });
  try {
    const duration = await input.computeDuration();
    return { duration, hasAudio: !!(await input.getPrimaryAudioTrack()), hasVideo: !!(await input.getPrimaryVideoTrack()) };
  } finally { input.dispose?.(); }
}

/** Extrait la piste audio en mono au taux demandé (16 kHz pour Whisper), sans charger la vidéo en mémoire. */
export async function extractAudio(file: Blob, rate = 16000, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<{ pcm: Float32Array; rate: number }> {
  const input = new Input({ source: new BlobSource(file), formats: FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("Cette vidéo n’a pas de son.");
    const duration = await input.computeDuration(); let rs: Resampler | null = null, expected = 0;
    for await (const s of new AudioSampleSink(track).samples()) {
      if (signal?.aborted) { s.close(); throw abortErr(); }
      rs ??= new Resampler(s.sampleRate, rate);
      const gap = s.timestamp - expected; if (gap > 0.05) rs.pad(gap); // trou dans le flux : on garde l'alignement
      rs.push(toMono(planes(s))); expected = s.timestamp + s.duration; s.close();
      onProgress?.(Math.min(1, expected / (duration || 1)));
    }
    return { pcm: rs ? rs.result() : new Float32Array(0), rate };
  } finally { input.dispose?.(); }
}

/** Extrait audio mono au débit d'origine (écoute avant/après de la voix studio). */
export async function extractClip(file: Blob, start: number, dur: number): Promise<{ pcm: Float32Array; sr: number }> {
  const input = new Input({ source: new BlobSource(file), formats: FORMATS });
  try {
    const t = await input.getPrimaryAudioTrack(); if (!t) throw new Error("Cette vidéo n’a pas de son.");
    const parts: Float32Array[] = []; let sr = 48000;
    for await (const s of new AudioSampleSink(t).samples(start, start + dur)) {
      sr = s.sampleRate; const a = Math.max(0, Math.round((start - s.timestamp) * sr)), b = Math.min(s.numberOfFrames, Math.round((start + dur - s.timestamp) * sr));
      if (b > a) parts.push(toMono(planes(s)).slice(a, b)); s.close();
    }
    const pcm = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { pcm.set(p, k); k += p.length; }
    return { pcm, sr };
  } finally { input.dispose?.(); }
}

export interface ExportResult { blob: Blob; ext: "mp4" | "webm"; mime: string; video: string; audio: string | null }

/** Encodeur matériel du téléphone (S25 : puce vidéo dédiée, plus rapide et moins chaude) s'il accepte ces réglages ; sinon le choix par défaut. */
async function hwOpts(codec: any, w: number, h: number, bitrate: number | typeof QUALITY_HIGH) {
  try { if (await canEncodeVideo(codec, { width: w, height: h, bitrate, hardwareAcceleration: "prefer-hardware" } as any)) return { hardwareAcceleration: "prefer-hardware" as const, latencyMode: "quality" as const }; } catch { /* */ }
  return {};
}

/** Cible d'écriture : fichier OPFS (sur disque) si possible, sinon mémoire. */
async function makeTarget(ext: string, folder = "gs-export") {
  try {
    const root = await navigator.storage.getDirectory(), dir = await root.getDirectoryHandle(folder, { create: true });
    for await (const n of (dir as any).keys()) await dir.removeEntry(n).catch(() => {}); // un seul export conservé : économise le quota
    const name = `export-${Date.now()}.${ext}`, h = await dir.getFileHandle(name, { create: true });
    const w = await h.createWritable();
    return { target: new StreamTarget(w as unknown as WritableStream<StreamTargetChunk>, { chunked: true }), done: async () => h.getFile() as Promise<Blob> };
  } catch {
    const t = new BufferTarget(); return { target: t, done: async () => new Blob([t.buffer!]) };
  }
}

/**
 * Export rapide (plus rapide que le temps réel) : décode uniquement les segments conservés, les réencode bout à bout,
 * avec une image clé à chaque raccord et un court fondu audio de part et d'autre de chaque coupe (pas de « clic »).
 */
export interface ExportOptions {
  onProgress?: (p: number) => void; signal?: AbortSignal;
  fade?: number;                                   // s, fondu à chaque raccord
  gain?: number;                                   // gain audio (volume optimisé), avec limiteur doux
  captions?: { lines: CapLine[]; style: CaptionStyle } | null; // sous-titres incrustés
  maxHeight?: number;                              // ex. 1280 pour un export 720p plus léger
  voice?: boolean;                                 // voix studio : débruitage, égaliseur, compresseur
  zoom?: ((t: number) => number) | null;           // zooms dynamiques : facteur de zoom selon le temps source (1 = aucun)
  intro?: Range | null;                            // accroche : passage rejoué en ouverture, avant le montage
  freezes?: Freeze[];                              // arrêts sur image (temps source), avec zoom éventuel
  transition?: Transition;                         // effet à chaque coupe : flash blanc, coup de zoom, glissé
  aspect?: Aspect;                                 // format de sortie ; si différent de la source : fond flouté
  progress?: boolean;                              // barre de progression fine en haut
  look?: Look;                                     // étalonnage de toute l'image
  /** habillage : extraits (images / vidéos) et bandeaux titres, en temps source */
  dress?: { overlays: Overlay[]; titles: Title[]; marks?: Mark[]; images: Map<string, CanvasImageSource>; videos: Map<string, Blob>; accent?: string } | null;
}

export type Transition = "none" | "flash" | "punch" | "whip";
export type Aspect = "source" | "9:16";
export type Look = "none" | "cine" | "comics" | "noir";
/** Filtres canvas de chaque look (appliqués une fois par image, sur l'image finale). */
export const LOOKS: Record<Look, string> = { none: "none", cine: "contrast(1.1) saturate(1.08) brightness(.98)", comics: "contrast(1.2) saturate(1.38)", noir: "grayscale(1) contrast(1.28)" };
/** Dimensions de sortie (paires) pour un format donné, à partir de la taille d'origine (déjà réduite). */
export function aspectDims(w: number, h: number, a: Aspect = "source"): [number, number] {
  const ev = (x: number) => Math.max(2, Math.round(x / 2) * 2), L = Math.max(w, h);
  if (a === "9:16") return [ev(L * 9 / 16), ev(L)];
  return [w, h];
}

export async function exportEdited(file: Blob, cuts: Range[], opts: ExportOptions = {}): Promise<ExportResult> {
  const { onProgress, signal, fade = 0.012, gain = 1, captions = null, maxHeight = 0, voice = false, zoom = null, dress = null, intro = null, freezes = [], transition = "none", aspect = "source", progress = false, look = "none" } = opts;
  setGlassBlur(true); // l'image filmée est dans le canvas d'export : le verre peut flouter ce qu'il y a derrière
  try { return await exportInner(); } finally { setGlassBlur(false); }
  async function exportInner(): Promise<ExportResult> {
  const vidSinks = new Map<string, { input: Input; sink: VideoSampleSink }>();
  const input = new Input({ source: new BlobSource(file), formats: FORMATS });
  let output: Output | null = null;
  try {
    const vt = await input.getPrimaryVideoTrack(), at = await input.getPrimaryAudioTrack();
    if (!vt) throw new Error("Aucune piste vidéo.");
    const duration = await input.computeDuration(), segs = kept(duration, cuts);
    if (intro && intro.end - intro.start > 0.3) segs.unshift({ start: Math.max(0, intro.start), end: Math.min(duration, intro.end) });
    // arrêts sur image : le segment qui contient l'instant est coupé en deux et l'image figée est insérée entre les deux
    type Item = Range & { fr?: Freeze };
    const items: Item[] = []; const fz = [...freezes].sort((a, b) => a.at - b.at);
    segs.forEach((g, gi) => {
      let a = g.start;
      if (!(gi === 0 && intro)) for (const f of fz) if (f.at > a + 0.02 && f.at < g.end - 0.02) { items.push({ start: a, end: f.at }); items.push({ start: f.at, end: f.at, fr: f }); a = f.at; }
      else if (Math.abs(f.at - g.end) <= 0.02 && f.at > a) { items.push({ start: a, end: g.end }); items.push({ start: g.end, end: g.end, fr: f }); a = g.end; }
      if (g.end - a > 1e-3) items.push({ start: a, end: g.end });
    });
    const total = items.reduce((s, k) => s + (k.fr ? k.fr.dur : k.end - k.start), 0) || 1;
    // MP4/H.264 en priorité (compatible partout : TikTok, Instagram, YouTube), sinon WebM/VP9.
    let vcodec = await getFirstEncodableVideoCodec(["avc"]), mp4 = !!vcodec;
    if (!vcodec) vcodec = await getFirstEncodableVideoCodec(["vp9", "vp8"]);
    if (!vcodec) throw new Error("Aucun encodeur vidéo disponible.");
    const acodec = at ? await getFirstEncodableAudioCodec(mp4 ? ["aac", "opus"] : ["opus"]) : null;
    const ext = mp4 ? "mp4" : "webm", { target, done } = await makeTarget(ext);
    output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(), target });
    // Débit fixe et généreux selon la taille de sortie (le mode « qualité » automatique donnait ~1,6 Mbit/s, trop peu pour du visage + texte).
    const cw = await vt.getCodedWidth(), ch = await vt.getCodedHeight(), outH = Math.min(Math.max(cw, ch), maxHeight > 0 ? maxHeight : Infinity);
    const bitrate = outH >= 2400 ? 24e6 : outH >= 1800 ? 12e6 : outH >= 1200 ? 6e6 : QUALITY_HIGH;
    const [ow, oh] = aspectDims(Math.round(cw * Math.min(1, outH / Math.max(cw, ch)) / 2) * 2, Math.round(ch * Math.min(1, outH / Math.max(cw, ch)) / 2) * 2, aspect);
    const vsrc = new VideoSampleSource({ codec: vcodec, bitrate, keyFrameInterval: 2, ...(await hwOpts(vcodec, ow, oh, bitrate)) });
    output.addVideoTrack(vsrc);
    const asrc = acodec ? new AudioSampleSource({ codec: acodec, bitrate: 192000 }) : null;
    if (asrc) output.addAudioTrack(asrc);
    await output.start();

    // Passage par un canvas seulement si nécessaire (sous-titres, redimensionnement) : sinon les images vont directement à l'encodeur.
    let cv: OffscreenCanvas | null = null, cx: OffscreenCanvasRenderingContext2D | null = null;
    const viaCanvas = (!!captions && captions.style.preset !== "none" && captions.lines.length > 0) || maxHeight > 0 || !!zoom || items.some((i) => i.fr)
      || !!(dress && (dress.overlays.length || dress.titles.length || dress.marks?.length)) || transition !== "none" || aspect !== "source" || progress || look !== "none";
    /* Format de sortie différent de la source : la vidéo est posée au centre sur un fond flouté (la même image agrandie,
       floutée en passant par une toute petite copie — bien moins coûteux qu'un filtre de flou à chaque image). */
    let oc: OffscreenCanvas | null = null, ox: OffscreenCanvasRenderingContext2D | null = null, tiny: OffscreenCanvas | null = null;
    /** Finition d'une image : effet de coupe (début de morceau), puis mise au format. */
    let pOff = 0; // début du morceau en cours, temps de sortie (pour la barre de progression)
    const finish = (local: number, cut: boolean): OffscreenCanvas => {
      const W = cv!.width, H = cv!.height;
      if (cut && transition !== "none" && local < 0.28) {
        const x = local / 0.28;
        if (transition === "flash") { cx!.save(); cx!.globalAlpha = (1 - x) ** 1.5 * 0.92; cx!.fillStyle = "#fff"; cx!.fillRect(0, 0, W, H); cx!.restore(); }
        else if (transition === "punch") { const k = 1 + 0.16 * (1 - x) ** 2; cx!.drawImage(cv!, W * (1 - 1 / k) / 2, H * (1 - 1 / k) / 2, W / k, H / k, 0, 0, W, H); }
        else if (transition === "whip") { const d = W * 0.12 * (1 - x) ** 2; if (d > 1) { cx!.save(); for (let i = 1; i <= 3; i++) { cx!.globalAlpha = 0.3; cx!.drawImage(cv!, -d * i / 3, 0); } cx!.restore(); } }
      }
      if (look !== "none") { // étalonnage : l'image est redessinée sur elle-même à travers le filtre, puis vignettage
        cx!.save(); cx!.filter = LOOKS[look]; cx!.drawImage(cv!, 0, 0); cx!.restore();
        if (look === "cine" || look === "noir") { cx!.save(); const gr = cx!.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.45, W / 2, H * 0.45, Math.max(W, H) * 0.75); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.42)"); cx!.fillStyle = gr; cx!.fillRect(0, 0, W, H); cx!.restore(); }
      }
      if (progress) drawProgress(cx!, W, H, (pOff + local) / Math.max(0.1, total), dress?.accent);
      if (ow === W && oh === H) return cv!;
      if (!oc) { oc = new OffscreenCanvas(ow, oh); ox = oc.getContext("2d")!; tiny = new OffscreenCanvas(Math.max(8, Math.round(W / 24)), Math.max(8, Math.round(H / 24))); }
      const tx = tiny!.getContext("2d")!; tx.drawImage(cv!, 0, 0, tiny!.width, tiny!.height);
      const kc = Math.max(ow / W, oh / H), kf = Math.min(ow / W, oh / H);
      ox!.imageSmoothingQuality = "low"; ox!.drawImage(tiny!, (ow - W * kc) / 2, (oh - H * kc) / 2, W * kc, H * kc);
      ox!.fillStyle = "rgba(0,0,0,.35)"; ox!.fillRect(0, 0, ow, oh); ox!.imageSmoothingQuality = "high";
      ox!.drawImage(cv!, (ow - W * kf) / 2, (oh - H * kf) / 2, W * kf, H * kf);
      return oc;
    };
    /** Image de l'extrait au temps t (vidéo : lue image par image, à fermer après usage). */
    const overlaySource = async (ov: Overlay, t: number): Promise<{ src: any; close?: () => void } | null> => {
      if (ov.kind === "image") { const im = dress!.images.get(ov.id); return im ? { src: im } : null; }
      const blob = dress!.videos.get(ov.id); if (!blob) return null;
      let e = vidSinks.get(ov.id);
      if (!e) { const input = new Input({ source: new BlobSource(blob), formats: FORMATS }); const tr = await input.getPrimaryVideoTrack(); if (!tr) return null; e = { input, sink: new VideoSampleSink(tr) }; vidSinks.set(ov.id, e); }
      const smp = await e.sink.getSample(clipTime(ov, t)); return smp ? { src: smp, close: () => smp.close() } : null;
    };
    const vsink = new VideoSampleSink(vt), asink = at && asrc ? new AudioSampleSink(at) : null;
    let offset = 0, lastV = -1, done_ = 0;
    /* Voix studio en flux : la sortie k correspond à l'entrée k ; l'horodatage suit donc l'entrée. Si le flux d'entrée
       n'est pas continu (trou dans l'audio source), on vide la chaîne et on repart de la nouvelle position. */
    let vs: StudioVoice | null = null, vBase = 0, vFed = 0, vOut = 0, vCh = 1;
    const vEmit = async (src: AudioSampleSource, y: Float32Array) => {
      if (!y.length || !vs) return;
      if (gain !== 1) for (let i = 0; i < y.length; i++) y[i] *= gain;
      for (let i = 0; i < y.length; i++) y[i] = softLimit(y[i]);
      const data = new Float32Array(y.length * vCh); for (let c = 0; c < vCh; c++) data.set(y, c * y.length);
      const out = new AudioSample({ data, format: "f32-planar", numberOfChannels: vCh, sampleRate: vs.sr, timestamp: vBase + vOut / vs.sr });
      vOut += y.length; await src.add(out); out.close();
    };
    const voiceSegment = async (sink: AudioSampleSink, src: AudioSampleSource, seg: Range, len: number, off: number) => {
      for await (const s of sink.samples(seg.start, seg.end)) {
        if (signal?.aborted) { s.close(); throw abortErr(); }
        const sr = s.sampleRate, a = Math.max(0, Math.round((seg.start - s.timestamp) * sr)), b = Math.min(s.numberOfFrames, Math.round((seg.end - s.timestamp) * sr));
        if (b <= a) { s.close(); continue; }
        const p = planes(s).map((x) => x.subarray(a, b)), t0 = s.timestamp + a / sr - seg.start, n = b - a, ts = off + t0; vCh = p.length; s.close();
        const mono = toMono(p).slice(); for (let i = 0; i < n; i++) mono[i] *= fadeGain(t0 + i / sr, len, fade);
        if (!vs || vs.sr !== sr) { if (vs) await vEmit(src, vs.flush()); vs = new StudioVoice(sr, await loadDenoiser()); vBase = ts; vFed = 0; vOut = 0; }
        else if (Math.abs(ts - (vBase + vFed / sr)) > 0.02) { await vEmit(src, vs.flush()); vBase = ts; vFed = 0; vOut = 0; }
        vFed += n; await vEmit(src, vs.process(mono));
      }
    };
    const sr0 = at ? await at.getSampleRate() : 48000, ch0 = at ? await at.getNumberOfChannels() : 1;
    // Décalage de chaque morceau dans la vidéo finale (connu d'avance : l'audio peut avancer en parallèle de l'image)
    const offs: number[] = []; { let o = 0; for (const it of items) { offs.push(o); o += it.fr ? it.fr.dur : it.end - it.start; } }
    /** Son d'un morceau (silence pour un arrêt sur image). */
    const audioItem = async (seg: Item, off: number) => {
      if (!asrc) return;
      if (seg.fr) { const N = Math.round(seg.fr.dur * sr0), out = new AudioSample({ data: new Float32Array(N * ch0), format: "f32-planar", numberOfChannels: ch0, sampleRate: sr0, timestamp: off }); await asrc.add(out); out.close(); return; }
      const len = seg.end - seg.start;
      if (asink && asrc && voice) await voiceSegment(asink, asrc, seg, len, off);
      else if (asink && asrc) for await (const s of asink.samples(seg.start, seg.end)) {
        if (signal?.aborted) { s.close(); throw abortErr(); }
        const sr = s.sampleRate, a = Math.max(0, Math.round((seg.start - s.timestamp) * sr)), b = Math.min(s.numberOfFrames, Math.round((seg.end - s.timestamp) * sr));
        if (b <= a) { s.close(); continue; }
        const p = planes(s).map((x) => x.subarray(a, b)), t0 = s.timestamp + a / sr - seg.start, n = b - a;
        for (let i = 0; i < n; i++) { const g = fadeGain(t0 + i / sr, len, fade) * gain; if (g !== 1) for (const x of p) x[i] *= g; }
        if (gain > 1) for (const x of p) for (let i = 0; i < n; i++) x[i] = softLimit(x[i]);
        const data = new Float32Array(n * p.length); p.forEach((x, c) => data.set(x, c * n));
        const out = new AudioSample({ data, format: "f32-planar", numberOfChannels: p.length, sampleRate: sr, timestamp: off + t0 });
        await asrc.add(out); out.close(); s.close();
      }
    };
    // Image et son traités EN MÊME TEMPS : pendant que la puce vidéo encode, le processeur prépare le son (voix studio comprise).
    let audioErr: unknown = null;
    const audioTask = (async () => { for (let i = 0; i < items.length; i++) { if (audioErr) return; await audioItem(items[i], offs[i]); }
      const vEnd = vs as StudioVoice | null; if (vEnd && asrc) await vEmit(asrc, vEnd.flush()); })().catch((e) => { audioErr = e; });
    /** Une image source du morceau `seg` (placé à `offset` dans la vidéo finale) : habillage éventuel, puis encodage. */
    /* Texte d'accroche géant : avec une accroche rejouée en ouverture, il s'affiche pendant cette ouverture (et pas plus loin). */
    const hasIntro = !!intro && intro.end - intro.start > 0.3;
    const titleAt = (ts: number, local: number, inIntro: boolean): [Title | null, number] => {
      if (!dress) return [null, ts];
      if (inIntro) { const h = dress.titles.find((x) => x.kind === "hook"); if (h) return [h, h.start + local]; }
      return [activeAt(hasIntro ? dress.titles.filter((x) => x.kind !== "hook") : dress.titles, ts), ts];
    };
    const frameOut = async (s: VideoSample, seg: Range, offset: number, first: boolean): Promise<boolean> => {
        const t = offset + Math.max(0, s.timestamp - seg.start);
        if (t <= lastV + 1e-4) { s.close(); return false; }
        lastV = t; let o: VideoSample = s;
        // durée bornée au segment : sinon, avec une source saccadée (peu d'images/s), la dernière image d'un segment
        // déborderait au-delà de la coupe et allongerait la vidéo exportée
        const d = Math.max(1e-3, Math.min(s.timestamp + s.duration, seg.end) - Math.max(s.timestamp, seg.start));
        if (viaCanvas) {
          if (!cv) { const k = maxHeight > 0 ? Math.min(1, maxHeight / s.displayHeight) : 1;
            cv = new OffscreenCanvas(Math.round(s.displayWidth * k / 2) * 2, Math.round(s.displayHeight * k / 2) * 2); cx = cv.getContext("2d")!; }
          const z = zoom ? zoom(s.timestamp) : 1;
          /** La personne (image filmée, zoom éventuel) dans le rectangle donné. */
          const speaker = (x: number, y: number, w: number, h: number) => {
            if (z > 1.001 && !s.rotation) { // zoom centré sur le haut du cadre (le visage) : on dessine une partie de l'image
              const sw = s.displayWidth / z, sh = s.displayHeight / z;
              s.draw(cx!, (s.displayWidth - sw) / 2, (s.displayHeight - sh) * 0.3, sw, sh, x, y, w, h);
            } else if (x === 0 && y === 0 && w === cv!.width && h === cv!.height) s.drawWithFit(cx!, { fit: "fill" });
            else s.draw(cx!, x, y, w, h);
          };
          const ov = dress ? activeAt(dress.overlays, s.timestamp) : null, os = ov ? await overlaySource(ov, s.timestamp) : null;
          compose(cx!, cv.width, cv.height, s.timestamp, ov, os?.src ?? null, speaker, ov?.with ? (dress!.images.get(ov.with) as any) ?? null : null); os?.close?.(); if (ov) drawLabel(cx!, cv.width, cv.height, s.timestamp, ov, dress?.accent);
          if (dress) { const [ti, tt] = titleAt(s.timestamp, t - offset, hasIntro && seg === items[0]); drawTitle(cx!, cv.width, cv.height, tt, ti, dress.accent); for (const m of activeMarks(dress.marks ?? [], s.timestamp)) drawMark(cx!, cv.width, cv.height, s.timestamp, m); }
          if (captions) drawCaption(cx!, 0, 0, cv.width, cv.height, lineAt(captions.lines, s.timestamp), s.timestamp, captions.style);
          pOff = offset; o = new VideoSample(finish(t - offset, offset > 0), { timestamp: t, duration: d }); s.close();
        } else { s.setTimestamp(t); s.setDuration(d); }
        await vsrc.add(o, first ? { keyFrame: true } : undefined); o.close();
        onProgress?.(Math.min(0.99, t / total));
        return true;
    };
    for (let ii = 0; ii < items.length; ii++) {
      const seg = items[ii]; offset = offs[ii];
      if (audioErr) throw audioErr;
      if (seg.fr) { // image figée (dernière image avant l'instant), 30 i/s, zoom progressif ; son coupé
        const f = seg.fr, s = await vsink.getSample(Math.max(0, f.at - 0.02)); if (!s) continue;
        if (!cv) { const k = maxHeight > 0 ? Math.min(1, maxHeight / s.displayHeight) : 1;
          cv = new OffscreenCanvas(Math.round(s.displayWidth * k / 2) * 2, Math.round(s.displayHeight * k / 2) * 2); cx = cv.getContext("2d")!; }
        const n = Math.max(1, Math.round(f.dur * 30)), ov = dress ? activeAt(dress.overlays, f.at) : null, os = ov ? await overlaySource(ov, f.at) : null;
        for (let k = 0; k < n; k++) {
          if (signal?.aborted) { s.close(); os?.close?.(); throw abortErr(); }
          const zk = zoomEase(k / 30);
          const speaker = (x: number, y: number, w: number, h: number) => { const r = zoomRect(s.displayWidth, s.displayHeight, w, h, f.zoom, zk); s.draw(cx!, r.sx, r.sy, r.sw, r.sh, x, y, w, h); };
          cx!.clearRect(0, 0, cv.width, cv.height);
          compose(cx!, cv.width, cv.height, f.at, ov, os?.src ?? null, speaker, ov?.with ? (dress!.images.get(ov.with) as any) ?? null : null); if (ov) drawLabel(cx!, cv.width, cv.height, f.at, ov, dress?.accent);
          if (dress) { drawTitle(cx!, cv.width, cv.height, f.at, activeAt(dress.titles, f.at), dress.accent); for (const m of activeMarks(dress.marks ?? [], f.at)) drawMark(cx!, cv.width, cv.height, f.at + k / 30, m); }
          if (captions) drawCaption(cx!, 0, 0, cv.width, cv.height, lineAt(captions.lines, f.at), f.at, captions.style);
          pOff = offset; const o = new VideoSample(finish(k / 30, offset > 0), { timestamp: offset + k / 30, duration: 1 / 30 }); await vsrc.add(o, k === 0 ? { keyFrame: true } : undefined); o.close();
        }
        s.close(); os?.close?.(); lastV = offset + (n - 1) / 30;
        onProgress?.(Math.min(0.99, (offset + f.dur) / total)); continue;
      }
      // Vidéo : morceaux consécutifs (dans l'ordre du temps) décodés en UN seul passage — sans repartir de l'image clé
      // précédente à chaque coupe (≈ 25 à 40 % de décodage en moins avec un montage serré) ; les parties coupées sont sautées.
      let jj = ii; while (jj + 1 < items.length && !items[jj + 1].fr && items[jj + 1].start >= items[jj].end - 1e-4) jj++;
      let pi = ii, first = true, pend: VideoSample | null = null; // pend : dernière image AVANT le morceau (elle couvre son début)
      try {
        for await (const s of vsink.samples(items[ii].start, items[jj].end)) {
          if (signal?.aborted) { s.close(); throw abortErr(); }
          if (audioErr) { s.close(); throw audioErr; }
          while (pi <= jj && s.timestamp >= items[pi].end - 1e-4) {
            // morceau sans image propre (source à très peu d'images/s) : l'image qui le couvre est montrée
            if (first && pend && pend.timestamp < items[pi].end - 1e-4) { await frameOut(pend, items[pi], offs[pi], true); pend = null; }
            pi++; first = true; pend?.close(); pend = null;
          }
          if (pi > jj) { s.close(); break; }
          const it = items[pi];
          if (s.timestamp < it.start - 1e-4) { pend?.close(); pend = s; continue; } // partie coupée (gardée de côté : elle peut couvrir le début)
          if (first && pend && s.timestamp > it.start + 1e-4) { if (await frameOut(pend, it, offs[pi], true)) first = false; pend = null; }
          else { pend?.close(); pend = null; }
          if (await frameOut(s, it, offs[pi], first)) first = false;
        }
        if (pi <= jj && first && pend) { await frameOut(pend, items[pi], offs[pi], true); pend = null; }
      } finally { pend?.close(); }
      ii = jj;
    }
    await audioTask; if (audioErr) throw audioErr; // fin du son (et du flux voix studio)
    await output.finalize(); onProgress?.(1);
    const mime = mp4 ? "video/mp4" : "video/webm", raw = await done();
    return { blob: raw.type === mime ? raw : new Blob([raw], { type: mime }), ext, mime, video: vcodec, audio: acodec };
  } catch (e) { await output?.cancel().catch(() => {}); throw e; }
  finally { input.dispose?.(); for (const e of vidSinks.values()) e.input.dispose?.(); }
}
}

/**
 * Assemble plusieurs prises bout à bout en une seule vidéo (dans l'ordre donné), prête pour le montage.
 * Taille de la première prise ; une prise d'une autre taille est cadrée sans déformation (bandes noires si besoin).
 * Fondu audio très court à chaque raccord (pas de « clic »), image clé au début de chaque prise.
 */
export async function concatVideos(files: Blob[], opts: { onProgress?: (p: number) => void; signal?: AbortSignal } = {}): Promise<ExportResult> {
  const { onProgress, signal } = opts;
  if (files.length < 2) throw new Error("Choisissez au moins deux prises.");
  const inputs = files.map((f) => new Input({ source: new BlobSource(f), formats: FORMATS }));
  let output: Output | null = null;
  try {
    const info = await Promise.all(inputs.map(async (i) => ({ vt: await i.getPrimaryVideoTrack(), at: await i.getPrimaryAudioTrack(), dur: await i.computeDuration() })));
    const v0 = info[0].vt; if (!v0 || info.some((x) => !x.vt)) throw new Error("Une des prises n’a pas d’image.");
    const W = await v0.getDisplayWidth(), H = await v0.getDisplayHeight(), total = info.reduce((s, x) => s + x.dur, 0) || 1;
    let vcodec = await getFirstEncodableVideoCodec(["avc"]), mp4 = !!vcodec;
    if (!vcodec) vcodec = await getFirstEncodableVideoCodec(["vp9", "vp8"]);
    if (!vcodec) throw new Error("Aucun encodeur vidéo disponible.");
    const hasAudio = info.some((x) => x.at), acodec = hasAudio ? await getFirstEncodableAudioCodec(mp4 ? ["aac", "opus"] : ["opus"]) : null;
    const ext = mp4 ? "mp4" : "webm", { target, done } = await makeTarget(ext, "gs-asm"); // dossier à part : un export ne l'efface pas
    output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(), target });
    const outH = Math.max(W, H), bitrate = outH >= 2400 ? 24e6 : outH >= 1800 ? 12e6 : outH >= 1200 ? 6e6 : QUALITY_HIGH;
    const vsrc = new VideoSampleSource({ codec: vcodec, bitrate, keyFrameInterval: 2, ...(await hwOpts(vcodec, W, H, bitrate)) }); output.addVideoTrack(vsrc);
    const asrc = acodec ? new AudioSampleSource({ codec: acodec, bitrate: 192000 }) : null; if (asrc) output.addAudioTrack(asrc);
    await output.start();
    const a0 = info.find((x) => x.at)?.at ?? null, SR = a0 ? await a0.getSampleRate() : 48000, CH = a0 ? Math.min(2, await a0.getNumberOfChannels()) : 2;
    let cv: OffscreenCanvas | null = null, cx: OffscreenCanvasRenderingContext2D | null = null, offset = 0;
    for (let k = 0; k < files.length; k++) {
      const { vt, at, dur } = info[k];
      const same = (await vt!.getDisplayWidth()) === W && (await vt!.getDisplayHeight()) === H;
      let first = true, prev: VideoSample | null = null;
      // chaque image dure jusqu'à la suivante ; la dernière jusqu'à la fin de la prise (pas de trou au raccord)
      const emit = async (s: VideoSample, end: number) => {
        const ts = Math.max(0, s.timestamp), t = offset + ts, d = Math.max(1 / 240, Math.min(end, dur) - ts);
        let o: VideoSample = s;
        if (!same) {
          if (!cv) { cv = new OffscreenCanvas(W, H); cx = cv.getContext("2d")!; }
          cx!.fillStyle = "#000"; cx!.fillRect(0, 0, W, H); s.drawWithFit(cx!, { fit: "contain" });
          o = new VideoSample(cv, { timestamp: t, duration: d }); s.close();
        } else { s.setTimestamp(t); s.setDuration(d); }
        await vsrc.add(o, first ? { keyFrame: true } : undefined); first = false; o.close();
        onProgress?.(Math.min(0.99, (offset + ts) / total));
      };
      for await (const s of new VideoSampleSink(vt!).samples(0, dur)) {
        if (signal?.aborted) { s.close(); prev?.close(); throw abortErr(); }
        if (prev) await emit(prev, Math.max(0, s.timestamp)); prev = s;
      }
      if (prev) await emit(prev, dur);
      if (asrc) {
        if (at) for await (const s of new AudioSampleSink(at).samples(0, dur)) {
          if (signal?.aborted) { s.close(); throw abortErr(); }
          const sr = s.sampleRate, src = planes(s), n0 = s.numberOfFrames, t0 = Math.max(0, s.timestamp); s.close();
          const n = sr === SR ? n0 : Math.floor(n0 * SR / sr); if (n <= 0) continue;
          const data = new Float32Array(n * CH);
          for (let c = 0; c < CH; c++) { const x = src[Math.min(c, src.length - 1)], y = data.subarray(c * n, (c + 1) * n);
            for (let i = 0; i < n; i++) { const p = sr === SR ? i : (i * sr) / SR, j = Math.floor(p), f = p - j; y[i] = j + 1 < n0 ? x[j] * (1 - f) + x[j + 1] * f : x[Math.min(j, n0 - 1)];
              y[i] *= fadeGain(t0 + i / SR, dur, 0.012); } }
          const out = new AudioSample({ data, format: "f32-planar", numberOfChannels: CH, sampleRate: SR, timestamp: offset + t0 });
          await asrc.add(out); out.close();
        } else { // prise sans son : silence, pour garder l'audio synchronisé
          for (let t = 0; t < dur; t += 1) { const n = Math.round(Math.min(1, dur - t) * SR); if (n <= 0) break;
            const out = new AudioSample({ data: new Float32Array(n * CH), format: "f32-planar", numberOfChannels: CH, sampleRate: SR, timestamp: offset + t }); await asrc.add(out); out.close(); }
        }
      }
      offset += dur;
    }
    await output.finalize(); onProgress?.(1);
    const mime = mp4 ? "video/mp4" : "video/webm", raw = await done();
    return { blob: raw.type === mime ? raw : new Blob([raw], { type: mime }), ext, mime, video: vcodec, audio: acodec };
  } catch (e) { await output?.cancel().catch(() => {}); throw e; }
  finally { for (const i of inputs) i.dispose?.(); }
}
