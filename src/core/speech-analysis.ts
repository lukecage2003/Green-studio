/** SpeechAnalysisEngine : suggestions de coupes à partir des mots horodatés. Ne supprime jamais rien : propose seulement. */
import type { Range, Word } from "./timeline.ts";

export type IssueType = "retake" | "repetition" | "stutter" | "false_start" | "hesitation" | "long_silence" | "untranscribed";
export interface Suggestion { id: string; type: IssueType; range: Range; firstWord: number; lastWord: number; excerpt: string; confidence: number }

export interface AnalysisOptions {
  maxRepeatGap: number;      // s entre deux occurrences d'un mot répété
  longSilence: number;       // s
  fillers: string[];
  emphaticWords: string[];   // répétitions souvent volontaires : confiance réduite
  maxPhrase: number;         // taille max (mots) d'une phrase recommencée
}
export const DEFAULTS: AnalysisOptions = {
  maxRepeatGap: 0.8, longSilence: 1.5, maxPhrase: 5,
  fillers: ["euh", "heu", "hum", "hmm", "mmh", "euhh", "bah", "ben"],
  emphaticWords: ["très", "bien", "trop", "vraiment", "super", "beaucoup", "non", "oui", "jamais", "toujours"],
};

export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9']/g, "");

const RETAKE = [["je", "reprends"], ["je", "reprend"], ["on", "reprend"], ["je", "recommence"], ["on", "recommence"], ["je", "la", "refais"], ["on", "la", "refait"], ["coupez"], ["coupe"]];
/** Longueur de la commande de reprise qui commence au mot i (0 si aucune). */
function retakeAt(n: string[], i: number): number {
  for (const c of RETAKE) if (c.every((x, k) => n[i + k] === x)) return c.length;
  return 0;
}

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
      const keep = 0.4, s = words[i].end + keep / 2, e = words[i + 1].start - keep / 2;
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

export function analyzeAudio(words: Word[], pcm: Float32Array, rate: number, taken: Suggestion[] = []): Suggestion[] {
  if (!words.length || !pcm.length) return [];
  const { on, dt } = voiceFrames(pcm, rate), out: Suggestion[] = [];
  const busy = (a: number, b: number) => taken.some((s) => s.range.start < b && s.range.end > a);
  const voicedIn = (a: number, b: number) => { let v = 0; for (let k = Math.max(0, Math.floor(a / dt)); k < Math.min(on.length, Math.ceil(b / dt)); k++) v += on[k]; return v * dt; };

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
    if (d < 0.12 || d > 2.5 || busy(st, en)) continue;
    const next = words[i + 1], lo = i >= 0 ? words[i].end : 0, hi = next ? next.start : pcm.length / rate;
    out.push({ id: `untranscribed-${i + 1}`, type: "untranscribed", firstWord: Math.max(0, i + 1 < words.length ? i + 1 : i), lastWord: Math.max(0, i + 1 < words.length ? i + 1 : i),
      range: { start: Math.max(lo, st - 0.03), end: Math.min(hi, en + 0.03) }, confidence: Math.min(0.85, 0.55 + d * 0.4),
      excerpt: `[son non transcrit ${d.toFixed(1).replace(".", ",")} s]${next ? ` avant « ${next.text} »` : ""}` });
  }
  // 2. Mot anormalement long avec une coupure interne près du début : « p… présenter », « je… je » fusionnés en un mot
  for (let i = 0; i < words.length; i++) {
    const w = words[i], len = w.end - w.start, chars = w.text.replace(/[^\p{L}\p{N}]/gu, "").length || 1;
    if (len < Math.max(0.45, 0.065 * chars + 0.2) || busy(w.start, w.end)) continue;
    let k0 = -1, run = 0, cut = -1;
    const kA = Math.floor((w.start + 0.06) / dt), kB = Math.floor((w.end - Math.min(0.25, len * 0.35)) / dt);
    for (let k = kA; k < kB && k < on.length; k++) {
      if (!on[k]) { if (k0 < 0) k0 = k; run++; } else { if (run * dt >= 0.08 && voicedIn(w.start, k0 * dt) >= 0.04) { cut = k; break; } k0 = -1; run = 0; }
    }
    if (cut < 0) continue;
    out.push({ id: `stutter-in-${i}`, type: "stutter", firstWord: i, lastWord: i, range: { start: w.start, end: cut * dt - 0.01 },
      confidence: 0.6, excerpt: `« ${w.text} » : début répété` });
  }
  return out;
}
