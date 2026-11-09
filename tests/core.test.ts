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
