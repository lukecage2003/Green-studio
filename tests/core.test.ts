import { test } from "node:test"; import assert from "node:assert/strict";
import { EditSession, kept, normalize, sourceToEdited, editedToSource, wordsToRange, joints, type Word } from "../src/core/timeline.ts";
import { analyze } from "../src/core/speech-analysis.ts";
import { RecordingWriter } from "../src/core/storage.ts";
import { recoverInterrupted } from "../src/core/recovery.ts";
import { MemoryBackend } from "./helpers.ts";

const W = (t: string, s: number, e: number, conf = 0.9): Word => ({ text: t, start: s, end: e, conf });
const sentence: Word[] = [W("Aujourd'hui,", 0, .6), W("je,", .7, .9), W("je", 1.0, 1.15), W("vais", 1.2, 1.4), W("vous", 1.45, 1.6), W("présenter", 1.65, 2.2),
  W("un", 2.3, 2.4), W("personnage", 2.45, 3.0), W("qui,", 3.1, 3.3), W("qui", 3.4, 3.55), W("est", 3.6, 3.8)];

test("normalize fusionne et borne", () => {
  assert.deepEqual(normalize([{ start: 5, end: 7 }, { start: 1, end: 3 }, { start: 2, end: 4 }, { start: 9, end: 20 }], 10), [{ start: 1, end: 4 }, { start: 5, end: 7 }, { start: 9, end: 10 }]);
});
test("kept = complément ; durée montée", () => {
  const s = new EditSession(10, [{ start: 2, end: 3 }, { start: 6, end: 8 }]);
  assert.deepEqual(s.kept, [{ start: 0, end: 2 }, { start: 3, end: 6 }, { start: 8, end: 10 }]); assert.equal(s.editedDuration, 7);
});
test("conversion temps source <-> montage (aller-retour)", () => {
  const cuts = [{ start: 2, end: 3 }, { start: 6, end: 8 }];
  assert.equal(sourceToEdited(4, 10, cuts), 3); assert.equal(editedToSource(3, 10, cuts), 4);
  assert.equal(sourceToEdited(2.5, 10, cuts), 2); assert.equal(sourceToEdited(9, 10, cuts), 6);
  for (const t of [0, 1, 3.5, 5, 8.2, 10]) assert.ok(Math.abs(editedToSource(sourceToEdited(t, 10, cuts), 10, cuts) - t) < 1e-9);
});
test("annuler / rétablir / restaurer", () => {
  const s = new EditSession(10); s.addCut({ start: 1, end: 2 }); s.addCut({ start: 4, end: 5 });
  assert.equal(s.cuts.length, 2); assert.ok(s.undo()); assert.equal(s.cuts.length, 1); assert.ok(s.redo()); assert.equal(s.cuts.length, 2);
  s.restore({ start: 4.2, end: 4.8 }); assert.deepEqual(s.cuts, [{ start: 1, end: 2 }, { start: 4, end: 4.2 }, { start: 4.8, end: 5 }]);
  s.undo(); assert.equal(s.cuts.length, 2); s.undo(); s.undo(); assert.equal(s.cuts.length, 0); assert.equal(s.undo(), false);
  s.addCut({ start: 0, end: 1 }); assert.equal(s.canRedo, false, "une nouvelle action vide le redo");
});
test("marges : ne mordent pas sur les mots voisins", () => {
  const r = wordsToRange(sentence, 1, 1, 0.5, 0.5); assert.equal(r.start, 0.6); assert.equal(r.end, 1.0);
});
test("raccords", () => { assert.deepEqual(joints(10, [{ start: 2, end: 3 }, { start: 6, end: 8 }]), [2, 5]); });

test("détection : 'je, je' et 'qui, qui' ; la 1re occurrence est proposée", () => {
  const s = analyze(sentence); const rep = s.filter((x) => x.type === "repetition");
  assert.equal(rep.length, 2); assert.deepEqual(rep.map((x) => x.firstWord), [1, 8]);
  assert.deepEqual(rep[0].range, { start: .7, end: .9 });
});
test("détection : euh, silence long, bégaiement, faux départ", () => {
  const w = [W("euh", 0, .3), W("par", .4, .5), W("particulièrement", .55, 1.3), W("important", 3.5, 4),
    W("il", 4.2, 4.3), W("faut", 4.35, 4.5), W("il", 4.6, 4.7), W("faut", 4.75, 4.9), W("partir", 5, 5.3)];
  const t = analyze(w).map((x) => x.type).sort();
  assert.deepEqual(t, ["false_start", "hesitation", "long_silence", "stutter"]);
});
test("répétition emphatique ('très très') : confiance basse", () => {
  const s = analyze([W("très", 0, .3), W("très", .35, .6), W("bon", .65, .9)]); assert.ok(s[0].confidence < 0.5);
});

test("écriture progressive : ordre, métadonnées, assemblage", async () => {
  const b = new MemoryBackend(); const w = new RecordingWriter(b, "r1", "video/webm", { estimate: async () => ({ quota: 1e12, usage: 0 }) });
  await w.start(); for (let i = 0; i < 12; i++) w.write(new Blob([new Uint8Array(1000).fill(i)]), i * 1000);
  const m = await w.finish(12000); assert.equal(m.status, "complete"); assert.equal(m.bytes, 12000); assert.equal(m.chunks, 12);
  const f = new Uint8Array(await (await b.file("r1")).arrayBuffer()); assert.equal(f.length, 12000); assert.equal(f[0], 0); assert.equal(f[11999], 11);
});
test("quota insuffisant : refus de démarrer", async () => {
  const w = new RecordingWriter(new MemoryBackend(), "r2", "video/webm", { estimate: async () => ({ quota: 100e6, usage: 90e6 }) });
  await assert.rejects(w.start(), /insuffisant/);
});
test("erreur disque : signalée sans bloquer la file", async () => {
  const b = new MemoryBackend(); b.failAt = 1; const w = new RecordingWriter(b, "r3", "video/webm", { estimate: async () => undefined });
  const warns: string[] = []; w.onWarning = (c) => warns.push(c); await w.start();
  for (let i = 0; i < 4; i++) w.write(new Blob(["x"]), i); const m = await w.finish(4);
  assert.ok(warns.includes("write_error")); assert.equal(m.chunks, 3);
});
test("récupération après crash", async () => {
  const b = new MemoryBackend(); const w = new RecordingWriter(b, "r4", "video/webm", { estimate: async () => undefined, metaEveryChunks: 1 });
  await w.start(); w.write(new Blob(["abcdef"]), 1000); await new Promise((r) => setTimeout(r, 10)); // pas de finish() = crash
  const rec = await recoverInterrupted(b); assert.equal(rec.length, 1); assert.equal(rec[0].status, "recovered"); assert.equal(rec[0].bytes, 6);
  b.metas.set("r5", { id: "r5", mime: "", startedAt: 0, status: "recording", bytes: 0, chunks: 0, durationMs: 0, backend: "memory" });
  await recoverInterrupted(b); assert.equal(b.metas.get("r5")!.status, "failed");
});

test("OPFS : parts durables, ordre, aucune recopie, reprise et suppression", async () => {
  const { OpfsBackend } = await import("../src/core/storage.ts"); const { FakeDir } = await import("./helpers.ts");
  const d = new FakeDir(); const b = await new OpfsBackend().init(d as any);
  const w = new RecordingWriter(b, "r6", "video/mp4", { estimate: async () => undefined, flushEveryChunks: 3 });
  await w.start(); for (let i = 0; i < 7; i++) w.write(new Blob([new Uint8Array(10).fill(i)]), i);
  await new Promise((r) => setTimeout(r, 10));
  // crash simulé : seules les parts fermées existent (6 chunks), la 7e est perdue
  const crashed = await new OpfsBackend().init(d as any); assert.equal((await crashed.file("r6")).size, 60);
  const m = await w.finish(7); assert.equal(m.bytes, 70);
  const f = await b.file("r6"); assert.equal(f.type, "video/mp4");
  const u = new Uint8Array(await f.arrayBuffer()); assert.equal(u.length, 70); assert.equal(u[0], 0); assert.equal(u[69], 6);
  assert.equal(d.copiedBytes, 0, "aucune recopie des données existantes");
  // reprise dans une nouvelle session : nouvelle part, rien d'écrasé
  await crashed.append("r6", new Blob([new Uint8Array(5)])); assert.equal((await crashed.file("r6")).size, 75);
  await b.remove("r6"); assert.equal(d.files.size, 0);
});

test("audio : rééchantillonnage, crêtes, fondus, découpe aux silences", async () => {
  const { Resampler, peaks, fadeGain, splitAtSilences, toMono } = await import("../src/core/audio.ts");
  const r = new Resampler(48000, 16000); const sine = new Float32Array(48000).map((_, i) => Math.sin(2 * Math.PI * 100 * i / 48000));
  r.push(sine.subarray(0, 20000)); r.push(sine.subarray(20000)); r.pad(0.5);
  const o = r.result(); assert.ok(Math.abs(o.length - 24000) <= 2, String(o.length));
  assert.ok(Math.abs(o[4000] - Math.sin(2 * Math.PI * 100 * 0.25)) < 0.05, "signal conservé"); assert.equal(o[23000], 0);
  assert.deepEqual([...toMono([new Float32Array([1, 0]), new Float32Array([0, 1])])], [0.5, 0.5]);
  assert.deepEqual([...peaks(new Float32Array([0, -0.5, 0.2, 0.9]), 2)].map((x) => +x.toFixed(2)), [0.5, 0.9]);
  assert.equal(fadeGain(0, 10, 0.01), 0); assert.equal(fadeGain(5, 10, 0.01), 1); assert.ok(fadeGain(0.005, 10, 0.01) > 0.6 && fadeGain(0.005, 10, 0.01) < 0.8);
  assert.equal(fadeGain(10, 10, 0.01), 0);
  // 70 s de « parole » avec des silences à 25 s et 50 s : les coupes tombent dans les silences
  const rate = 100, x = new Float32Array(70 * rate).fill(0.5); x.fill(0, 25 * rate, 25.5 * rate); x.fill(0, 50 * rate, 50.5 * rate);
  const b = splitAtSilences(x, rate); assert.equal(b[0], 0); assert.equal(b[b.length - 1], x.length);
  for (let i = 1; i < b.length - 1; i++) { assert.equal(x[b[i]], 0, "coupe dans un silence"); assert.ok(b[i] - b[i - 1] <= 28 * rate); }
});
