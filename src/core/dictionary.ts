/** Dictionnaire personnel : mots que la transcription écorche (noms propres, titres…) → bonne écriture.
 *  Appliqué après chaque transcription ; les bonnes écritures servent aussi d'indice à Whisper (amorce) et aux sous-titres. */
import type { Word } from "./timeline.ts";

export interface DictEntry { from: string; to: string }
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const tail = (s: string) => s.match(/[.,!?…;:]+$/)?.[0] ?? "";

/** Remplace chaque occurrence (un ou plusieurs mots, sans tenir compte des accents, majuscules et ponctuation). */
export function applyDictionary(words: Word[], dict: DictEntry[]): Word[] {
  const rules = dict.map((d) => ({ keys: d.from.trim().split(/\s+/).map(fold).filter(Boolean), to: d.to.trim() })).filter((r) => r.keys.length && r.to)
    .sort((a, b) => b.keys.length - a.keys.length);
  if (!rules.length) return words;
  const n = words.map((w) => fold(w.text)), out: Word[] = [];
  for (let i = 0; i < words.length; ) {
    const r = rules.find((r) => r.keys.every((k, j) => n[i + j] === k));
    if (!r) { out.push(words[i++]); continue; }
    const last = words[i + r.keys.length - 1];
    out.push({ ...words[i], text: r.to + tail(last.text), end: last.end }); i += r.keys.length;
  }
  return out;
}

/** Bonnes écritures à souffler à Whisper (les plus courtes d'abord, 8 au plus : une amorce longue le fait décrocher). */
export function vocabHints(dict: DictEntry[], max = 8): string[] {
  return [...new Set(dict.map((d) => d.to.trim()).filter(Boolean))].sort((a, b) => a.length - b.length).slice(0, max);
}

/** Toutes les occurrences d'une expression dans les mots : indices [premier, dernier]. */
export function findPhrase(words: Word[], phrase: string): [number, number][] {
  const keys = phrase.trim().split(/\s+/).map(fold).filter(Boolean), n = words.map((w) => fold(w.text)), out: [number, number][] = [];
  if (!keys.length) return out;
  for (let i = 0; i + keys.length <= words.length; i++) if (keys.every((k, j) => n[i + j] === k)) { out.push([i, i + keys.length - 1]); i += keys.length - 1; }
  return out;
}
