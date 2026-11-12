/** Textes de publication (titres, description, hashtags, accroche) à partir de la transcription.
 *  Gemini Nano sur l'appareil quand il est disponible (consigne + lecture de la réponse ici), sinon version locale simple. */

export interface Draft { titles: string[]; description: string; hashtags: string[]; hook: string; by: "ia" | "local" }

const STOP = new Set(("a ai alors au aussi aux avec avoir bah bien bon c ca car ce cela celle celui ces cet cette ceux chez comme comment d dans de des deja "
  + "du donc elle elles en encore est et etait ete etre eu euh fait faire faut hein il ils j je juste l la le les leur lui m ma mais me meme mes moi mon "
  + "n ne ni non nos notre nous on ou oui par pas peu peut plus pour pourquoi qu quand que quel quelle qui quoi s sa sans se ses si son sont sur t ta te "
  + "tes toi ton tous tout tres tu un une va vais vas voila vont vos votre vous vraiment y aujourd hui ici la-bas donc enfin bref genre truc chose choses "
  + "parce rien dire dit fais voir vu ok okay salut bonjour merci tout abonnez abonne video videos parle parler parlons parlez montre montrer "
  + "regarde regarder regardez pense penser trouve trouver veux veut voulez allez aller nouveau nouvelle nouveaux grand grande petit petite "
  + "beaucoup toujours jamais maintenant vraie vrai gros autre autres premier premiere dernier derniere chaque quelque quelques peux pouvez sais savoir").split(/\s+/));
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Consigne pour le modèle (court : Gemini Nano a une petite fenêtre). */
export function buildPrompt(transcript: string): string {
  const t = transcript.replace(/\s+/g, " ").trim().slice(0, 2400);
  return `Tu es un expert des vidéos courtes (TikTok, Reels, Shorts). Voici la transcription d'une vidéo en français :
"""${t}"""
Écris en français, sans inventer de faits absents de la transcription. Réponds EXACTEMENT avec ces 6 lignes, rien d'autre :
TITRE1: (titre accrocheur, 60 caractères max)
TITRE2: (autre angle)
TITRE3: (question qui intrigue)
DESCRIPTION: (2 phrases qui donnent envie de regarder)
HASHTAGS: (6 hashtags pertinents séparés par des espaces)
ACCROCHE: (la phrase de la transcription la plus forte pour commencer la vidéo, recopiée telle quelle)`;
}

/** Lit la réponse du modèle ; null si elle est inutilisable. */
export function parseDraft(out: string): Draft | null {
  const get = (k: string) => (out.match(new RegExp(`^\\s*\\**${k}\\**\\s*[:：]\\s*(.+)$`, "mi"))?.[1] ?? "").replace(/^[*"«\s]+|[*"»\s]+$/g, "").trim();
  const titles = [get("TITRE1"), get("TITRE2"), get("TITRE3")].filter(Boolean).map((t) => t.slice(0, 100));
  const hashtags = [...new Set((get("HASHTAGS").match(/#?[\p{L}\p{N}_]+/gu) ?? []).map((h) => "#" + h.replace(/^#/, "")))].slice(0, 10);
  const description = get("DESCRIPTION"), hook = get("ACCROCHE");
  if (!titles.length && !description) return null;
  return { titles, description, hashtags, hook, by: "ia" };
}

/** Phrases (découpées sur la ponctuation de Whisper). */
export function sentences(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter((s) => s.split(" ").length >= 3);
}

/** Version locale : mots-clés les plus fréquents → hashtags et titre ; accroche = phrase la plus « forte » du début. */
export function localDraft(transcript: string): Draft {
  const words = transcript.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, "")).filter(Boolean);
  const freq = new Map<string, { n: number; w: string }>();
  for (const w of words) {
    const parts = fold(w).split(/['’]/); const k = parts[parts.length - 1]; if (k.length < 4 || STOP.has(k) || /^\d+$/.test(k)) continue;
    const e = freq.get(k) ?? { n: 0, w: w.split(/['’]/).pop()! }; e.n++; if (/^\p{Lu}/u.test(w)) e.w = w.split(/['’]/).pop()!; freq.set(k, e);
  }
  const top = [...freq.values()].sort((a, b) => b.n - a.n || b.w.length - a.w.length).slice(0, 6);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const hashtags = top.map((t) => "#" + fold(t.w).replace(/[^a-z0-9]/g, "")).filter((h) => h.length > 2);
  const ss = sentences(transcript);
  // accroche : parmi les 5 premières phrases, celle avec question / chiffre / mot fort, courte de préférence
  const strong = /\?|!|\d|jamais|toujours|secret|erreur|pourquoi|comment|incroyable|meilleur|pire|personne|vrai|faux/i;
  const hook = [...ss.slice(0, 5)].sort((a, b) => (strong.test(b) ? 1 : 0) - (strong.test(a) ? 1 : 0) || a.length - b.length)[0] ?? ss[0] ?? "";
  const k = top.map((t) => cap(t.w));
  const titles = k.length ? [k.slice(0, 3).join(", "), `${k[0]} : ce qu'il faut savoir`, `Et si on parlait de ${/^\p{Lu}/u.test(top[0].w) ? top[0].w : top[0].w.toLowerCase()} ?`] : []; // nom propre : majuscule gardée
  const description = ss.slice(0, 2).join(" ").slice(0, 220);
  return { titles, description, hashtags, hook, by: "local" };
}

/** Question posée à l'IA du téléphone : ce début de phrase a-t-il été abandonné puis repris autrement ? (réponse OUI / NON) */
export function judgePrompt(before: string, fragment: string, after: string): string {
  return `Transcription orale en français : "${before} [${fragment}] ${after}"
Le passage entre crochets est-il un début de phrase abandonné, que la personne recommence autrement juste après ? Réponds par un seul mot : OUI ou NON.`;
}
export const parseYes = (out: string) => /^\W*oui\b/i.test(out.trim());
