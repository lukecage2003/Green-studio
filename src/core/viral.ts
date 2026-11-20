/** Outils « rétention TikTok » : contrôle de l'accroche, passages sans changement à l'écran, emojis des sous-titres.
 *  Fonctions pures (testées) ; l'interface les affiche. */
import type { Range, Word } from "./timeline.ts";
import { sourceToEdited, editedToSource } from "./timeline.ts";
import type { Title } from "./overlay.ts";

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

/* ---------- Habillage déclenché par la parole ---------- */
const NUM: Record<string, number> = { un: 1, une: 1, premier: 1, premiere: 1, deux: 2, deuxieme: 2, trois: 3, troisieme: 3, quatre: 4, quatrieme: 4, cinq: 5, cinquieme: 5, six: 6, sixieme: 6, sept: 7, septieme: 7, huit: 8, huitieme: 8, neuf: 9, neuvieme: 9, dix: 10, dixieme: 10 };
const numOf = (s: string) => { const f = fold(s).replace(/[^a-z0-9]/g, ""); return /^\d{1,2}$/.test(f) ? +f : NUM[f] ?? null; };
const bare = (s: string) => s.replace(/^[«"“(]+|[»"”),.;:!?…]+$/g, "");

/**
 * Ce que vous dites devient de l'habillage (temps source, mots gardés seulement) :
 *  - « numéro 3 : Venom », « en numéro 3, Venom », « à la troisième place, Venom » → classement ;
 *  - « c'est quoi la Force Phénix ? », « qu'est-ce que le multivers », « on appelle ça… » → concept en grand ;
 *  - « Terre-616 » → repère d'univers ;
 *  - une année dite (1938…2099) → repère d'époque ; au moins deux années à moins de 25 s d'écart → frise (« 1984 le costume noir ; 1988 … »).
 */
export function autoDress(words: Word[], cuts: Range[]): Title[] {
  const kw: Word[] = [], out: Title[] = [];
  for (const w of words) { if (isCutAt(cuts, (w.start + w.end) / 2)) continue; if (/[\p{L}\p{N}]/u.test(w.text)) kw.push({ ...w }); else if (kw.length) kw[kw.length - 1].text += w.text.trim(); } // « ? » seul : rattaché au mot d'avant
  const f = kw.map((w) => fold(bare(w.text))), id = (k: string, t: number) => `auto-${k}-${Math.round(t * 100)}`;
  const nameAfter = (j: number) => { const ws: string[] = []; for (let k = j; k < kw.length && ws.length < 4; k++) { const b = bare(kw[k].text); if (!b) break; if (ws.length && !/^\p{Lu}/u.test(b)) break; if (!ws.length && !/^\p{Lu}/u.test(b)) return null; ws.push(b); if (/[,.;:!?…]$/.test(kw[k].text)) break; } return ws.length ? ws.join(" ") : null; };
  for (let i = 0; i < kw.length; i++) {
    // classement
    let n: number | null = null, j = -1;
    if ((f[i] === "numero" || f[i] === "top" || f[i] === "n") && i + 1 < kw.length) { n = numOf(kw[i + 1].text); j = i + 2; }
    else if (/^(place|position)$/.test(f[i] ?? "") && i >= 1) { n = numOf(kw[i - 1].text); j = i + 1; }
    if (n != null && n <= 20) { while (j < kw.length && /^(c'?est|cest|on a|il y a|avec|:|,)$/.test(f[j])) j++; const name = nameAfter(j);
      if (name && !out.some((o) => o.kind === "rank" && Math.abs(o.start - kw[i].start) < 2)) out.push({ id: id("rank", kw[i].start), kind: "rank", text: name, sub: String(n), start: Math.max(0, kw[i].start - 0.1), end: kw[i].start + 2.6 }); }
    // concept : « c'est quoi (la) Force Phénix ? », « qu'est-ce que le multivers », « on appelle ça la Speed Force »
    let tj = -1;
    if (/^(cest|c'est)$/.test(f[i]) && f[i + 1] === "quoi") tj = i + 2;
    else if (/^(qu'?est|quest)$/.test(f[i]) && /^(ce|-ce)$/.test(f[i + 1] ?? "") && /^(que|qu'?)/.test(f[i + 2] ?? "")) tj = i + 3;
    else if (f[i] === "appelle" && /^(ca|cela)$/.test(f[i + 1] ?? "")) tj = i + 2;
    if (tj > 0) {
      while (tj < kw.length && /^(le|la|les|l'?|un|une|des|ce|cette|cet|exactement|vraiment|donc)$/.test(f[tj]) && !/'./.test(kw[tj].text)) tj++;
      const t0 = kw[tj]?.text ?? "", parts: string[] = []; if (/^l'./i.test(t0)) { parts.push(bare(t0).slice(2)); tj++; }
      for (let q = tj; q < kw.length && parts.length < 4; q++) { const bw = bare(kw[q].text); if (!bw || (parts.length && /^(de|du|des|et|en|qui|que|dans|au|à|a)$/i.test(bw) && !/^\p{Lu}/u.test(kw[q + 1]?.text ?? ""))) break; parts.push(bw); if (/[,.;:!?…]$/.test(kw[q].text)) break; }
      while (parts.length && /^(de|du|des|et|en|la|le|les)$/i.test(parts[parts.length - 1])) parts.pop();
      const term = parts.join(" "); if (term.length >= 3 && !out.some((x) => x.kind === "term" && fold(x.text) === fold(term)))
        out.push({ id: id("term", kw[i].start), kind: "term", text: term.charAt(0).toUpperCase() + term.slice(1), sub: "Concept", start: kw[i].start, end: kw[i].start + 2.4 });
    }
    // univers : « Terre-616 », « Terre 1610 », « Earth-199999 »
    { const m = /^(terre|earth)-?(\d{2,6})?$/.exec(fold(bare(kw[i].text)).replace(/\s/g, "")), nx = bare(kw[i + 1]?.text ?? "");
      const num = m ? m[2] ?? (/^\d{2,6}$/.test(nx) ? nx : null) : null;
      if (m && num && !out.some((x) => x.kind === "tag" && x.text === `Terre-${num}` && Math.abs(x.start - kw[i].start) < 20)) out.push({ id: id("tag", kw[i].start), kind: "tag", text: `Terre-${num}`, sub: "Univers", start: kw[i].start, end: kw[i].start + 3 }); }
  }
  // frise : années dites, regroupées si moins de 25 s d'écart
  const years: { t: number; y: string; what: string }[] = [];
  kw.forEach((w, i) => { const b = bare(w.text); if (/^(19[3-9]\d|20\d\d)$/.test(b)) { const what: string[] = []; for (let k = i + 1; k < kw.length && what.length < 4 && !/[.!?…]$/.test(w.text); k++) { if (/^(19[3-9]\d|20\d\d)$/.test(bare(kw[k].text))) break; what.push(bare(kw[k].text)); if (/[,.;!?…]$/.test(kw[k].text)) break; } while (what.length && /^(et|en|puis|au|aux|à|a|dans|de|du|des|le|la|les|un|une|ou|mais)$/i.test(what[what.length - 1])) what.pop(); years.push({ t: w.start, y: b, what: what.join(" ") }); } });
  for (let a = 0; a < years.length;) {
    let b = a; while (b + 1 < years.length && years[b + 1].t - years[b].t < 25) b++;
    const g = years.slice(a, b + 1).filter((x, i, arr) => arr.findIndex((z) => z.y === x.y) === i);
    if (g.length === 1) out.push({ id: id("tag", g[0].t), kind: "tag", text: g[0].y, sub: "Époque", start: Math.max(0, g[0].t - 0.1), end: g[0].t + 3 });
    if (g.length >= 2) out.push({ id: id("timeline", g[0].t), kind: "timeline", text: "Les dates clés", sub: g.slice(0, 6).map((x) => `${x.y} ${x.what}`.trim()).join(" ; "), start: Math.max(0, g[0].t - 0.2), end: Math.max(g[g.length - 1].t + 2, g[0].t + 2.5 + g.length * 1.2) });
    a = b + 1;
  }
  return out.sort((x, y) => x.start - y.start);
}
