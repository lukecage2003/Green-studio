/** ExportEngine, repli temps réel (navigateurs sans WebCodecs, ou codec non décodable) : rejoue les segments conservés et les
 *  réenregistre via MediaRecorder. L'enregistreur est mis en pause pendant chaque saut, pour ne pas capturer l'image figée. */
import { kept, type Range } from "./timeline.ts";

export async function exportRealtime(video: HTMLVideoElement, duration: number, cuts: Range[], onProgress: (p: number) => void, signal?: AbortSignal): Promise<Blob> {
  const stream: MediaStream = (video as any).captureStream();
  const mime = ["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error("Aucun codec d'export disponible");
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6, audioBitsPerSecond: 192000 }); const parts: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const segs = kept(duration, cuts), total = segs.reduce((s, k) => s + k.end - k.start, 0) || 1; let done = 0;
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  const wasMuted = video.muted; video.muted = false; video.pause();
  try {
    for (const k of segs) {
      video.currentTime = k.start; await new Promise((r) => video.addEventListener("seeked", r, { once: true }));
      await video.play();
      if (rec.state === "inactive") rec.start(1000); else rec.resume();
      await new Promise<void>((res, rej) => {
        const frame = () => {
          if (signal?.aborted) { video.pause(); return rej(new DOMException("Annulé", "AbortError")); }
          if (video.currentTime >= k.end - 0.02 || video.ended) { video.pause(); if (rec.state === "recording") rec.pause(); done += k.end - k.start; return res(); }
          onProgress((done + video.currentTime - k.start) / total);
          requestAnimationFrame(frame); // (pas requestVideoFrameCallback : il ne se déclenche plus en fin de vidéo)
        };
        frame();
      });
    }
  } finally { video.muted = wasMuted; if (rec.state !== "inactive") rec.stop(); }
  await stopped; onProgress(1); return new Blob(parts, { type: mime.split(";")[0] });
}
