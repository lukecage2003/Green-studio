/** TranscriptionEngine (worker) : Whisper via transformers.js, sur l'appareil (WebGPU, sinon WASM). Rien n'est envoyé sur internet
 *  hormis le téléchargement du modèle au premier usage (ensuite en cache). Horodatage par mot : modèle « _timestamped ». */
import { pipeline, env } from "@huggingface/transformers";
import { splitAtSilences } from "../core/audio.ts";
env.allowLocalModels = false; env.useBrowserCache = true;

export const MODELS = {
  small: "onnx-community/whisper-small_timestamped", // le plus fidèle en français (bégaiements, mots courts) — idéal avec WebGPU
  base: "onnx-community/whisper-base_timestamped",
  tiny: "onnx-community/whisper-tiny_timestamped",
} as const;
type ModelKey = keyof typeof MODELS | "auto";
let asr: any = null, loaded = "";
const resolved: Record<string, string> = {}; // modèle demandé → modèle réellement chargé (après un repli : on ne retente pas à chaque fois)
const post = (m: unknown) => (self as any).postMessage(m);

self.onmessage = async (e: MessageEvent) => {
  const { type, audio, language = "fr", model = "auto" } = e.data as { type: "run"; audio: Float32Array; language?: string; model?: ModelKey };
  if (type !== "run") return;
  try {
    const adapter = (navigator as any).gpu ? await (navigator as any).gpu.requestAdapter().catch(() => null) : null, webgpu = !!adapter;
    const f16 = !!adapter?.features?.has?.("shader-f16");
    // Auto : « small » avec le GPU (rapide et précis), « base » sur processeur seul (small y serait trop lent).
    const key = model === "auto" ? (webgpu ? "small" : "base") : model, id = MODELS[key] ?? MODELS.base;
    if (!asr || loaded !== (resolved[id] ?? id)) {
      const files = new Map<string, { loaded: number; total: number }>();
      const progress_callback = (p: any) => {
        if (p.status === "progress" && p.total) { files.set(p.file, { loaded: p.loaded, total: p.total });
          let a = 0, t = 0; for (const f of files.values()) { a += f.loaded; t += f.total; } post({ type: "download", p: a / t, mb: t / 1e6 }); }
      };
      const make = (mid: string, device: string, dtype: any) => pipeline("automatic-speech-recognition", mid, { device, dtype, progress_callback } as any);
      const gpuDtype = key === "small" ? (f16 ? { encoder_model: "fp16", decoder_model_merged: "q4f16" } : { encoder_model: "fp32", decoder_model_merged: "q4" })
        : { encoder_model: "fp32", decoder_model_merged: "fp32" };
      let used = id;
      try { asr = webgpu ? await make(id, "webgpu", gpuDtype) : await make(id, "wasm", "q8"); }
      catch (err) {
        if (webgpu) { try { asr = await make(id, "wasm", "q8"); } catch { asr = null; } } // WebGPU présent mais défaillant
        if (!asr && id !== MODELS.base) { asr = await make(MODELS.base, "wasm", "q8"); used = MODELS.base; } // dernier recours
        if (!asr) throw err;
      }
      loaded = used; resolved[id] = used;
      post({ type: "loaded", device: webgpu ? "webgpu" : "wasm", model: loaded.replace(/^.*whisper-|_timestamped$/g, "") });
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
