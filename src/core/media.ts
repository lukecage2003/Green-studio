/** Lecture et export de vidéos dans le navigateur (WebCodecs via mediabunny). Lit le fichier par morceaux : jamais tout en mémoire. */
import {
  Input, MP4, QTFF, WEBM, MATROSKA, BlobSource, AudioSampleSink, VideoSampleSink, Output, Mp4OutputFormat, WebMOutputFormat,
  BufferTarget, StreamTarget, VideoSampleSource, VideoSample, AudioSampleSource, AudioSample, QUALITY_HIGH,
  getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, type StreamTargetChunk,
} from "mediabunny";
import { kept, type Range } from "./timeline.ts";
import { Resampler, toMono, fadeGain, softLimit } from "./audio.ts";
import { StudioVoice, loadDenoiser } from "./voice.ts";
import { compose, drawTitle, activeAt, type Overlay, type Title } from "./overlay.ts";
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
  /** habillage : extraits (images / vidéos) et bandeaux titres, en temps source */
  dress?: { overlays: Overlay[]; titles: Title[]; images: Map<string, CanvasImageSource>; videos: Map<string, Blob>; accent?: string } | null;
}

export async function exportEdited(file: Blob, cuts: Range[], opts: ExportOptions = {}): Promise<ExportResult> {
  const { onProgress, signal, fade = 0.012, gain = 1, captions = null, maxHeight = 0, voice = false, zoom = null, dress = null } = opts;
  const vidSinks = new Map<string, { input: Input; sink: VideoSampleSink }>();
  const input = new Input({ source: new BlobSource(file), formats: FORMATS });
  let output: Output | null = null;
  try {
    const vt = await input.getPrimaryVideoTrack(), at = await input.getPrimaryAudioTrack();
    if (!vt) throw new Error("Aucune piste vidéo.");
    const duration = await input.computeDuration(), segs = kept(duration, cuts);
    const total = segs.reduce((s, k) => s + k.end - k.start, 0) || 1;
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
    const vsrc = new VideoSampleSource({ codec: vcodec, bitrate, keyFrameInterval: 2 });
    output.addVideoTrack(vsrc);
    const asrc = acodec ? new AudioSampleSource({ codec: acodec, bitrate: 192000 }) : null;
    if (asrc) output.addAudioTrack(asrc);
    await output.start();

    // Passage par un canvas seulement si nécessaire (sous-titres, redimensionnement) : sinon les images vont directement à l'encodeur.
    let cv: OffscreenCanvas | null = null, cx: OffscreenCanvasRenderingContext2D | null = null;
    const viaCanvas = (!!captions && captions.style.preset !== "none" && captions.lines.length > 0) || maxHeight > 0 || !!zoom
      || !!(dress && (dress.overlays.length || dress.titles.length));
    /** Image de l'extrait au temps t (vidéo : lue image par image, à fermer après usage). */
    const overlaySource = async (ov: Overlay, t: number): Promise<{ src: any; close?: () => void } | null> => {
      if (ov.kind === "image") { const im = dress!.images.get(ov.id); return im ? { src: im } : null; }
      const blob = dress!.videos.get(ov.id); if (!blob) return null;
      let e = vidSinks.get(ov.id);
      if (!e) { const input = new Input({ source: new BlobSource(blob), formats: FORMATS }); const tr = await input.getPrimaryVideoTrack(); if (!tr) return null; e = { input, sink: new VideoSampleSink(tr) }; vidSinks.set(ov.id, e); }
      const smp = await e.sink.getSample(Math.max(0, t - ov.start)); return smp ? { src: smp, close: () => smp.close() } : null;
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
    for (const seg of segs) {
      const len = seg.end - seg.start;
      // Vidéo : images du segment, réhorodatées à la suite des précédentes.
      let first = true;
      for await (const s of vsink.samples(seg.start, seg.end)) {
        if (signal?.aborted) { s.close(); throw abortErr(); }
        if (s.timestamp >= seg.end - 1e-4) { s.close(); continue; }
        const t = offset + Math.max(0, s.timestamp - seg.start);
        if (t <= lastV + 1e-4) { s.close(); continue; }
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
          compose(cx!, cv.width, cv.height, s.timestamp, ov, os?.src ?? null, speaker); os?.close?.();
          if (dress) drawTitle(cx!, cv.width, cv.height, s.timestamp, activeAt(dress.titles, s.timestamp), dress.accent);
          if (captions) drawCaption(cx!, 0, 0, cv.width, cv.height, lineAt(captions.lines, s.timestamp), s.timestamp, captions.style);
          o = new VideoSample(cv, { timestamp: t, duration: d }); s.close();
        } else { s.setTimestamp(t); s.setDuration(d); }
        await vsrc.add(o, first ? { keyFrame: true } : undefined); first = false; o.close();
        onProgress?.(Math.min(0.99, (done_ + (t - offset)) / total));
      }
      // Audio : rogné exactement aux bornes du segment, avec fondus.
      if (asink && asrc && voice) await voiceSegment(asink, asrc, seg, len, offset);
      else if (asink && asrc) for await (const s of asink.samples(seg.start, seg.end)) {
        if (signal?.aborted) { s.close(); throw abortErr(); }
        const sr = s.sampleRate, a = Math.max(0, Math.round((seg.start - s.timestamp) * sr)), b = Math.min(s.numberOfFrames, Math.round((seg.end - s.timestamp) * sr));
        if (b <= a) { s.close(); continue; }
        const p = planes(s).map((x) => x.subarray(a, b)), t0 = s.timestamp + a / sr - seg.start, n = b - a;
        for (let i = 0; i < n; i++) { const g = fadeGain(t0 + i / sr, len, fade) * gain; if (g !== 1) for (const x of p) x[i] *= g; }
        if (gain > 1) for (const x of p) for (let i = 0; i < n; i++) x[i] = softLimit(x[i]);
        const data = new Float32Array(n * p.length); p.forEach((x, c) => data.set(x, c * n));
        const out = new AudioSample({ data, format: "f32-planar", numberOfChannels: p.length, sampleRate: sr, timestamp: offset + t0 });
        await asrc.add(out); out.close(); s.close();
      }
      offset += len; done_ += len;
    }
    const vEnd = vs as StudioVoice | null; if (vEnd && asrc) await vEmit(asrc, vEnd.flush()); // fin du flux voix studio
    await output.finalize(); onProgress?.(1);
    const mime = mp4 ? "video/mp4" : "video/webm", raw = await done();
    return { blob: raw.type === mime ? raw : new Blob([raw], { type: mime }), ext, mime, video: vcodec, audio: acodec };
  } catch (e) { await output?.cancel().catch(() => {}); throw e; }
  finally { input.dispose?.(); for (const e of vidSinks.values()) e.input.dispose?.(); }
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
    const vsrc = new VideoSampleSource({ codec: vcodec, bitrate, keyFrameInterval: 2 }); output.addVideoTrack(vsrc);
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
