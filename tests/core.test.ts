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
  // parole simulée : syllabes (~7/s) et timbre qui change, comme une vraie voix (une sinusoïde pure serait une voyelle tenue)
  const voice = (a: number, b: number) => { let ph = 0; for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) { const t = i / rate, f = 140 + 60 * Math.sin(t * 23) + 300 * ((Math.floor(t * 7) % 3) / 2);
    ph += (2 * Math.PI * f) / rate; pcm[i] = (0.18 + 0.12 * Math.abs(Math.sin(t * Math.PI * 7))) * (Math.sin(ph) + 0.4 * Math.sin(3 * ph + t * 40)); } };
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

test("sous-titres traduits : un segment est réparti sur ses mots, dans l'ordre et sans dépasser", async () => {
  const { spreadSegment, buildCaptions } = await import("../src/core/captions.ts");
  const w = spreadSegment(" Hello everyone, welcome back ", 2, 5);
  assert.deepEqual(w.map((x) => x.text), ["Hello", "everyone,", "welcome", "back"]);
  assert.equal(w[0].start, 2); assert.ok(w[3].end <= 5 && w[3].end > 4.5);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].start >= w[i - 1].end);
  assert.ok(w[1].end - w[1].start > w[3].end - w[3].start, "mot long = plus de temps");
  assert.equal(buildCaptions(w, [{ start: 3.5, end: 5 }]).flatMap((l) => l.words).length, 2, "les mots coupés disparaissent aussi en anglais");
  assert.deepEqual(spreadSegment("  ", 0, 1), []);
});

test("commande vocale « je reprends » : la tentative ratée et la commande sont retirées, pas une phrase normale", () => {
  const mk = (spec: [string, number][]) => { let t = 0; return spec.map(([text, gap]) => { t += gap; const w = { text, start: t, end: t + 0.25 }; t += 0.25; return w; }); };
  // « Bonjour à tous. » pause « Aujourd'hui on parle du » « je reprends » pause « Aujourd'hui on parle du nouveau film »
  const w = mk([["Bonjour", 0], ["à", 0.05], ["tous.", 0.05], ["Aujourd'hui", 0.8], ["on", 0.05], ["parle", 0.05], ["du", 0.05], ["je", 0.3], ["reprends", 0.05],
    ["Aujourd'hui", 0.9], ["on", 0.05], ["parle", 0.05], ["du", 0.05], ["nouveau", 0.05], ["film.", 0.05]]);
  const r = analyze(w).filter((s) => s.type === "retake");
  assert.equal(r.length, 1); assert.equal(r[0].firstWord, 3); assert.equal(r[0].lastWord, 8);
  assert.ok(r[0].range.start === w[3].start && r[0].range.end < w[9].start && r[0].range.end > w[8].end, "coupe jusqu'avant la reprise, en gardant une courte pause");
  assert.ok(r[0].confidence > 0.9);
  // phrase normale, sans pause après : rien
  const n = mk([["Je", 0], ["reprends", 0.05], ["ma", 0.05], ["voiture", 0.05], ["demain.", 0.05]]);
  assert.equal(analyze(n).filter((s) => s.type === "retake").length, 0);
  // « coupez » en fin de prise : tout ce qui précède depuis la dernière pause
  const c = mk([["Merci", 0], ["d'avoir", 0.05], ["regardé.", 0.05], ["Abonnez", 0.9], ["euh", 0.05], ["coupez", 0.4]]);
  const rc = analyze(c).filter((s) => s.type === "retake"); assert.equal(rc.length, 1); assert.equal(rc[0].firstWord, 3); assert.equal(rc[0].lastWord, 5);
});

test("coach : check studio (contre-jour, bruit, cadrage) et bilan de prise", async () => {
  const { studioCheck, noiseFloorDb, takeReport } = await import("../src/core/coach.ts");
  const ids = (m: any) => studioCheck(m).filter((x) => !x.ok).map((x) => x.id);
  const good = { x: 0.5, y: 0.12, s: 0.3 };
  assert.deepEqual(ids({ subj: 0.5, bg: 0.45, head: good, floorDb: -60 }), []);
  assert.deepEqual(ids({ subj: 0.3, bg: 0.8, head: good, floorDb: -60 }), ["backlight"]);
  assert.deepEqual(ids({ subj: 0.5, bg: 0.5, head: good, floorDb: -32 }), ["noise"]);
  assert.deepEqual(ids({ subj: 0.5, bg: 0.5, head: { x: 0.8, y: 0.0, s: 0.08 }, floorDb: null }), ["top", "center", "far"]);
  assert.deepEqual(ids({ subj: null, bg: null, head: null, floorDb: null }), ["nobody"]);
  assert.ok(Math.abs(noiseFloorDb(Array.from({ length: 50 }, (_, i) => (i < 40 ? 0.001 : 0.3)))! + 60) < 0.01);
  // 60 mots en 20 s de parole = 180 mots/min ; 2 « euh » ; une coupe
  const w = Array.from({ length: 60 }, (_, i) => ({ text: "mot", start: i / 3, end: i / 3 + 0.3 }));
  const sg: any[] = [{ type: "hesitation" }, { type: "hesitation" }];
  const r = takeReport(w, sg, 20, [{ start: 0, end: 1 }]);
  assert.ok(r.wpm > 170 && r.wpm < 190, String(r.wpm)); assert.equal(r.tics, 2); assert.equal(r.removed, 1);
  assert.ok(r.score >= 50 && r.score < 100); assert.ok(r.tips.length >= 1);
  const fast = takeReport(Array.from({ length: 90 }, (_, i) => ({ text: "x", start: i / 4.5, end: i / 4.5 + 0.2 })), [], 20, []);
  assert.ok(fast.wpm > 230 && fast.tips[0].startsWith("Débit rapide"));
});

test("rédaction : réponse de Gemini Nano lue, version locale utile sans IA", async () => {
  const { parseDraft, localDraft, buildPrompt } = await import("../src/core/writer.ts");
  const d = parseDraft("**TITRE1:** Le nouveau Spider-Man déçoit ?\nTITRE2: Spider-Man : mon avis\nTITRE3: Faut-il voir Spider-Man ?\nDESCRIPTION: Mon avis honnête. Sans spoiler.\nHASHTAGS: #spiderman #marvel cinema #comics\nACCROCHE: « Ce film m'a vraiment surpris. »");
  assert.ok(d); assert.equal(d!.titles.length, 3); assert.equal(d!.titles[0], "Le nouveau Spider-Man déçoit ?");
  assert.deepEqual(d!.hashtags, ["#spiderman", "#marvel", "#cinema", "#comics"]); assert.equal(d!.hook, "Ce film m'a vraiment surpris.");
  assert.equal(parseDraft("Désolé, je ne peux pas."), null);
  const tx = "Salut à tous. Aujourd'hui on parle du nouveau Spider-Man. Pourquoi Spider-Man divise autant les fans ? Le Spider-Man de Marvel a un costume incroyable. Les fans de Marvel adorent.";
  const l = localDraft(tx);
  assert.equal(l.by, "local"); assert.ok(l.hashtags.includes("#spiderman") && l.hashtags.includes("#marvel"), l.hashtags.join(" "));
  assert.ok(!l.hashtags.some((h) => ["#aujourd", "#salut", "#tous"].includes(h)));
  assert.match(l.hook, /Pourquoi|incroyable/); assert.ok(l.titles[0].startsWith("Spider-Man"));
  assert.ok(buildPrompt(tx).includes("TITRE1:") && buildPrompt("x".repeat(9000)).length < 3200);
});

test("dérush : clips, scission entre deux mots, rognage des bords sans toucher aux voisins", async () => {
  const { clipsOf, snapSplit, hitAt, trimEdge, wavePeaks } = await import("../src/core/derush.ts");
  const cuts = [{ start: 4, end: 5 }];
  const cl = clipsOf(10, cuts, [2, 4.5, 7]);
  assert.deepEqual(cl.map((c) => [c.start, c.end]), [[0, 2], [2, 4], [5, 7], [7, 10]], "scission dans une coupe ignorée");
  const words = [{ text: "a", start: 1, end: 1.4 }, { text: "b", start: 1.6, end: 2.2 }];
  assert.ok(Math.abs(snapSplit(1.65, words) - 1.5) < 1e-9, "calé dans le blanc avant le mot");
  assert.ok(Math.abs(snapSplit(2.15, words) - 2.22) < 1e-9, "après le dernier mot");
  assert.equal(snapSplit(3, words), 3);
  assert.equal(hitAt(4.5, cl, cuts)?.kind, "cut"); assert.equal((hitAt(6, cl, cuts) as any).clip.start, 5);
  // rogner le début du clip [5,7] : coupe étendue jusqu'à 5,8
  assert.deepEqual(trimEdge(10, cuts, { start: 5, end: 7 }, "start", 5.8), [{ start: 4, end: 5.8 }]);
  // rallonger vers la gauche : on récupère une partie coupée, sans dépasser le clip voisin
  assert.deepEqual(trimEdge(10, cuts, { start: 5, end: 7 }, "start", 4.4), [{ start: 4, end: 4.4 }]);
  assert.deepEqual(trimEdge(10, cuts, { start: 5, end: 7 }, "start", 1), [], "tout récupéré, pas plus");
  // fin du clip [2,4] tirée vers la droite : la coupe recule ; vers la gauche : nouvelle coupe
  assert.deepEqual(trimEdge(10, cuts, { start: 2, end: 4 }, "end", 4.3), [{ start: 4.3, end: 5 }]);
  assert.deepEqual(trimEdge(10, cuts, { start: 2, end: 4 }, "end", 3.5), [{ start: 3.5, end: 5 }]);
  assert.deepEqual(cuts, [{ start: 4, end: 5 }], "les coupes d'origine ne sont pas modifiées");
  const pcm = new Float32Array(16000); pcm[12000] = 0.8; const wp = wavePeaks(pcm, 16000, 0, 1, 4);
  assert.equal(wp.length, 4); assert.ok(wp[3] > 0 || wp[2] >= 0);
});

test("« euh » effacé par Whisper : voyelle tenue entre deux mots ou collée à un mot ; tics de langage isolés", async () => {
  const { analyzeAudio, analyze, steadyRuns } = await import("../src/core/speech-analysis.ts");
  const rate = 16000, pcm = new Float32Array(rate * 8);
  for (let i = 0; i < pcm.length; i++) pcm[i] = (Math.random() - 0.5) * 0.002;
  const speech = (a: number, b: number) => { let ph = 0; for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) { const t = i / rate, f = 140 + 60 * Math.sin(t * 23) + 300 * ((Math.floor(t * 7) % 3) / 2);
    ph += (2 * Math.PI * f) / rate; pcm[i] = (0.18 + 0.12 * Math.abs(Math.sin(t * Math.PI * 7))) * (Math.sin(ph) + 0.4 * Math.sin(3 * ph + t * 40)); } };
  const euh = (a: number, b: number) => { let ph = 0; for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) { ph += (2 * Math.PI * 120) / rate; pcm[i] = 0.2 * (Math.sin(ph) + 0.5 * Math.sin(4 * ph) + 0.3 * Math.sin(12 * ph)); } };
  speech(0.3, 0.8); euh(1.0, 1.5); speech(1.7, 2.1);     // « Bonjour » [euh dans le blanc] « alors »
  euh(3.0, 3.45); speech(3.45, 3.8);                      // [euh collé] « voilà » : Whisper donne voilà 3,0–3,8
  speech(4.5, 4.8); euh(4.8, 5.4);                        // « et » [euh collé] : Whisper donne et 4,5–5,4
  speech(6.0, 6.6);
  const W2 = (text: string, start: number, end: number) => ({ text, start, end });
  const words = [W2("Bonjour", 0.3, 0.8), W2("alors", 1.7, 2.1), W2("voilà", 3.0, 3.8), W2("et", 4.5, 5.4), W2("demain", 6.0, 6.6)];
  assert.ok(steadyRuns(pcm, rate).length >= 3, "trois voyelles tenues");
  const h = analyzeAudio(words, pcm, rate).filter((x) => x.type === "hesitation");
  const near = (a: number, b: number) => h.find((x) => Math.abs(x.range.start - a) < 0.15 && Math.abs(x.range.end - b) < 0.15);
  assert.ok(near(1.0, 1.5), "euh dans le blanc : " + JSON.stringify(h.map((x) => x.range)));
  assert.ok(near(3.0, 3.45) || near(3.0, 3.7), "euh avant « voilà », le mot gardé : " + JSON.stringify(h.map((x) => x.range)));
  const after = h.find((x) => x.range.start > 4.55 && x.range.start < 5.0 && x.range.end > 5.2); assert.ok(after, "euh après « et », le début du mot gardé");
  assert.ok(!h.some((x) => x.range.start < 0.8 && x.range.end > 0.3), "« Bonjour » intact");
  // tics de langage
  const mk = (spec: [string, number][]) => { let t = 0; return spec.map(([text, gap]) => { t += gap; const w = { text, start: t, end: t + 0.25 }; t += 0.25; return w; }); };
  const tw = mk([["Alors,", 0], ["du", 0.3], ["coup,", 0.05], ["on", 0.4], ["part", 0.05], ["demain", 0.05], ["quoi.", 0.05], ["C'est", 0.6], ["genre", 0.05], ["incroyable", 0.05]]);
  const f = analyze(tw).filter((x) => x.type === "filler_word");
  const strong = f.filter((x) => x.confidence >= 0.5).map((x) => x.excerpt), weak = f.filter((x) => x.confidence < 0.5).map((x) => x.excerpt);
  assert.deepEqual(strong, ["Alors,", "du coup,", "quoi."], "isolés : retirés"); assert.deepEqual(weak, [], "« genre » collé dans la phrase : laissé tranquille");
});

test("vrai fond vert : détection stable (vert, bleu, mur ordinaire) et couleur de référence", async () => {
  const { keyKind, KeyTracker, rgbToUV } = await import("../src/core/chroma.ts");
  assert.equal(keyKind({ r: 0.15, g: 0.6, b: 0.25, sd: 0.05 }), "green");
  assert.equal(keyKind({ r: 0.1, g: 0.3, b: 0.7, sd: 0.06 }), "blue");
  assert.equal(keyKind({ r: 0.6, g: 0.58, b: 0.55, sd: 0.05 }), null, "mur blanc");
  assert.equal(keyKind({ r: 0.15, g: 0.6, b: 0.25, sd: 0.25 }), null, "plantes vertes, fond chargé");
  const t = new KeyTracker(), g = { r: 0.15, g: 0.6, b: 0.25, sd: 0.05 };
  for (let i = 0; i < 3; i++) t.push(g); assert.equal(t.on, false, "pas avant ~1 s");
  t.push(g); assert.equal(t.on, true);
  for (let i = 0; i < 5; i++) t.push(null); assert.equal(t.on, true, "un passage devant le fond ne coupe pas");
  for (let i = 0; i < 3; i++) t.push(null); assert.equal(t.on, false);
  const [u, v] = rgbToUV(0.15, 0.6, 0.25); assert.ok(u < 0.45 && v < 0.4, "le vert est loin du gris (0,5 ; 0,5)");
  assert.ok(Math.abs(t.u - u) < 1e-9);
});

test("rythme : Dynamique coupe les pauses moyennes, Posé les garde", async () => {
  const { analyze, RHYTHM } = await import("../src/core/speech-analysis.ts");
  const w = [{ text: "Bonjour.", start: 0, end: 0.5 }, { text: "Aujourd'hui", start: 1.3, end: 1.8 }, { text: "on", start: 1.85, end: 2 }, { text: "parle", start: 2.5, end: 2.8 }];
  const sil = (r: keyof typeof RHYTHM) => analyze(w, { longSilence: RHYTHM[r].longSilence, keepPause: RHYTHM[r].keepPause }).filter((s) => s.type === "long_silence");
  assert.equal(sil("calm").length, 0, "pause de 0,8 s gardée");
  const n = sil("natural"); assert.equal(n.length, 1); assert.ok(Math.abs(n[0].range.end - n[0].range.start - 0.5) < 1e-9, "0,8 s → 0,3 s");
  const p = sil("punchy"); assert.equal(p.length, 2, "la pause de 0,5 s aussi"); assert.ok(p.every((s) => s.confidence >= 0.5));
});

test("transcription nettoyée : élisions recollées, génériques inventés et boucles retirés", async () => {
  const { mergeElisions, cleanTranscript } = await import("../src/core/speech-analysis.ts");
  const W2 = (text: string, start: number, end: number) => ({ text, start, end });
  const m = mergeElisions([W2("j", 1, 1.1), W2("'ai", 1.1, 1.3), W2("excusez", 2, 2.4), W2("-moi,", 2.4, 2.6), W2("l'", 3, 3.05), W2("étoile", 3.05, 3.4)]);
  assert.deepEqual(m.map((w) => w.text), ["j'ai", "excusez-moi,", "l'étoile"]); assert.equal(m[0].end, 1.3);
  const h = cleanTranscript([W2("Merci.", 0, 0.5), W2("Sous", 5, 5.2), W2("-titres", 5.2, 5.5), W2("réalisés", 5.5, 5.8), W2("par", 5.8, 5.9), W2("la", 5.9, 6), W2("communauté", 6, 6.4), W2("d'Amara", 6.4, 6.8), W2(".org", 6.8, 7)]);
  assert.deepEqual(h.map((w) => w.text), ["Merci."], "générique Amara retiré");
  const loop = cleanTranscript(Array.from({ length: 10 }, (_, i) => W2(i % 2 ? "tout" : "merci", i, i + 0.5)));
  assert.equal(loop.length, 2, "boucle « merci tout » ×5 → une fois");
  const real = cleanTranscript([W2("non", 0, 0.2), W2("non", 0.3, 0.5), W2("non", 0.6, 0.8)]);
  assert.equal(real.length, 3, "« non non non » (3 fois) gardé : c'est au montage d'en décider");
});

test("parole avalée par Whisper (mot étiré) : on coupe jusqu'au vrai mot, sans le toucher ; bords recalés sur le silence", async () => {
  const { analyzeAudio, snapToQuiet } = await import("../src/core/speech-analysis.ts");
  const rate = 16000, pcm = new Float32Array(rate * 5);
  for (let i = 0; i < pcm.length; i++) pcm[i] = (Math.random() - 0.5) * 0.002;
  const speech = (a: number, b: number) => { let ph = 0; for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) { const t = i / rate, f = 140 + 60 * Math.sin(t * 23) + 300 * ((Math.floor(t * 7) % 3) / 2);
    ph += (2 * Math.PI * f) / rate; pcm[i] = (0.18 + 0.12 * Math.abs(Math.sin(t * Math.PI * 7))) * (Math.sin(ph) + 0.4 * Math.sin(3 * ph + t * 40)); } };
  // « voilà » 0,3–0,7 ; [voilà avalé 1,0–1,4] pause [ici 1,6–1,85] — Whisper donne « ici » 1,0–1,85
  speech(0.3, 0.7); speech(1.0, 1.4); speech(1.6, 1.85); speech(2.4, 2.9);
  const words = [{ text: "voilà", start: 0.3, end: 0.7 }, { text: "ici", start: 1.0, end: 1.85 }, { text: "demain", start: 2.4, end: 2.9 }];
  const s = analyzeAudio(words, pcm, rate).find((x) => x.id.startsWith("swallowed-"));
  assert.ok(s, "parole avalée trouvée"); assert.equal(s!.type, "false_start"); assert.ok(s!.confidence >= 0.5);
  assert.ok(Math.abs(s!.range.start - 1.0) < 0.01 && s!.range.end > 1.38 && s!.range.end < 1.6, JSON.stringify(s!.range));
  assert.ok(!analyzeAudio(words, pcm, rate).some((x) => x.confidence >= 0.5 && x.range.start < 0.7 && x.range.end > 0.3), "« voilà » intact");
  // recalage : une coupe qui finit juste avant un mot ne s'en approche jamais ; une hésitation s'étend vers le silence
  const [pre] = snapToQuiet([{ start: 1.0, end: 1.55, mode: "pre" }], pcm, rate); assert.ok(pre.end <= 1.55 + 1e-9 && pre.end > 1.4, JSON.stringify(pre));
  const [out] = snapToQuiet([{ start: 1.05, end: 1.35, mode: "out" }], pcm, rate); assert.ok(out.start <= 1.05 && out.end >= 1.35 && out.end <= 1.6, JSON.stringify(out));
});
