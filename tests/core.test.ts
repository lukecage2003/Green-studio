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

test("sous-titres : lignes courtes, pauses, fins de phrase, mots coupés exclus", async () => {
  const { buildCaptions, lineAt } = await import("../src/core/captions.ts");
  const w = ["Salut", "tout", "le", "monde.", "Aujourd'hui", "on", "parle", "de", "comics", "après", "une", "pause"].map((t, i) => W(t, i * 0.4, i * 0.4 + 0.3));
  w[9] = W("après", 5, 5.3); w[10] = W("une", 5.4, 5.6); w[11] = W("pause", 5.7, 6);
  const L = buildCaptions(w, [{ start: 2.75, end: 3.1 }]); // « de » (2,8–3,1) coupé
  assert.deepEqual(L.map((l) => l.words.map((x) => x.text).join(" ")), ["Salut tout le monde.", "Aujourd'hui on parle", "comics", "après une pause"]);
  assert.ok(L.every((l, i) => !L[i + 1] || l.end <= L[i + 1].start), "pas de chevauchement");
  assert.equal(lineAt(L, 0.5)!.words[0].text, "Salut"); assert.equal(lineAt(L, 5.5)!.words[0].text, "après"); assert.equal(lineAt(L, 100), null);
});
test("volume : gain vers la cible, plafond, limiteur, bords muets", async () => {
  const { loudnessGain, softLimit, speechBounds } = await import("../src/core/audio.ts");
  const rate = 8000, x = new Float32Array(rate * 4); for (let i = rate; i < rate * 3; i++) x[i] = 0.1 * Math.sin(i / 3); // parole faible (−23 dB) entre 1 s et 3 s
  const g = loudnessGain(x, rate); const after = 20 * Math.log10(0.1 / Math.SQRT2 * g); assert.ok(Math.abs(after + 16) < 0.5, String(after));
  assert.equal(+loudnessGain(x.map((v) => v * 0.2), rate).toFixed(2), +Math.pow(10, 12 / 20).toFixed(2), "plafond +12 dB");
  assert.equal(loudnessGain(new Float32Array(rate), rate), 1, "silence : gain neutre");
  assert.equal(softLimit(0.5), 0.5); assert.ok(softLimit(3) < 1 && softLimit(3) > 0.95); assert.ok(softLimit(-3) > -1);
  const b = speechBounds(x, rate)!; assert.ok(Math.abs(b.start - 1) < 0.03 && Math.abs(b.end - 3) < 0.03, JSON.stringify(b));
});

test("prompteur : alignement des mots entendus (progression, saut, relecture, bruit)", async () => {
  const { tokenize, align, normWord } = await import("../src/core/prompter.ts");
  const t = tokenize("Salut à tous !\nAujourd'hui on parle du nouveau numéro de Spider-Man, sorti cette semaine chez Marvel.");
  assert.equal(t.parts[t.wordIdx[3]], "Aujourd'hui"); assert.equal(t.norm[3], "aujourdhui");
  const H = (s: string) => s.split(" ").map(normWord);
  assert.equal(align(t.norm, H("salut à tous aujourd'hui on"), 0), 5, "progression normale");
  assert.equal(align(t.norm, H("sorti cette semaine"), 5), 14, "saut en avant");
  assert.equal(align(t.norm, H("on parle du"), 12), 7, "relecture");
  assert.equal(align(t.norm, H("du nouveau numerot"), 5), 9, "une erreur de reconnaissance tolérée");
  assert.equal(align(t.norm, H("bonjour les amis"), 5), null, "hors script : on ne bouge pas");
});
test("prompteur : détection de parole à seuil adaptatif", async () => {
  const { VoiceDetector } = await import("../src/core/prompter.ts");
  const v = new VoiceDetector(); let t = 0;
  for (let i = 0; i < 100; i++) v.update(0.004 + (i % 3) * 0.001, (t += 20)); // bruit de fond
  assert.equal(v.speaking, false, "bruit seul : pas de parole");
  assert.equal(v.update(0.08, (t += 20)), true, "voix");
  assert.equal(v.update(0.004, (t += 200)), true, "maintien après une syllabe");
  assert.equal(v.update(0.004, (t += 400)), false, "silence");
});

test("son non transcrit et bégaiement dans un mot (ce que Whisper efface)", async () => {
  const { analyzeAudio } = await import("../src/core/speech-analysis.ts");
  const rate = 8000, pcm = new Float32Array(rate * 6);
  const voice = (a: number, b: number) => { for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) pcm[i] = 0.3 * Math.sin(i / 2.7); };
  for (let i = 0; i < pcm.length; i++) pcm[i] = (Math.random() - 0.5) * 0.002; // bruit de fond
  voice(0.2, 0.6); voice(1.0, 1.25); voice(1.6, 2.0);      // « Bonjour » [je non transcrit] « je »
  voice(2.4, 2.55); voice(2.75, 3.4);                      // « p… présenter » transcrit comme un seul mot 2,4–3,4
  voice(3.6, 4.0);                                          // « demain »
  const words: Word[] = [W("Bonjour", 0.2, 0.6), W("je", 1.6, 2.0), W("présenter", 2.4, 3.4), W("demain", 3.6, 4.0)];
  const s = analyzeAudio(words, pcm, rate);
  const un = s.find((x) => x.type === "untranscribed")!; assert.ok(un, "son non transcrit trouvé");
  assert.ok(un.range.start >= 0.6 && un.range.start < 1.0 && un.range.end > 1.2 && un.range.end <= 1.6, JSON.stringify(un.range));
  const st = s.find((x) => x.type === "stutter")!; assert.ok(st, "bégaiement dans le mot trouvé");
  assert.ok(Math.abs(st.range.start - 2.4) < 0.01 && st.range.end > 2.55 && st.range.end < 2.8, JSON.stringify(st.range));
  assert.equal(s.length, 2, "rien d'autre : pas de fausse alerte sur les mots normaux");
  assert.equal(analyzeAudio(words, new Float32Array(rate * 6), rate).length, 0, "silence : rien");
});

test("meilleure prise : reprises, hors-script, phrase oubliée", async () => {
  const { bestTakes, similar } = await import("../src/core/takes.ts");
  assert.ok(similar("numero", "numeros") && similar("spiderman", "spidermen") && !similar("le", "la"));
  const script = "Salut à tous. Aujourd'hui on parle du nouveau Spider-Man. C'est vraiment une pépite. Abonnez-vous !";
  // prise réelle : ad-lib, phrase 2 ratée puis reprise, phrase 3 dite deux fois (la 2e complète), phrase 4 oubliée
  const said = ["euh", "attends", "Salut", "à", "tous", "Aujourd'hui", "on", "parle", "du", "non", "Aujourd'hui", "on", "parle", "du", "nouveau", "Spider-Man",
    "C'est", "vraiment", "C'est", "vraiment", "une", "pépite", "voilà"];
  let t = 0; const w = said.map((x) => { const r = W(x, t, t + 0.3); t += 0.4; return r; });
  const r = bestTakes(w, script, t + 1);
  const keptText = (k: { first: number; last: number }) => said.slice(k.first, k.last + 1).join(" ");
  assert.deepEqual(r.kept.map(keptText), ["Salut à tous", "Aujourd'hui on parle du nouveau Spider-Man", "C'est vraiment une pépite"]);
  assert.equal(r.retakes, 2); assert.deepEqual(r.missing, ["Abonnez-vous !"]);
  // tout le reste est coupé : « euh attends », la 1re tentative ratée, le 1er « C'est vraiment », « voilà »
  const inCut = (i: number) => r.cuts.some((c) => (w[i].start + w[i].end) / 2 > c.start && (w[i].start + w[i].end) / 2 < c.end);
  assert.deepEqual(said.map((_, i) => inCut(i) ? 1 : 0).join(""), "11000111110000001100001");
});
