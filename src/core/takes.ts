/** « Meilleure prise » : aligne la transcription sur le script (prompteur), même avec des reprises, puis garde pour chaque
 *  phrase la prise la plus complète (la plus récente à égalité) et retire les essais ratés, les reprises et le hors-script.
 *  Pur, sans DOM. */
import type { Range, Word } from "./timeline.ts";
import { normWord } from "./prompter.ts";

export interface Sentence { text: string; a: number; b: number } // indices de mots du script [a, b]
export interface TakeResult {
  cuts: Range[];
  kept: { sentence: number; first: number; last: number; coverage: number }[]; // mots de transcription gardés par phrase
  retakes: number;          // phrases dites plusieurs fois (reprises retirées)
  missing: string[];        // phrases du script non dites (couverture < 50 %)
  matched: (number | -1)[]; // pour chaque mot transcrit : index du mot du script, ou -1
}

/** Découpe le script en phrases (ponctuation forte ou retour à la ligne) et en mots normalisés. */
export function scriptSentences(script: string): { words: string[]; sentences: Sentence[] } {
  const words: string[] = [], sentences: Sentence[] = [];
  for (const raw of script.split(/(?<=[.!?…])\s+|\n+/)) {
    const t = raw.trim(); if (!t) continue;
    const ws = t.split(/\s+/).map(normWord).filter(Boolean); if (!ws.length) continue;
    sentences.push({ text: t, a: words.length, b: words.length + ws.length - 1 }); words.push(...ws);
  }
  return { words, sentences };
}

/** Mots équivalents malgré les erreurs de transcription : identiques, même début (≥ 4 lettres) ou une lettre d'écart. */
export function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4)) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return e + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Alignement (programmation dynamique, type Viterbi) : chaque mot transcrit est soit un mot du script, soit « hors script ».
 * Coûts : mot hors script 1,1 ; mot suivant du script 0 ; saut en avant 1,5 ; RETOUR en arrière (reprise) 2.
 */
export function alignToScript(script: string[], heard: string[]): (number | -1)[] {
  const S = script.length, T = heard.length, INF = Infinity;
  // état s = position atteinte dans le script (0 = rien dit encore ; s = le mot s−1 vient d'être dit)
  let cost = new Float64Array(S + 1).fill(INF); cost[0] = 0;
  const bp: Map<number, number>[] = [];
  const pre = new Float64Array(S + 1), preA = new Int32Array(S + 1), suf = new Float64Array(S + 2), sufA = new Int32Array(S + 2);
  for (let i = 0; i < T; i++) {
    // minimums préfixes / suffixes : meilleur état avant (saut en avant) ou après (retour en arrière = reprise)
    for (let k = 0; k <= S; k++) { const v = cost[k]; if (k === 0 || v < pre[k - 1]) { pre[k] = v; preA[k] = k; } else { pre[k] = pre[k - 1]; preA[k] = preA[k - 1]; } }
    suf[S + 1] = INF; sufA[S + 1] = S;
    for (let k = S; k >= 0; k--) { const v = cost[k]; if (v < suf[k + 1]) { suf[k] = v; sufA[k] = k; } else { suf[k] = suf[k + 1]; sufA[k] = sufA[k + 1]; } }
    // mot hors script : 1,1 (un peu plus qu'1, pour qu'une reprise de 2 mots ou plus soit reconnue comme telle plutôt que comme hors-script)
    const next = new Float64Array(S + 1); for (let k = 0; k <= S; k++) next[k] = cost[k] + 1.1;
    const upd = new Map<number, number>();
    for (let j = 0; j < S; j++) {
      if (!similar(script[j], heard[i])) continue;
      const s = j + 1;
      let best = cost[j], from = j;                                          // suite naturelle : 0
      if (j >= 1 && pre[j - 1] + 1.5 < best) { best = pre[j - 1] + 1.5; from = preA[j - 1]; } // saut en avant (mots sautés)
      if (suf[s] + 2 < best) { best = suf[s] + 2; from = sufA[s]; }          // retour en arrière : reprise d'une phrase
      if (best < next[s]) { next[s] = best; upd.set(s, from); }
    }
    cost = next; bp.push(upd);
  }
  let s = 0, best = INF; for (let k = 0; k <= S; k++) if (cost[k] < best) { best = cost[k]; s = k; }
  const out: (number | -1)[] = new Array(T).fill(-1);
  for (let i = T - 1; i >= 0; i--) { const f = bp[i].get(s); if (f !== undefined) { out[i] = s - 1; s = f; } }
  return out;
}

/** Choisit la meilleure prise de chaque phrase et renvoie les coupes (pause naturelle de 0,16 s gardée à chaque raccord). */
export function bestTakes(words: Word[], script: string, duration: number): TakeResult {
  const { words: sw, sentences } = scriptSentences(script);
  const heard = words.map((w) => normWord(w.text));
  const matched = alignToScript(sw, heard);
  // essais : suites de mots appariés dont la position dans le script progresse ; un retour en arrière ouvre un nouvel essai
  const attempt: number[] = new Array(words.length).fill(-1); let cur = -1, lastPos = -1;
  matched.forEach((m, i) => { if (m < 0) return; if (cur < 0 || m <= lastPos) cur++; attempt[i] = cur; lastPos = m; });
  const kept: TakeResult["kept"] = [], missing: string[] = []; let retakes = 0, after = -1;
  sentences.forEach((st, si) => {
    const per = new Map<number, number[]>(); // essai → mots transcrits appariés dans cette phrase
    matched.forEach((m, i) => { if (m >= st.a && m <= st.b && i > after) { const k = attempt[i]; (per.get(k) ?? per.set(k, []).get(k)!).push(i); } });
    if (per.size > 1) retakes++;
    let pick: number[] | null = null, cov = 0;
    for (const idx of per.values()) { const c = new Set(idx.map((i) => matched[i])).size / (st.b - st.a + 1); if (c >= cov) { cov = c; pick = idx; } }
    if (!pick || cov < 0.5) { missing.push(st.text); if (!pick) return; }
    kept.push({ sentence: si, first: pick[0], last: pick[pick.length - 1], coverage: cov }); after = pick[pick.length - 1];
  });
  // tout mot hors des phrases gardées est coupé ; les mots non reconnus À L'INTÉRIEUR d'une phrase gardée restent
  const keep = new Array(words.length).fill(false);
  for (const k of kept) for (let i = k.first; i <= k.last; i++) keep[i] = true;
  const cuts: Range[] = []; const pad = 0.08;
  let i = 0;
  while (i < words.length) {
    if (keep[i]) { i++; continue; }
    let j = i; while (j + 1 < words.length && !keep[j + 1]) j++;
    const start = i > 0 ? words[i - 1].end + pad : 0, end = j + 1 < words.length ? words[j + 1].start - pad : duration;
    if (end - start > 0.05) cuts.push({ start, end });
    i = j + 1;
  }
  // entre deux phrases gardées qui viennent d'essais différents, il n'y a parfois aucun mot à couper mais une longue pause
  for (let k = 1; k < kept.length; k++) {
    const a = words[kept[k - 1].last], b = words[kept[k].first];
    if (kept[k].first === kept[k - 1].last + 1 && b.start - a.end > 0.6) cuts.push({ start: a.end + pad, end: b.start - pad });
  }
  return { cuts, kept, retakes, missing, matched };
}
