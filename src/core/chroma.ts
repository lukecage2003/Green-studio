/** Vrai fond vert (ou bleu) : détection et couleur de référence pour l'incrustation (même principe que le filtre Chroma Key d'OBS Studio). */

/** Chrominance (U, V) d'une couleur RGB 0–1, centrée sur 0,5 (formule du filtre OBS). */
export function rgbToUV(r: number, g: number, b: number): [number, number] {
  return [r * -0.169 + g * -0.331 + b * 0.5 + 0.5, r * 0.5 + g * -0.419 + b * -0.081 + 0.5];
}

export interface BgSample { r: number; g: number; b: number; sd: number }

/** Le vrai fond est-il un fond vert ou bleu uni ? (couleur dominante nette, peu de variations) */
export function keyKind(s: BgSample | null): "green" | "blue" | null {
  if (!s || s.sd > 0.13) return null;
  const { r, g, b } = s;
  if (g > 0.12 && g > r * 1.3 && g > b * 1.15) return "green";
  if (b > 0.12 && b > r * 1.3 && b > g * 1.1) return "blue";
  return null;
}

/** Suivi de la couleur du fond : moyenne glissante, et décision « fond vert présent » stable (pas de clignotement). */
export class KeyTracker {
  u = 0.5; v = 0.5; hits = 0; misses = 0; on = false; kind: "green" | "blue" | null = null;
  ru = 0.5; rv = 0.5; raw = 0; // couleur du fond mesurée, même si elle n'est pas « fond vert » (mode Toujours)
  push(s: BgSample | null) {
    if (s) { const [u, v] = rgbToUV(s.r, s.g, s.b); if (!this.raw++) { this.ru = u; this.rv = v; } else { this.ru += (u - this.ru) * 0.2; this.rv += (v - this.rv) * 0.2; } }
    const k = keyKind(s);
    if (k && s) {
      const [u, v] = rgbToUV(s.r, s.g, s.b);
      if (this.hits === 0) { this.u = u; this.v = v; } else { this.u += (u - this.u) * 0.2; this.v += (v - this.v) * 0.2; }
      this.hits++; this.misses = 0; this.kind = k;
      if (this.hits >= 4) this.on = true;               // ≈ 4 mesures concordantes (~1 s)
    } else { this.misses++; if (this.misses >= 8) { this.on = false; this.hits = 0; } } // ≈ 2 s sans fond uni
    return this.on;
  }
}
