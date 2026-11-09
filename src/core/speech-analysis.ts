/** SpeechAnalysisEngine : suggestions de coupes à partir des mots horodatés. Ne supprime jamais rien : propose seulement. */
import type { Range, Word } from "./timeline.ts";

export type IssueType = "repetition" | "stutter" | "false_start" | "hesitation" | "long_silence";
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
