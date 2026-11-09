/** TranscriptionEngine (worker) — NON TESTÉ ici (pas de réseau/GPU). Whisper via transformers.js, WebGPU puis repli WASM. */
import { pipeline, env } from "@huggingface/transformers";
env.allowLocalModels = false; env.useBrowserCache = true;
let asr: any = null, model = "";
self.onmessage = async (e: MessageEvent) => {
  const { type, audio, language, modelId } = e.data as { type: "run"; audio: Float32Array; language: string; modelId?: string };
  if (type !== "run") return;
  try {
    const id = modelId ?? "onnx-community/whisper-base";
    if (!asr || model !== id) {
      const device = (navigator as any).gpu ? "webgpu" : "wasm";
      asr = await pipeline("automatic-speech-recognition", id, { device, dtype: device === "webgpu" ? "fp32" : "q8",
        progress_callback: (p: unknown) => (self as any).postMessage({ type: "progress", p }) } as any);
      model = id;
    }
    const out = await asr(audio, { language, task: "transcribe", return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5 });
    const words = (out.chunks ?? []).map((c: any) => ({ text: String(c.text).trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }));
    (self as any).postMessage({ type: "done", words });
  } catch (err) { (self as any).postMessage({ type: "error", message: String((err as Error).message) }); }
};
