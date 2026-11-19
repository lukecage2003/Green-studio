/**
 * Qualité des raccords du nettoyage automatique, sur un vrai enregistrement :
 * pour chaque coupe, énergie au point de coupe (doit être au niveau du bruit de fond), mots gardés rognés
 * (attaque ou chute coupée), et durée des respirations restées dans le montage.
 * Usage : node --experimental-strip-types scripts/cut-quality.ts <audio.f32> <mots.json> [punchy|natural|calm]
 */
import { readFileSync } from "node:fs";
import { autoCuts, frameEnergy, noiseFloor, cleanTranscript, tightenWords } from "../src/core/speech-analysis.ts";
import { kept } from "../src/core/timeline.ts";

const [audioF, wordsF, rh = "punchy"] = process.argv.slice(2);
const b = readFileSync(audioF), pcm = new Float32Array(b.buffer, b.byteOffset, b.length / 4), rate = 16000, dur = pcm.length / rate;
const raw = JSON.parse(readFileSync(wordsF, "utf8"));
const words = tightenWords(cleanTranscript(raw), pcm, rate);
const { cuts, sugs } = autoCuts(words, pcm, rate, rh as any, 0.5, !process.env.RAW);
const e = frameEnergy(pcm, rate, 0.005), fl = noiseFloor(e), db = (v: number) => 10 * Math.log10(Math.max(1e-12, v));
const at = (t: number) => e[Math.min(e.length - 1, Math.max(0, Math.round(t / 0.005)))];
const isCut = (t: number) => cuts.some((c) => t >= c.start && t < c.end);
let loud = 0, clipOn = 0, clipOff = 0; const rows: string[] = [];
for (const c of cuts) {
  const a = db(at(c.start) / fl), z = db(at(c.end) / fl);
  const prev = words.filter((w) => !isCut((w.start + w.end) / 2) && w.end <= c.start + 0.001).pop(), next = words.find((w) => !isCut((w.start + w.end) / 2) && w.start >= c.end - 0.001);
  const tail = prev ? c.start - prev.end : 9, head = next ? next.start - c.end : 9;
  if (a > 12 || z > 12) loud++; if (head < 0.015) clipOn++; if (tail < 0.03) clipOff++;
  rows.push(`${c.start.toFixed(3)}–${c.end.toFixed(3)}  bord ${a.toFixed(0).padStart(3)}/${z.toFixed(0).padStart(3)} dB  marge ${(tail * 1000).toFixed(0).padStart(4)}/${(head * 1000).toFixed(0).padStart(4)} ms`);
}
const k = kept(dur, cuts), out = k.reduce((s, r) => s + r.end - r.start, 0);
if (process.env.V) console.log(rows.join("\n"));
console.log(`${audioF.split("/").pop()} [${rh}] : ${sugs} suggestions, ${cuts.length} coupes, ${dur.toFixed(1)} → ${out.toFixed(1)} s | raccords bruyants ${loud} · attaques rognées ${clipOn} · chutes rognées ${clipOff}`);
