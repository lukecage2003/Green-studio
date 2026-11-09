/** ExportEngine (repli temps réel) — NON TESTÉ ici. Rejoue les segments conservés et les réenregistre via MediaRecorder.
 *  Limite : durée d'export = durée du montage, et réencodage. Un export WebCodecs + muxer reste à écrire. */
import { kept, type Range } from "./timeline.ts";

export async function exportRealtime(video: HTMLVideoElement, duration: number, cuts: Range[], onProgress: (p: number) => void, signal?: AbortSignal): Promise<Blob> {
  const stream: MediaStream = (video as any).captureStream();
  const mime = ["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error("Aucun codec d'export disponible");
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6, audioBitsPerSecond: 192000 }); const parts: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const segs = kept(duration, cuts), total = segs.reduce((s, k) => s + k.end - k.start, 0); let done = 0;
  const stopped = new Promise<void>((r) => (rec.onstop = () => r())); rec.start(1000);
  for (const k of segs) {
    video.currentTime = k.start; await new Promise((r) => (video.onseeked = () => r(null))); await video.play();
    await new Promise<void>((res, rej) => { const tick = () => {
      if (signal?.aborted) { video.pause(); return rej(new Error("annulé")); }
      if (video.currentTime >= k.end) { video.pause(); done += k.end - k.start; return res(); }
      onProgress((done + video.currentTime - k.start) / total); requestAnimationFrame(tick); }; tick(); });
  }
  rec.stop(); await stopped; onProgress(1); return new Blob(parts, { type: mime.split(";")[0] });
}
