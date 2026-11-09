/** TranscriptionEngine (worker) : Whisper via transformers.js, sur l'appareil (WebGPU, sinon WASM). Rien n'est envoyé sur internet
 *  hormis le téléchargement du modèle au premier usage (ensuite en cache). Horodatage par mot : modèle « _timestamped ». */
import { pipeline, env } from "@huggingface/transformers";
import { splitAtSilences } from "../core/audio.ts";
env.allowLocalModels = false; env.useBrowserCache = true;

export const MODELS = { base: "onnx-community/whisper-base_timestamped", tiny: "onnx-community/whisper-tiny_timestamped" } as const;
let asr: any = null, loaded = "";
const post = (m: unknown) => (self as any).postMessage(m);

self.onmessage = async (e: MessageEvent) => {
  const { type, audio, language = "fr", model = "base" } = e.data as { type: "run"; audio: Float32Array; language?: string; model?: keyof typeof MODELS };
  if (type !== "run") return;
  try {
    const id = MODELS[model] ?? MODELS.base;
    if (!asr || loaded !== id) {
      const webgpu = !!(navigator as any).gpu && !!(await (navigator as any).gpu.requestAdapter().catch(() => null));
      const files = new Map<string, { loaded: number; total: number }>();
      const progress_callback = (p: any) => {
        if (p.status === "progress" && p.total) { files.set(p.file, { loaded: p.loaded, total: p.total });
          let a = 0, t = 0; for (const f of files.values()) { a += f.loaded; t += f.total; } post({ type: "download", p: a / t, mb: t / 1e6 }); }
      };
      const make = (device: string, dtype: any) => pipeline("automatic-speech-recognition", id, { device, dtype, progress_callback } as any);
      try { asr = webgpu ? await make("webgpu", { encoder_model: "fp32", decoder_model_merged: "fp32" }) : await make("wasm", "q8"); }
      catch (err) { if (!webgpu) throw err; asr = await make("wasm", "q8"); } // WebGPU présent mais défaillant
      loaded = id; post({ type: "loaded", device: webgpu ? "webgpu" : "wasm" });
    }
    const total = audio.length / 16000, t0 = performance.now();
    // Lots de ≤ 28 s coupés aux silences : progression réelle, aucun mot coupé en deux.
    const words: { text: string; start: number; end: number }[] = []; const b = splitAtSilences(audio, 16000);
    for (let k = 0; k + 1 < b.length; k++) {
      const part = audio.subarray(b[k], b[k + 1]), base = b[k] / 16000;
      if (part.length < 1600) continue; // < 0,1 s
      const out = await asr(part, { language, task: "transcribe", return_timestamps: "word" });
      for (const c of out.chunks ?? []) {
        const text = String(c.text).trim(); if (!text) continue;
        const s = (c.timestamp[0] ?? 0) + base, en = (c.timestamp[1] ?? c.timestamp[0] + 0.3) + base;
        words.push({ text, start: s, end: Math.max(s + 0.02, en) });
      }
      const done = Math.min(total, base + part.length / 16000);
      post({ type: "progress", p: done / total, eta: ((performance.now() - t0) / done) * (total - done) / 1000 });
    }
    post({ type: "done", words });
  } catch (err) { post({ type: "error", message: String((err as Error).message ?? err) }); }
};
