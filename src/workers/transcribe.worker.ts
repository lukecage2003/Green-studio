/** TranscriptionEngine (worker) : Whisper via transformers.js, sur l'appareil (WebGPU, sinon WASM). Rien n'est envoyé sur internet
 *  hormis le téléchargement du modèle au premier usage (ensuite en cache). Horodatage par mot : modèle « _timestamped ». */
import { pipeline, env } from "@huggingface/transformers";
import { splitAtSilences } from "../core/audio.ts";
import { spreadSegment } from "../core/captions.ts";
import { verbatimPrompt, verbatimFailed } from "../core/verbatim.ts";
env.allowLocalModels = false; env.useBrowserCache = true;

export const MODELS = {
  small: "onnx-community/whisper-small_timestamped", // le plus fidèle en français (bégaiements, mots courts) — idéal avec WebGPU
  base: "onnx-community/whisper-base_timestamped",
  tiny: "onnx-community/whisper-tiny_timestamped",
} as const;
type ModelKey = keyof typeof MODELS | "auto";
let asr: any = null, loaded = "", vp: ReturnType<typeof verbatimPrompt> | null = null;
const resolved: Record<string, string> = {}; // modèle demandé → modèle réellement chargé (après un repli : on ne retente pas à chaque fois)
const post = (m: unknown) => (self as any).postMessage(m);

/** Fin de la dernière parole dans un extrait (trames de 20 ms au-dessus de 10 % du niveau de crête). */
function lastVoice(x: Float32Array): number {
  const fr = 320, n = Math.floor(x.length / fr), r = new Float32Array(n); let pk = 0;
  for (let k = 0; k < n; k++) { let a = 0; for (let i = k * fr; i < (k + 1) * fr; i++) a += x[i] * x[i]; r[k] = Math.sqrt(a / fr); if (r[k] > pk) pk = r[k]; }
  for (let k = n - 1; k >= 0; k--) if (r[k] > Math.max(0.01, pk * 0.1)) return ((k + 1) * fr) / 16000;
  return 0;
}

self.onmessage = async (e: MessageEvent) => {
  const { type, audio, language = "fr", model = "auto", translate = false, verbatim = true, host = "" } = e.data as { type: "run"; audio: Float32Array; language?: string; model?: ModelKey; translate?: boolean; verbatim?: boolean; host?: string };
  if (host) env.remoteHost = host; // autre source pour les modèles (miroir local, tests)
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
      try { vp = verbatimPrompt(asr, language); } catch { vp = null; } // mot pour mot (amorce) si le modèle le permet
      post({ type: "loaded", device: webgpu ? "webgpu" : "wasm", model: loaded.replace(/^.*whisper-|_timestamped$/g, "") });
    }
    const total = audio.length / 16000, t0 = performance.now();
    // Lots de ≤ 28 s coupés aux silences : progression réelle, aucun mot coupé en deux.
    const words: { text: string; start: number; end: number }[] = []; const b = splitAtSilences(audio, 16000);
    for (let k = 0; k + 1 < b.length; k++) {
      const part = audio.subarray(b[k], b[k + 1]), base = b[k] / 16000;
      if (part.length < 1600) continue; // < 0,1 s
      if (translate) { // traduction vers l'anglais : horodatage par phrase, réparti ensuite sur les mots
        const out = await asr(part, { language, task: "translate", return_timestamps: true });
        const segs = out.chunks?.length ? out.chunks : [{ text: out.text, timestamp: [0, part.length / 16000] }];
        for (const c of segs) { const s0 = (c.timestamp[0] ?? 0) + base, s1 = (c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 2) + base; words.push(...spreadSegment(String(c.text), s0, Math.min(s1, base + part.length / 16000))); }
        const done = Math.min(total, base + part.length / 16000); post({ type: "progress", p: done / total, eta: ((performance.now() - t0) / done) * (total - done) / 1000 }); continue;
      }
      const opts = { language, task: "transcribe", return_timestamps: "word" };
      let out: any = null;
      if (verbatim && vp) { // mot pour mot : « euh », répétitions et faux départs écrits ; repli sans amorce si décrochage
        try { out = await vp.run(part, opts);
          const ws = (out.chunks ?? []).filter((c: any) => String(c.text).trim()).map((c: any) => ({ text: String(c.text), start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? c.timestamp[0] ?? 0 }));
          if (verbatimFailed(ws, vp.promptWords, lastVoice(part))) out = null;
        } catch { out = null; }
      }
      if (!out) out = await asr(part, opts);
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
