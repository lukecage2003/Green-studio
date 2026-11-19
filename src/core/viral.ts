/** Outils « rétention TikTok » : contrôle de l'accroche, passages sans changement à l'écran, emojis des sous-titres.
 *  Fonctions pures (testées) ; l'interface les affiche. */
import type { Range, Word } from "./timeline.ts";
import { sourceToEdited, editedToSource } from "./timeline.ts";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9' ]/g, "").trim();
const isCutAt = (cuts: Range[], t: number) => cuts.some((c) => t >= c.start && t < c.end);
const GREET = /^(salut|bonjour|coucou|hello|hey|yo|wesh|bonsoir|bienvenue|aujourd'?hui on|aujourd'?hui je|dans cette video|alors aujourd'?hui|petite video|nouvelle video)/;
const FILLER = /^(euh+|heu+|hum+|bah|ben|bon|alors|donc|du coup|voila)$/;
const STRONG = /\?|!|\d|jamais|personne|secret|verite|vrai|faux|pourquoi|comment|et si|incroyable|choquant|cache|mort|meurt|tue|plus fort|le pire|le meilleur|retcon|theorie|en realite|enfin|interdit|oublie|perdu/;

export interface HookReport { score: number; lead: number; issues: string[]; candidates: string[] }

/** Phrases (mots gardés) dans l'ordre, avec leurs indices de mots. */
export function keptSentences(words: Word[], cuts: Range[]): { text: string; a: number; b: number }[] {
  const out: { text: string; a: number; b: number }[] = []; let a = -1, buf: string[] = [];
  words.forEach((w, i) => {
    if (isCutAt(cuts, (w.start + w.end) / 2)) return;
    if (!/[\p{L}\p{N}]/u.test(w.text)) { if (a < 0 || !/[.!?…]/.test(w.text)) return; buf[buf.length - 1] += " " + w.text.trim(); } // « ? » seul : rattaché au mot précédent
    else { if (a < 0) a = i; buf.push(w.text); }
    if (a >= 0 && /[.!?…]$/.test(w.text)) { out.push({ text: buf.join(" "), a, b: i }); a = -1; buf = []; }
  });
  if (buf.length) out.push({ text: buf.join(" "), a, b: words.length - 1 });
  return out;
}

/**
 * Accroche : TikTok décide en 1 à 2 s. On vérifie le début du montage (silence avant le premier mot, salutation, tic,
 * phrase trop longue) et on propose jusqu'à 3 phrases plus fortes de la vidéo pour l'ouvrir.
 */
export function hookCheck(words: Word[], cuts: Range[], duration: number): HookReport {
  const ss = keptSentences(words, cuts), issues: string[] = [];
  const kw = words.filter((w) => !isCutAt(cuts, (w.start + w.end) / 2) && /[\p{L}\p{N}]/u.test(w.text));
  if (!kw.length) return { score: 0, lead: 0, issues: ["Aucune parole gardée."], candidates: [] };
  const lead = sourceToEdited(kw[0].start, duration, cuts);
  let score = 100;
  if (lead > 0.5) { issues.push(`${lead.toFixed(1).replace(".", ",")} s avant le premier mot : coupez le blanc du début.`); score -= Math.min(35, lead * 25); }
  const first3 = kw.slice(0, 4).map((w) => fold(w.text)).join(" ");
  if (GREET.test(first3)) { issues.push("Vous commencez par une salutation : entrez directement dans le sujet (la présentation peut venir après)."); score -= 30; }
  const early = kw.filter((w) => sourceToEdited(w.start, duration, cuts) < 2.5);
  if (early.some((w) => FILLER.test(fold(w.text)))) { issues.push("Un « euh / alors / bon » dans les 2 premières secondes."); score -= 15; }
  const s0 = ss[0];
  if (s0 && s0.b - s0.a + 1 > 16) { issues.push("Première phrase longue : visez moins de 12 mots."); score -= 10; }
  if (s0 && !STRONG.test(fold(s0.text))) { issues.push("La première phrase n'intrigue pas : question, chiffre, secret, « personne ne sait que… »."); score -= 15; }
  const candidates = ss.slice(1).filter((s) => { const n = s.b - s.a + 1; return n >= 4 && n <= 18 && STRONG.test(fold(s.text)); })
    .sort((x, y) => (/\?/.test(y.text) ? 1 : 0) - (/\?/.test(x.text) ? 1 : 0) || (x.b - x.a) - (y.b - y.a)).slice(0, 3).map((s) => s.text);
  return { score: Math.max(0, Math.round(score)), lead, issues, candidates };
}

/**
 * Passages « statiques » : plus de maxGap secondes (temps du montage) sans rien de nouveau à l'écran.
 * changes = instants (temps source) où l'image change : raccords, zooms, images, titres, annotations…
 * Renvoie des plages en temps source.
 */
export function staticGaps(changes: number[], duration: number, cuts: Range[], maxGap = 3.5): Range[] {
  const total = sourceToEdited(duration, duration, cuts);
  const e = [0, ...changes.filter((t) => t >= 0 && t <= duration && !isCutAt(cuts, t)).map((t) => sourceToEdited(t, duration, cuts)), total].sort((a, b) => a - b);
  const out: Range[] = [];
  for (let i = 1; i < e.length; i++) if (e[i] - e[i - 1] > maxGap) out.push({ start: editedToSource(e[i - 1] + 0.05, duration, cuts), end: editedToSource(e[i] - 0.05, duration, cuts) });
  return out;
}

/** Mots qui appellent un emoji dans les sous-titres (forme repliée, sans accents). */
const EMOJI: [RegExp, string][] = [
  [/^(mort|morte|meurt|mourir|tue|tuer|tues|decede)/, "💀"], [/^(feu|bruler|brule|flamme|enflamm)/, "🔥"], [/^(choc|choque|choquant|incroyable|dingue|ouf|fou|folle)/, "😱"],
  [/^(secret|cache|cachee|mystere|mysterieux)/, "🤫"], [/^(argent|riche|milliard|million|dollar)/, "💰"], [/^(amour|aime|amoureu|coeur)/, "❤️"],
  [/^(fort|puissant|puissance|pouvoir|pouvoirs|force)/, "💪"], [/^(rire|drole|blague|marrant)/, "😂"], [/^(question|pourquoi|comment)$/, "🤔"],
  [/^(explos|bombe|boum|boom)/, "💥"], [/^(eclair|foudre|electri)/, "⚡"], [/^(espace|cosmique|galaxie|planete|univers|multivers)/, "🌌"],
  [/^(dieu|dieux|divin)/, "👑"], [/^(sang|sanglant)/, "🩸"], [/^(film|films|cinema)$/, "🎬"], [/^(comic|comics|bd)$/, "📚"], [/^(verite|vrai)$/, "✅"], [/^(faux|mensonge|ment)$/, "❌"],
];
export function emojiFor(text: string): string | null {
  const k = fold(text).replace(/'/g, " ").split(" ").pop() ?? "";
  if (k.length < 2) return null;
  for (const [re, e] of EMOJI) if (re.test(k)) return e;
  return null;
}
