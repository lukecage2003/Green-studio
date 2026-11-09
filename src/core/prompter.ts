/** Prompteur qui suit la voix : détection de parole (hors ligne) et alignement des mots reconnus sur le script. Pur, sans DOM. */

export const normWord = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** Découpe le script en mots (pour l'affichage mot à mot et l'alignement), en gardant les séparateurs (retours à la ligne). */
export function tokenize(script: string): { parts: string[]; wordIdx: number[]; norm: string[] } {
  const parts = script.split(/(\s+)/).filter((p) => p !== ""), wordIdx: number[] = [], norm: string[] = [];
  parts.forEach((p, i) => { if (!/^\s+$/.test(p)) { const n = normWord(p); if (n) { wordIdx.push(i); norm.push(n); } } });
  return { parts, wordIdx, norm };
}

const same = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 4)) && b.startsWith(a.slice(0, 4))));

/**
 * Position (index du prochain mot à lire) après les mots entendus `heard`, en cherchant autour de `from`
 * (un peu en arrière : on relit ; beaucoup en avant : on saute). Renvoie null si l'alignement n'est pas fiable.
 */
export function align(script: string[], heard: string[], from: number, ahead = 60, back = 8): number | null {
  const h = heard.filter(Boolean).slice(-8); if (!h.length) return null;
  let best = -1, bestScore = 0;
  for (let j = Math.max(0, from - back); j < Math.min(script.length, from + ahead); j++) {
    // correspondance en remontant depuis j (script) et la fin de h (entendu), une erreur tolérée
    let i = h.length - 1, k = j, score = 0, miss = 0;
    while (i >= 0 && k >= 0) {
      if (same(script[k], h[i])) { score++; i--; k--; }
      else if (miss++ < 1) { if (i > 0 && same(script[k], h[i - 1])) i--; else k--; }
      else break;
    }
    if (!same(script[j], h[h.length - 1])) score -= 0.5; // le dernier mot entendu doit tomber sur j
    const s = score - Math.abs(j - from) * 0.01; // à score égal, le plus proche
    if (s > bestScore) { bestScore = s; best = j; }
  }
  const need = Math.min(2, h.length);
  return best >= 0 && bestScore >= need - 0.05 ? best + 1 : null;
}

/** Détection de parole à seuil adaptatif (le bruit de fond est suivi en continu), avec maintien de 350 ms. */
export class VoiceDetector {
  floor = 0.002; speaking = false; private lastVoice = -1e9;
  update(rms: number, tMs: number): boolean {
    if (rms < this.floor) this.floor += (rms - this.floor) * 0.2; else this.floor *= 1.002; // descend vite, remonte lentement
    this.floor = Math.max(this.floor, 1e-4);
    if (rms > Math.max(this.floor * 3.5, 0.008)) this.lastVoice = tMs;
    this.speaking = tMs - this.lastVoice < 350;
    return this.speaking;
  }
}
