/**
 * Banc d'essai du nettoyage : mots horodatés (JSON) + audio réel (.f32 16 kHz) → coupes (mêmes règles que « Tout supprimer »)
 * → audio monté (.cut.f32), et liste de ce qui est coupé.
 * Usage : node --experimental-strip-types scripts/clean-bench.ts <audio.f32> <mots.json> [punchy|natural|calm]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { analyze, analyzeAudio, RHYTHM, cleanTranscript, snapToQuiet, withBounds, tightenWords, dropCrumbs, type Suggestion } from "../src/core/speech-analysis.ts";
import { normalize, kept } from "../src/core/timeline.ts";

const [audioF, wordsF, rh = "punchy"] = process.argv.slice(2);
const b = readFileSync(audioF), pcm = new Float32Array(b.buffer, b.byteOffset, b.length / 4), dur = pcm.length / 16000;
const words = tightenWords(cleanTranscript(JSON.parse(readFileSync(wordsF, "utf8"))), pcm, 16000);
const R = RHYTHM[rh as keyof typeof RHYTHM], t = analyze(words, { longSilence: R.longSilence, keepPause: R.keepPause }), a = analyzeAudio(words, pcm, 16000, t);
const sugs: Suggestion[] = [...t, ...a].sort((x, y) => x.range.start - y.range.start);
const mode = (s: Suggestion) => (s.id.startsWith("swallowed-") || (/avant «/.test(s.excerpt) && s.type === "long_silence") ? "pre" : s.type === "long_silence" ? "both" : "out") as any;
for (const s of sugs) console.log(`${s.confidence >= 0.5 ? "✂" : "·"} ${s.range.start.toFixed(2)}–${s.range.end.toFixed(2)} ${s.type.padEnd(13)} ${s.excerpt.slice(0, 50)}`);
const cuts = dropCrumbs(normalize(snapToQuiet(withBounds(sugs.filter((s) => s.confidence >= 0.5).map((s) => ({ ...s.range, mode: mode(s) })), words), pcm, 16000), dur), words, dur);
const parts: Float32Array[] = [];
for (const s of kept(dur, cuts)) { const x = pcm.slice(Math.round(s.start * 16000), Math.round(s.end * 16000)), f = Math.min(160, x.length >> 1);
  for (let i = 0; i < f; i++) { x[i] *= i / f; x[x.length - 1 - i] *= i / f; } parts.push(x); }
const n = parts.reduce((s, p) => s + p.length, 0), out = new Float32Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
writeFileSync(audioF.replace(/\.f32$/, "") + ".cut.f32", Buffer.from(out.buffer));
console.log(`→ ${cuts.length} coupes, ${dur.toFixed(1)} s → ${(n / 16000).toFixed(1)} s`);
