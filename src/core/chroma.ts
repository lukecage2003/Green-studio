/** Vrai fond vert (ou bleu) : détection et couleur de référence pour l'incrustation (même principe que le filtre Chroma Key d'OBS Studio). */

/** Chrominance (U, V) d'une couleur RGB 0–1, centrée sur 0,5 (formule du filtre OBS). */
export function rgbToUV(r: number, g: number, b: number): [number, number] {
  return [r * -0.169 + g * -0.331 + b * 0.5 + 0.5, r * 0.5 + g * -0.419 + b * -0.081 + 0.5];
}

export interface BgSample { r: number; g: number; b: number; sd: number }

/** Le vrai fond est-il un fond vert ou bleu uni ? (couleur dominante nette, peu de variations) */
export function keyKind(s: BgSample | null): "green" | "blue" | null {
  if (!s || s.sd > 0.13) return null;
  const { r, g, b } = s, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 0.25 || mx - mn < 0.12) return null; // un vrai fond vert/bleu est éclairé et très coloré (pas une pièce sombre teintée)
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

/**
 * Plancher du masque : dans une pièce sombre, l'IA donne souvent au fond une confiance de 0,2 à 0,5 au lieu de 0, ce qui
 * laisse un voile sombre semi-transparent autour de la personne. On mesure ce plancher (médiane des valeurs « fond »)
 * pour relever le seuil de détourage d'autant. Renvoie 0 si le fond est propre.
 */
export function maskFloor(m: Uint8Array, step = 11): number {
  const v: number[] = []; let n = 0;
  for (let i = 0; i < m.length; i += step) { n++; if (m[i] < 170) v.push(m[i]); }
  if (v.length < n * 0.15) return 0; // presque tout est « personne » : pas de mesure fiable
  v.sort((a, b) => a - b); return v[Math.floor(v.length / 2)] / 255;
}
/** Seuils de détourage (bas, haut) relevés au-dessus du plancher mesuré. */
export function edgeFor(lo: number, hi: number, floor: number): [number, number] {
  const l = Math.max(lo, Math.min(0.75, floor + 0.15)), h = Math.min(0.95, Math.max(hi, l + 0.22));
  return [l, h];
}
