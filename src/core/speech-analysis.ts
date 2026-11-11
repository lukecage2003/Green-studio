/** SpeechAnalysisEngine : suggestions de coupes à partir des mots horodatés. Ne supprime jamais rien : propose seulement. */
import type { Range, Word } from "./timeline.ts";

export type IssueType = "retake" | "filler_word" | "repetition" | "stutter" | "false_start" | "hesitation" | "long_silence" | "untranscribed";
export interface Suggestion { id: string; type: IssueType; range: Range; firstWord: number; lastWord: number; excerpt: string; confidence: number }

/** Tics de langage par défaut (modifiables par l'utilisateur). */
export const TICS = ["donc", "bon", "alors", "enfin", "mais bon", "du coup", "en fait", "tu vois", "tu sais", "vous voyez", "je veux dire", "j'veux dire", "en gros", "genre", "voila", "bref", "quoi", "hein", "style", "disons", "enfin bref", "bon ben", "ben voila"];
export interface AnalysisOptions {
  maxRepeatGap: number;      // s entre deux occurrences d'un mot répété
  longSilence: number;       // s
  keepPause: number;         // s de pause gardée à la place d'un silence coupé (marge, comme auto-editor)
  fillers: string[];
  tics: string[];            // tics de langage (retirés seulement quand ils sont isolés par une pause ou une virgule)
  emphaticWords: string[];   // répétitions souvent volontaires : confiance réduite
  maxPhrase: number;         // taille max (mots) d'une phrase recommencée
}
export const DEFAULTS: AnalysisOptions = {
  maxRepeatGap: 0.8, longSilence: 1.5, keepPause: 0.4, maxPhrase: 5,
  fillers: ["euh", "heu", "hum", "hmm", "mmh", "euhh", "euuh", "eeuh", "bah", "ben", "beh", "pff", "mh", "hm"],
  tics: TICS,
  emphaticWords: ["très", "bien", "trop", "vraiment", "super", "beaucoup", "non", "oui", "jamais", "toujours"],
};

export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9']/g, "");

function ticAt(n: string[], i: number, tics: string[]): number {
  let best = 0;
  for (const t of tics) { const p = t.split(" ").map(norm); if (p.length > best && p.every((x, k) => n[i + k] === x)) best = p.length; }
  return best;
}
const RETAKE = [["je", "reprends"], ["je", "reprend"], ["on", "reprend"], ["je", "recommence"], ["on", "recommence"], ["je", "la", "refais"], ["on", "la", "refait"], ["coupez"], ["coupe"]];
/** Longueur de la commande de reprise qui commence au mot i (0 si aucune). */
function retakeAt(n: string[], i: number): number {
  for (const c of RETAKE) if (c.every((x, k) => n[i + k] === x)) return c.length;
  return 0;
}

/** Whisper découpe les élisions : « j » + « 'ai », « excusez » + « -moi ». On recolle (comptage des répétitions, tics, affichage). */
export function mergeElisions(words: Word[]): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    const t = w.text.trim(), prev = out[out.length - 1];
    if (prev && /^['’\-]\p{L}/u.test(t) && w.start - prev.end < 0.3) { out[out.length - 1] = { ...prev, text: prev.text + t, end: Math.max(prev.end, w.end) }; continue; }
    if (prev && /['’]$/.test(prev.text) && w.start - prev.end < 0.3) { out[out.length - 1] = { ...prev, text: prev.text + t, end: Math.max(prev.end, w.end) }; continue; }
    out.push({ ...w, text: t });
  }
  return out;
}

/** Phrases que Whisper invente sur du silence ou de la musique (génériques de sous-titres). */
const HALLU = ["sous titres realises par la communaute d'amara org", "sous titres realises para la communaute d'amara org", "sous titrage st' 501", "sous titrage societe radio canada",
  "sous titres par", "sous titrage fr", "amara org", "abonnez vous a la chaine pour ne rien rater", "subtitles by the amara org community"];
/**
 * Nettoie la sortie de Whisper : génériques inventés, boucles (même groupe de mots répété ≥ 4 fois d'affilée), et queue
 * dégénérée en fin d'audio (mêmes mots courts répétés jusqu'à la fin).
 */
export function cleanTranscript(words: Word[]): Word[] {
  let w = mergeElisions(words);
  const n = w.map((x) => norm(x.text.replace(/[-.]/g, " ")).replace(/\s+/g, ""));
  const keys = HALLU.map((h) => h.split(" ").map(norm).filter(Boolean));
  const drop = new Set<number>();
  for (let i = 0; i < w.length; i++) for (const k of keys) {
    // correspondance sur la suite des mots normalisés (les découpages de Whisper varient : on compare les caractères)
    let j = i, acc = ""; const target = k.join("");
    while (j < w.length && acc.length < target.length) acc += n[j++];
    if (acc === target) { for (let q = i; q < j; q++) drop.add(q); }
  }
  w = w.filter((_, i) => !drop.has(i));
  // boucles : un groupe de 1 à 6 mots répété au moins 4 fois → une seule fois
  const m = w.map((x) => norm(x.text)); const keep: Word[] = [];
  for (let i = 0; i < w.length; ) {
    let skipped = false;
    for (let L = 6; L >= 1 && !skipped; L--) {
      let reps = 1; while (i + (reps + 1) * L <= w.length && m.slice(i, i + L).every((x, k) => x && x === m[i + reps * L + k])) reps++;
      if (reps >= 4) { keep.push(...w.slice(i, i + L)); i += reps * L; skipped = true; }
    }
    if (!skipped) keep.push(w[i++]);
  }
  return keep;
}

/**
 * Bords de coupe au plus juste : chaque bord est déplacé (± 80 ms) sur l'instant le plus silencieux du son (trames de 10 ms),
 * pour que la coupe tombe entre deux sons et pas au milieu d'une syllabe. Les coupes restent ordonnées et non vides.
 */
/** out : hésitation isolée (s'étend vers le silence) ; pre : coupe qui finit juste avant un mot gardé (sa fin ne s'en approche jamais). */
export type SnapMode = "both" | "out" | "pre";
export function snapToQuiet(ranges: (Range & { mode?: SnapMode })[], pcm: Float32Array, rate: number, win = 0.08): Range[] {
  const fr = Math.max(1, Math.round(rate * 0.01)), n = Math.floor(pcm.length / fr), e = new Float32Array(n);
  for (let k = 0; k < n; k++) { let a = 0; for (let i = k * fr; i < (k + 1) * fr; i++) a += pcm[i] * pcm[i]; e[k] = a; }
  const quiet = (t: number, lo: number, hi: number, before = win, after = win) => {
    const a = Math.max(0, Math.floor((Math.max(lo, t - before)) / 0.01)), b = Math.min(n - 1, Math.ceil((Math.min(hi, t + after)) / 0.01));
    if (b <= a) return t; let best = Math.min(n - 1, Math.max(0, Math.round(t / 0.01))), bv = Infinity;
    for (let k = a; k <= b; k++) { const v = e[k] * (1 + 0.15 * Math.abs(k * 0.01 - t) / win); if (v < bv) { bv = v; best = k; } } // à énergie égale, le plus proche
    return best * 0.01 + 0.005;
  };
  return ranges.map((r) => {
    const s = r.mode === "out" ? quiet(r.start, 0, r.end - 0.03, win * 1.5, 0.01) : quiet(r.start, 0, r.end - 0.03);
    const en = r.mode === "out" ? quiet(r.end, s + 0.03, Infinity, 0.01, win * 1.5) : r.mode === "pre" ? Math.min(r.end, quiet(r.end, s + 0.03, Infinity, win, 0)) : quiet(r.end, s + 0.03, Infinity);
    return en - s >= 0.03 ? { start: s, end: en } : { start: r.start, end: r.end };
  });
}

/** Rythme du montage : quels silences retirer et quelle pause garder (inspiré d'auto-editor : seuil + marge). */
export type Rhythm = "calm" | "natural" | "punchy";
export const RHYTHM: Record<Rhythm, { label: string; longSilence: number; keepPause: number }> = {
  calm: { label: "Posé", longSilence: 1.2, keepPause: 0.5 },
  natural: { label: "Naturel", longSilence: 0.7, keepPause: 0.3 },
  punchy: { label: "Dynamique", longSilence: 0.3, keepPause: 0.1 },
};

export function analyze(words: Word[], opt: Partial<AnalysisOptions> = {}): Suggestion[] {
  const o = { ...DEFAULTS, ...opt };
  const emph = new Set(o.emphaticWords.map(norm)), fill = new Set(o.fillers.map(norm));
  const n = words.map((w) => norm(w.text));
  const out: Suggestion[] = []; const used = new Set<number>();
  const push = (type: IssueType, a: number, b: number, confidence: number) => {
    for (let i = a; i <= b; i++) if (used.has(i)) return;
    for (let i = a; i <= b; i++) used.add(i);
    out.push({ id: `${type}-${a}-${b}`, type, firstWord: a, lastWord: b, confidence: Math.max(0, Math.min(1, confidence)),
      range: { start: words[a].start, end: words[b].end }, excerpt: words.slice(a, b + 1).map((w) => w.text).join(" ") });
  };
  const conf = (i: number) => words[i].conf ?? 0.8;

  // 0. Commande vocale de reprise (« je reprends », « on recommence », « coupez »…) dite pendant la prise, suivie d'une pause :
  //    la tentative en cours (depuis la dernière vraie pause ou fin de phrase, ≤ 20 s) et la commande sont retirées.
  for (let i = 0; i < words.length; i++) {
    const L = retakeAt(n, i); if (!L) continue;
    const e = i + L - 1, after = e + 1 < words.length ? words[e + 1].start - words[e].end : 99;
    if (after < 0.3) continue; // « je reprends ma voiture » : pas de pause → phrase normale
    let j = i; const t0 = words[i].start;
    while (j > 0 && t0 - words[j - 1].start < 20 && words[j].start - words[j - 1].end < 0.6 && !/[.!?…]$/.test(words[j - 1].text) && !used.has(j - 1)) j--;
    if (L === 1 && i === j && after < 0.5) continue; // « coupe » isolé sans pause nette : prudence
    push("retake", j, e, 0.96);
    if (out.length && out[out.length - 1].type === "retake") out[out.length - 1].range.end = Math.min(words[e].end + Math.max(0, after - 0.2), e + 1 < words.length ? words[e + 1].start - 0.05 : words[e].end + 0.3);
    i = e;
  }
  // 1. Phrases recommencées (n-grammes consécutifs identiques) — avant les mots seuls. On supprime la 1re occurrence.
  for (let len = o.maxPhrase; len >= 2; len--) {
    for (let i = 0; i + 2 * len <= words.length; i++) {
      let same = true;
      for (let k = 0; k < len && same; k++) same = n[i + k] !== "" && n[i + k] === n[i + len + k];
      if (same && words[i + len].start - words[i + len - 1].end <= o.maxRepeatGap * 2)
        push("false_start", i, i + len - 1, 0.7 + 0.05 * Math.min(len, 4));
    }
  }
  for (let i = 0; i < words.length; i++) {
    if (used.has(i)) continue;
    // 2. Hésitations
    if (fill.has(n[i])) { push("hesitation", i, i, 0.9 * Math.min(1, conf(i) + 0.2)); continue; }
    // 2 bis. Tics de langage (« du coup », « en fait », « tu vois », « genre »…) : seulement s'ils sont isolés (pause ou virgule)
    const tl = ticAt(n, i, o.tics);
    if (tl) {
      const e = i + tl - 1, before = i === 0 || words[i].start - words[i - 1].end >= 0.15 || /[,.!?…;:]$/.test(words[i - 1].text);
      const after = e + 1 >= words.length || words[e + 1].start - words[e].end >= 0.15 || /[,.!?…;:]$/.test(words[e].text);
      const endOnly = tl === 1 && (n[i] === "quoi" || n[i] === "hein");
      if ((endOnly && after && i > 0) || (!endOnly && before && after)) { push("filler_word", i, e, 0.72); i = e; continue; }
      if (!endOnly && (before || after)) { push("filler_word", i, e, 0.4); i = e; continue; } // proposé, pas retiré d'office
    }
    // 3. Mots répétés
    if (i + 1 < words.length && n[i] && n[i] === n[i + 1] && words[i + 1].start - words[i].end <= o.maxRepeatGap) {
      let c = 0.85; if (emph.has(n[i])) c = 0.4; if (n[i].length <= 2) c += 0.05;
      push("repetition", i, i, c * (0.6 + 0.4 * conf(i))); continue;
    }
    // 4. Bégaiement : fragment court, préfixe du mot suivant (« par particulièrement », « p-présenter »)
    const nx = n[i + 1];
    if (nx && n[i].length >= 1 && n[i].length <= 3 && n[i].length < nx.length && nx.startsWith(n[i]) && words[i + 1].start - words[i].end <= o.maxRepeatGap)
      push("stutter", i, i, 0.65 * (0.6 + 0.4 * conf(i)));
  }
  // 5. Silences longs : plage = le silence en excès (on garde une pause naturelle de 0,4 s)
  for (let i = 0; i + 1 < words.length; i++) {
    const gap = words[i + 1].start - words[i].end;
    if (gap >= o.longSilence) {
      const keep = o.keepPause, s = words[i].end + keep / 2, e = words[i + 1].start - keep / 2;
      out.push({ id: `long_silence-${i}`, type: "long_silence", firstWord: i, lastWord: i + 1, range: { start: s, end: e },
        excerpt: `[silence ${gap.toFixed(1)} s]`, confidence: Math.min(0.95, 0.5 + (gap - o.longSilence) * 0.2) });
    }
  }
  return out.sort((a, b) => a.range.start - b.range.start);
}


/* ---------- Analyse du son : ce que Whisper « nettoie » ---------- */
// Whisper transcrit la parole « propre » : « je-je-je vais » devient « je vais », « p-p-présenter » devient « présenter »,
// les « euh » disparaissent souvent. On compare donc le son réel aux mots transcrits.

/** Trames de 20 ms : niveau RMS + seuil de voix adaptatif (plancher de bruit, et −30 dB sous le maximum). */
export function voiceFrames(pcm: Float32Array, rate: number) {
  const fr = Math.max(1, Math.round(rate * 0.02)), n = Math.floor(pcm.length / fr), lv = new Float32Array(n);
  for (let k = 0; k < n; k++) { let a = 0; for (let i = k * fr; i < (k + 1) * fr; i++) a += pcm[i] * pcm[i]; lv[k] = Math.sqrt(a / fr); }
  const sorted = Array.from(lv).sort((x, y) => x - y), floor = sorted[Math.floor(n * 0.1)] ?? 0, peak = sorted[Math.floor(n * 0.995)] ?? 0;
  const th = Math.max(floor * 4, peak * 0.03, 1e-3), on = new Uint8Array(n);
  for (let k = 0; k < n; k++) on[k] = lv[k] > th ? 1 : 0;
  return { on, dt: fr / rate };
}

/**
 * Voyelles tenues (« euuuh », « mmm ») : trames voisées dont le niveau et le timbre ne bougent presque pas pendant ≥ minDur.
 * La parole normale change de son toutes les 80–150 ms ; un « euh » reste stable. Renvoie les plages trouvées (s).
 */
export function steadyRuns(pcm: Float32Array, rate: number, minDur = 0.25): { start: number; end: number; stab: number }[] {
  const fr = Math.max(1, Math.round(rate * 0.02)), n = Math.floor(pcm.length / fr);
  const db = new Float32Array(n), hf = new Float32Array(n), zc = new Float32Array(n);
  for (let k = 0; k < n; k++) { let e = 0, d = 0, z = 0, p = pcm[k * fr];
    for (let i = k * fr; i < (k + 1) * fr; i++) { const x = pcm[i]; e += x * x; const q = x - p; d += q * q; if ((x >= 0) !== (p >= 0)) z++; p = x; }
    db[k] = 10 * Math.log10(e / fr + 1e-12); hf[k] = Math.sqrt(d / (e + 1e-12)); zc[k] = z / fr; }
  const { on } = voiceFrames(pcm, rate), W = 2, steady = new Uint8Array(n);
  for (let k = W; k < n - W; k++) {
    let ok = 1, mD = 0, mH = 0, mZ = 0; for (let j = -W; j <= W; j++) { if (!on[k + j] || hf[k + j] > 0.7 || zc[k + j] > 0.12) { ok = 0; break; } mD += db[k + j]; mH += hf[k + j]; mZ += zc[k + j]; }
    if (!ok) continue; mD /= 2 * W + 1; mH /= 2 * W + 1; mZ /= 2 * W + 1;
    let vD = 0, vH = 0, vZ = 0; for (let j = -W; j <= W; j++) { vD += (db[k + j] - mD) ** 2; vH += (hf[k + j] - mH) ** 2; vZ += (zc[k + j] - mZ) ** 2; }
    if (Math.sqrt(vD / (2 * W + 1)) < 1.6 && Math.sqrt(vH / (2 * W + 1)) < 0.045 && Math.sqrt(vZ / (2 * W + 1)) < 0.012) steady[k] = 1;
  }
  const out: { start: number; end: number; stab: number }[] = []; const dt = fr / rate;
  for (let k = 0; k < n; ) { if (!steady[k]) { k++; continue; } let e = k; while (e < n && steady[e]) e++;
    const s0 = (k - W) * dt, s1 = (e + W) * dt; if (s1 - s0 >= minDur) out.push({ start: s0, end: s1, stab: (e - k) / Math.max(1, e - k + 2 * W) }); k = e; }
  return out;
}

export function analyzeAudio(words: Word[], pcm: Float32Array, rate: number, taken: Suggestion[] = []): Suggestion[] {
  if (!words.length || !pcm.length) return [];
  const { on, dt } = voiceFrames(pcm, rate), fr = Math.max(1, Math.round(rate * dt)), out: Suggestion[] = [];
  const busy = (a: number, b: number) => taken.some((s) => s.range.start < b && s.range.end > a);
  const voicedIn = (a: number, b: number) => { let v = 0; for (let k = Math.max(0, Math.floor(a / dt)); k < Math.min(on.length, Math.ceil(b / dt)); k++) v += on[k]; return v * dt; };

  const runs = steadyRuns(pcm, rate);
  const isEuh = (a: number, b: number) => runs.some((r) => Math.min(b, r.end) - Math.max(a, r.start) >= 0.6 * (b - a));
  // 1. Voix entre deux mots, sans mot transcrit (bégaiement, « euh » effacé, syllabe répétée)
  for (let i = -1; i < words.length; i++) {
    const a = i >= 0 ? words[i].end + 0.06 : 0, b = i + 1 < words.length ? words[i + 1].start - 0.06 : pcm.length / rate;
    if (b - a < 0.12) continue;
    // plus longue plage de voix continue (tolère des micro-coupures de 40 ms) dans le trou
    let best: [number, number] | null = null, s0 = -1, gap = 0;
    for (let k = Math.floor(a / dt); k <= Math.min(on.length, Math.ceil(b / dt)); k++) {
      const v = k < on.length && k * dt < b ? on[k] : 0;
      if (v) { if (s0 < 0) s0 = k; gap = 0; } else if (s0 >= 0 && ++gap > 2) { const e = k - gap + 1; if (!best || e - s0 > best[1] - best[0]) best = [s0, e]; s0 = -1; gap = 0; }
    }
    if (!best) continue;
    const st = best[0] * dt, en = best[1] * dt, d = en - st;
    // déjà couvert entièrement (ex. coupe de silence) : rien à ajouter ; s'il déborde (début de « donc »…), on complète
    const fully = taken.some((t) => t.range.start <= st + 0.02 && t.range.end >= en - 0.02);
    if (d < 0.12 || d > 2.5 || fully) continue;
    const next = words[i + 1], lo = i >= 0 ? words[i].end : 0, hi = next ? next.start : pcm.length / rate;
    const eu = isEuh(st, en);
    out.push({ id: `untranscribed-${i + 1}`, type: eu ? "hesitation" : "untranscribed", firstWord: Math.max(0, i + 1 < words.length ? i + 1 : i), lastWord: Math.max(0, i + 1 < words.length ? i + 1 : i),
      range: { start: Math.max(lo, st - 0.03), end: Math.min(hi, en + 0.03) }, confidence: eu ? 0.85 : Math.min(0.85, 0.55 + d * 0.4),
      excerpt: eu ? `[« euh » ${d.toFixed(1).replace(".", ",")} s]${next ? ` avant « ${next.text} »` : ""}` : `[son non transcrit ${d.toFixed(1).replace(".", ",")} s]${next ? ` avant « ${next.text} »` : ""}` });
  }
  // 2. Parole avalée : Whisper étire le mot qui SUIT une hésitation, une répétition ou un faux départ pour la couvrir
  //    (« voilà, voilà, ici » → « ici » de 1,1 s). Le vrai mot est à la fin : on coupe jusqu'à la dernière vraie pause du son.
  const expectedLen = (w: Word) => 0.065 * (w.text.replace(/[^\p{L}\p{N}]/gu, "").length || 1) + 0.18;
  const swallowed = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i], len = w.end - w.start, ex = expectedLen(w);
    if (len < ex + 0.3 || busy(w.start, w.end)) continue;
    if (runs.some((r) => r.end >= w.end - 0.1 && r.start < w.end - 0.15)) continue; // « et… euh » : le surplus est APRÈS le mot (règle 3)
    // dernière plage sans voix (≥ 60 ms) laissant au moins ~la moitié de la durée normale du mot après elle
    const kA = Math.floor((w.start + 0.06) / dt), kB = Math.min(on.length, Math.floor((w.end - Math.max(0.12, ex * 0.5)) / dt));
    let gapEnd = -1, run = 0;
    for (let k = kA; k < kB; k++) { if (!on[k]) run++; else { if (run * dt >= 0.06) gapEnd = k; run = 0; } }
    if (run * dt >= 0.06) gapEnd = kB;
    let end = gapEnd >= 0 ? gapEnd * dt - 0.03 : -1;
    if (gapEnd >= 0 && w.end - end <= ex + 0.12) { /* le reste a la durée du mot : coupe sur la pause */ }
    else if (len >= ex + 0.45 || gapEnd >= 0) { // enchaîné sans pause (ou reste encore trop long) : creux d'énergie juste avant le vrai mot
      const a = Math.max(gapEnd >= 0 ? gapEnd : kA, Math.floor((w.end - ex - 0.2) / dt)), b2 = Math.min(on.length - 1, Math.floor((w.end - 0.15) / dt)); let kb = -1, lv = Infinity;
      const dB = (k: number) => { let e = 0; const q0 = Math.max(0, k * fr), q1 = Math.min(pcm.length, (k + 1) * fr); for (let q = q0; q < q1; q++) e += pcm[q] * pcm[q]; return 10 * Math.log10(e / Math.max(1, q1 - q0) + 1e-12); };
      // le DERNIER creux marqué (≥ 5 dB sous le son avant et après, sur 60 ms) : la frontière juste avant le vrai mot
      for (let k = b2; k >= a && kb < 0; k--) { const e = dB(k); if (e > dB(k - 1) || e > dB(k + 1)) continue;
        const before = Math.max(dB(k - 1), dB(k - 2), dB(k - 3)), after = Math.max(dB(k + 1), dB(k + 2), dB(k + 3)); if (Math.min(before, after) - e >= 5) kb = k; }
      if (kb < 0) for (let k = a; k <= b2; k++) { const e = Math.pow(10, dB(k) / 10) * (1 + 0.6 * (b2 - k) / Math.max(1, b2 - a)); if (e < lv) { lv = e; kb = k; } } // sinon : le plus bas, de préférence tardif
      if (kb >= 0) end = kb * dt; else if (gapEnd < 0) continue;
    } else continue;
    const v = voicedIn(w.start, end);
    if (end - w.start < 0.15) continue;
    swallowed.add(i);
    out.push({ id: `swallowed-${i}`, type: v >= 0.15 ? "false_start" : "long_silence", firstWord: i, lastWord: i, range: { start: w.start, end },
      confidence: v >= 0.15 ? 0.75 : 0.6, excerpt: v >= 0.15 ? `[parole avalée ${(end - w.start).toFixed(1).replace(".", ",")} s] avant « ${w.text} »` : `[blanc ${(end - w.start).toFixed(1).replace(".", ",")} s] avant « ${w.text} »` });
  }
  // 2 bis. Mot anormalement long avec une coupure interne près du début : « p… présenter » — proposé seulement (un mot lent n'est pas un défaut)
  for (let i = 0; i < words.length; i++) {
    const w = words[i], len = w.end - w.start, chars = w.text.replace(/[^\p{L}\p{N}]/gu, "").length || 1;
    if (swallowed.has(i) || len < Math.max(0.45, 0.065 * chars + 0.2) || busy(w.start, w.end)) continue;
    let k0 = -1, run = 0, cut = -1;
    const kA = Math.floor((w.start + 0.06) / dt), kB = Math.floor((w.end - Math.min(0.25, len * 0.35)) / dt);
    for (let k = kA; k < kB && k < on.length; k++) {
      if (!on[k]) { if (k0 < 0) k0 = k; run++; } else { if (run * dt >= 0.08 && voicedIn(w.start, k0 * dt) >= 0.04) { cut = k; break; } k0 = -1; run = 0; }
    }
    if (cut < 0) continue;
    out.push({ id: `stutter-in-${i}`, type: "stutter", firstWord: i, lastWord: i, range: { start: w.start, end: cut * dt - 0.01 },
      confidence: 0.45, excerpt: `« ${w.text} » : début répété ?` });
  }
  // 3. « Euh » que Whisper a effacé : voyelle tenue dans un blanc, ou collée au début / à la fin d'un mot anormalement long
  const expected = (w: Word) => 0.065 * (w.text.replace(/[^\p{L}\p{N}]/gu, "").length || 1) + 0.18;
  const taken2 = (a: number, b: number) => busy(a, b) || out.some((s) => s.range.start < b && s.range.end > a);
  for (const r of runs) {
    const ov = words.filter((w) => w.start < r.end && w.end > r.start);
    let range: Range | null = null, conf = 0, why = "";
    if (!ov.length) { range = { start: r.start, end: r.end }; conf = 0.8; why = "« euh » entre deux mots"; }
    else if (ov.length === 1) {
      const w = ov[0], len = w.end - w.start, ex = expected(w);
      if (len > ex + 0.15) {
        if (r.start <= w.start + 0.08 && w.end - r.end >= 0.1) { range = { start: w.start, end: Math.min(r.end, w.end - 0.1) }; conf = 0.65; why = `« euh » avant « ${w.text} »`; }
        else if (r.end >= w.end - 0.08 && r.start - w.start >= 0.08) { range = { start: Math.max(r.start + 0.1, w.start + Math.min(ex, len * 0.6)), end: r.end }; conf = 0.65; why = `« euh » après « ${w.text} »`; }
      }
    }
    if (!range || range.end - range.start < 0.15 || taken2(range.start, range.end)) continue;
    out.push({ id: `filled-${Math.round(range.start * 100)}`, type: "hesitation", firstWord: Math.max(0, words.findIndex((w) => w.end >= range!.start)), lastWord: Math.max(0, words.findIndex((w) => w.end >= range!.start)),
      range, confidence: conf, excerpt: `[${why}, ${(range.end - range.start).toFixed(1).replace(".", ",")} s]` });
  }
  return out;
}
