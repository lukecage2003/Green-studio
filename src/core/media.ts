/** Lecture et export de vidéos dans le navigateur (WebCodecs via mediabunny). Lit le fichier par morceaux : jamais tout en mémoire. */
import {
  Input, MP4, QTFF, WEBM, MATROSKA, BlobSource, AudioSampleSink, VideoSampleSink, Output, Mp4OutputFormat, WebMOutputFormat,
  BufferTarget, StreamTarget, VideoSampleSource, VideoSample, AudioSampleSource, AudioSample, QUALITY_HIGH,
  getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, type StreamTargetChunk,
} from "mediabunny";
import { kept, type Range } from "./timeline.ts";
import { Resampler, toMono, fadeGain, softLimit } from "./audio.ts";
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

export interface ExportResult { blob: Blob; ext: "mp4" | "webm"; mime: string; video: string; audio: string | null }

/** Cible d'écriture : fichier OPFS (sur disque) si possible, sinon mémoire. */
async function makeTarget(ext: string) {
  try {
    const root = await navigator.storage.getDirectory(), dir = await root.getDirectoryHandle("gs-export", { create: true });
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
}

export async function exportEdited(file: Blob, cuts: Range[], opts: ExportOptions = {}): Promise<ExportResult> {
  const { onProgress, signal, fade = 0.012, gain = 1, captions = null, maxHeight = 0 } = opts;
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
    const viaCanvas = (!!captions && captions.style.preset !== "none" && captions.lines.length > 0) || maxHeight > 0;
    const vsink = new VideoSampleSink(vt), asink = at && asrc ? new AudioSampleSink(at) : null;
    let offset = 0, lastV = -1, done_ = 0;
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
          s.drawWithFit(cx!, { fit: "fill" });
          if (captions) drawCaption(cx!, 0, 0, cv.width, cv.height, lineAt(captions.lines, s.timestamp), s.timestamp, captions.style);
          o = new VideoSample(cv, { timestamp: t, duration: d }); s.close();
        } else { s.setTimestamp(t); s.setDuration(d); }
        await vsrc.add(o, first ? { keyFrame: true } : undefined); first = false; o.close();
        onProgress?.(Math.min(0.99, (done_ + (t - offset)) / total));
      }
      // Audio : rogné exactement aux bornes du segment, avec fondus.
      if (asink && asrc) for await (const s of asink.samples(seg.start, seg.end)) {
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
    await output.finalize(); onProgress?.(1);
    const mime = mp4 ? "video/mp4" : "video/webm", raw = await done();
    return { blob: raw.type === mime ? raw : new Blob([raw], { type: mime }), ext, mime, video: vcodec, audio: acodec };
  } catch (e) { await output?.cancel().catch(() => {}); throw e; }
  finally { input.dispose?.(); }
}
