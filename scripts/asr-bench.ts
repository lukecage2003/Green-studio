/**
 * Banc d'essai de la transcription, avec le MÊME code que l'app (transformers.js, Whisper ONNX, lots coupés aux silences).
 * Usage : node --experimental-strip-types scripts/asr-bench.ts <dossier des modèles> <modèle> <fichier audio .f32 16 kHz mono>... [--prompt]
 * Écrit les mots horodatés (JSON) à côté de chaque fichier audio.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pipeline, env, StoppingCriteria } from "@huggingface/transformers";
import { splitAtSilences } from "../src/core/audio.ts";
import { verbatimPrompt, verbatimFailed, guardLoops } from "../src/core/verbatim.ts";

const [root, model, ...rest] = process.argv.slice(2);
const files = rest.filter((x) => !x.startsWith("--")), usePrompt = rest.includes("--prompt");
env.localModelPath = root; env.allowRemoteModels = false; env.allowLocalModels = true;
const asr: any = await pipeline("automatic-speech-recognition", model, { dtype: "q8", device: "cpu" } as any);
guardLoops(asr, { StoppingCriteria });
const text = rest.find((x) => x.startsWith("--text="))?.slice(7);
const vp = usePrompt ? verbatimPrompt(asr, "fr", text) : null;
const vocab = rest.find((x) => x.startsWith("--vocab="))?.slice(8).split(",") ?? []; if (vp && vocab.length) vp.setVocab(vocab);
for (const f of files) {
  const b = readFileSync(f), audio = new Float32Array(b.buffer, b.byteOffset, b.length / 4), t0 = performance.now();
  const words: { text: string; start: number; end: number }[] = []; const cut = splitAtSilences(audio, 16000);
  for (let k = 0; k + 1 < cut.length; k++) {
    const part = audio.subarray(cut[k], cut[k + 1]), base = cut[k] / 16000; if (part.length < 1600) continue;
    const opts: any = { language: "fr", task: "transcribe", return_timestamps: "word" };
    let out: any = vp ? await vp.run(part, opts) : await asr(part, opts);
    if (vp) { const ws = (out.chunks ?? []).filter((c: any) => String(c.text).trim()).map((c: any) => ({ text: String(c.text), start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? c.timestamp[0] ?? 0 }));
      if (verbatimFailed(ws, vp.promptWords, part.length / 16000 - 1)) { console.log("  (décrochage détecté : passage retranscrit en classique)"); out = await asr(part, opts); } }
    for (const c of out.chunks ?? []) { const text = String(c.text).trim(); if (!text) continue;
      const s = (c.timestamp[0] ?? 0) + base, e = (c.timestamp[1] ?? c.timestamp[0] + 0.3) + base; words.push({ text, start: +s.toFixed(2), end: +Math.max(s + 0.02, e).toFixed(2) }); }
  }
  writeFileSync(f + `.${model}${usePrompt ? ".prompt" : ""}.json`, JSON.stringify(words));
  console.log(`${f.split("/").pop()} [${model}${usePrompt ? " + amorce" : ""}] ${((performance.now() - t0) / 1000).toFixed(1)} s :`, words.map((w) => `${w.text}[${w.start.toFixed(2)}]`).join(" "));
}
