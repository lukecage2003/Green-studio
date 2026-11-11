/** Coach de tournage : contrôle de l'installation avant de filmer, et bilan d'une prise après transcription.
 *  Fonctions pures (testées) ; l'interface les affiche. */
import type { Word, Range } from "./timeline.ts";
import type { Suggestion } from "./speech-analysis.ts";

export interface CheckInput {
  subj: number | null;            // luminosité du visage (0–1)
  bg: number | null;              // luminosité du fond réel (0–1)
  head: { x: number; y: number; s: number } | null; // tête : centre x, haut y, largeur (fractions de l'image)
  floorDb: number | null;         // bruit de fond du micro, dBFS (hors parole)
}
export interface CheckItem { id: string; ok: boolean; label: string; tip?: string }

export function studioCheck(m: CheckInput): CheckItem[] {
  const out: CheckItem[] = [];
  // Lumière
  if (m.subj != null) {
    const r = m.bg != null ? m.bg / Math.max(0.02, m.subj) : 1;
    if (r > 1.6) out.push({ id: "backlight", ok: false, label: "Contre-jour", tip: "La lumière vient de derrière vous : tournez-vous vers la fenêtre ou la lampe." });
    else if (m.subj < 0.22) out.push({ id: "dark", ok: false, label: "Visage sombre", tip: "Ajoutez de la lumière face à vous (fenêtre, lampe derrière le téléphone)." });
    else if (m.subj > 0.85) out.push({ id: "bright", ok: false, label: "Visage trop éclairé", tip: "Éloignez la lampe ou adoucissez la lumière (rideau, mur blanc)." });
    else out.push({ id: "light", ok: true, label: "Lumière" });
  }
  // Son
  if (m.floorDb != null) {
    if (m.floorDb > -40) out.push({ id: "noise", ok: false, label: "Bruit de fond fort", tip: "Fermez la fenêtre, coupez ventilateur ou télé, ou rapprochez le micro. La voix studio en retirera une partie au montage." });
    else if (m.floorDb > -50) out.push({ id: "noise", ok: true, label: "Bruit de fond léger", tip: "La voix studio le retirera au montage." });
    else out.push({ id: "noise", ok: true, label: "Calme" });
  }
  // Cadrage
  const h = m.head;
  if (!h) out.push({ id: "nobody", ok: false, label: "Personne dans le cadre", tip: "Placez-vous face à l'objectif, épaules visibles." });
  else {
    const issues: CheckItem[] = [];
    if (h.y < 0.03) issues.push({ id: "top", ok: false, label: "Tête coupée en haut", tip: "Reculez un peu ou inclinez le téléphone vers le haut." });
    else if (h.y > 0.33) issues.push({ id: "headroom", ok: false, label: "Trop d'espace au-dessus de la tête", tip: "Montez le téléphone à hauteur des yeux." });
    if (Math.abs(h.x - 0.5) > 0.18) issues.push({ id: "center", ok: false, label: "Pas centré", tip: h.x < 0.5 ? "Décalez-vous vers la droite de l'écran." : "Décalez-vous vers la gauche de l'écran." });
    if (h.s < 0.13) issues.push({ id: "far", ok: false, label: "Trop loin", tip: "Rapprochez-vous : le visage doit occuper environ un tiers de la largeur." });
    else if (h.s > 0.55) issues.push({ id: "near", ok: false, label: "Trop près", tip: "Reculez un peu, les déformations de l'objectif grossissent le visage." });
    out.push(...(issues.length ? issues : [{ id: "frame", ok: true, label: "Cadrage" }]));
  }
  return out;
}

/** Bruit de fond : niveau typique hors parole (20e centile des RMS), en dBFS. */
export function noiseFloorDb(rms: number[]): number | null {
  const v = rms.filter((x) => x > 0).sort((a, b) => a - b); if (v.length < 10) return null;
  return 20 * Math.log10(v[Math.floor(v.length * 0.2)]);
}

export interface TakeReport { wpm: number; tics: number; ticsPerMin: number; silences: number; retakes: number; removed: number; score: number; tips: string[] }

/** Bilan d'une prise : débit, tics de langage, silences, reprises ; note sur 100 et conseils. */
export function takeReport(words: Word[], sugs: Suggestion[], duration: number, cuts: Range[]): TakeReport {
  const isCut = (w: Word) => { const m = (w.start + w.end) / 2; return cuts.some((c) => m >= c.start && m < c.end); };
  const kept = words.filter((w) => !isCut(w) && w.text.trim());
  const removed = cuts.reduce((s, c) => s + Math.max(0, Math.min(duration, c.end) - Math.max(0, c.start)), 0);
  // débit sur le temps de parole réel (pauses de plus de 0,7 s exclues)
  let talk = 0; for (let i = 0; i < kept.length; i++) { talk += kept[i].end - kept[i].start; if (i + 1 < kept.length) talk += Math.min(0.7, Math.max(0, kept[i + 1].start - kept[i].end)); }
  const wpm = talk > 3 ? Math.round(kept.length / (talk / 60)) : 0;
  const by = (t: string[]) => sugs.filter((s) => t.includes(s.type)).length;
  const tics = by(["hesitation", "repetition", "stutter", "untranscribed", "false_start"]), silences = by(["long_silence"]), retakes = by(["retake"]);
  const mins = Math.max(0.25, duration / 60), ticsPerMin = Math.round((tics / mins) * 10) / 10;
  let score = 100 - Math.min(45, ticsPerMin * 6) - Math.min(15, (silences / mins) * 3);
  if (wpm) score -= wpm > 190 ? Math.min(20, (wpm - 190) / 2) : wpm < 120 ? Math.min(20, (120 - wpm) / 2) : 0;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const tips: string[] = [];
  if (wpm > 190) tips.push(`Débit rapide (${wpm} mots/min) : ralentissez un peu et marquez les pauses, les sous-titres seront plus lisibles.`);
  else if (wpm && wpm < 120) tips.push(`Débit posé (${wpm} mots/min) : pour les vidéos courtes, visez 140 à 170 mots/min.`);
  if (ticsPerMin >= 4) tips.push(`${tics} tic(s) de langage (${ticsPerMin}/min) : faites une courte pause au lieu de « euh ». Le montage les retire, mais la voix sera plus fluide.`);
  if (silences >= 3) tips.push(`${silences} longs silences : le prompteur peut vous aider à enchaîner.`);
  if (retakes) tips.push(`${retakes} reprise(s) « je reprends » retirée(s) automatiquement.`);
  if (!tips.length) tips.push("Prise très propre, rien à signaler !");
  return { wpm, tics, ticsPerMin, silences, retakes, removed, score, tips };
}
