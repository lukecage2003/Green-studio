/** TimelineEngine : montage non destructif (liste de coupes sur l'original). Fonctions pures, sans DOM. */
export interface Range { start: number; end: number }
/** pre : début donné par Whisper quand il avait étiré le mot sur une hésitation ; start est alors le vrai début, recalé sur le son. */
export interface Word { text: string; start: number; end: number; conf?: number; pre?: number }

export const EPS = 1e-6;

/** Trie, borne à [0,duration] et fusionne les plages qui se chevauchent ou se touchent. */
export function normalize(ranges: Range[], duration = Infinity): Range[] {
  const r = ranges
    .map((x) => ({ start: Math.max(0, Math.min(x.start, x.end)), end: Math.min(duration, Math.max(x.start, x.end)) }))
    .filter((x) => x.end - x.start > EPS)
    .sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const x of r) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end + EPS) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

/** Segments conservés = complément des coupes. */
export function kept(duration: number, cuts: Range[]): Range[] {
  const out: Range[] = []; let t = 0;
  for (const c of normalize(cuts, duration)) { if (c.start - t > EPS) out.push({ start: t, end: c.start }); t = c.end; }
  if (duration - t > EPS) out.push({ start: t, end: duration });
  return out;
}

export const editedDuration = (duration: number, cuts: Range[]) =>
  kept(duration, cuts).reduce((s, k) => s + (k.end - k.start), 0);

/** Temps source -> temps du montage (un temps coupé est ramené au raccord). */
export function sourceToEdited(t: number, duration: number, cuts: Range[]): number {
  let acc = 0;
  for (const k of kept(duration, cuts)) {
    if (t < k.start) return acc;
    if (t <= k.end) return acc + (t - k.start);
    acc += k.end - k.start;
  }
  return acc;
}

/** Temps du montage -> temps source. */
export function editedToSource(e: number, duration: number, cuts: Range[]): number {
  let acc = 0; const ks = kept(duration, cuts);
  for (const k of ks) {
    const len = k.end - k.start;
    if (e <= acc + len + EPS) return k.start + Math.max(0, e - acc);
    acc += len;
  }
  return ks.length ? ks[ks.length - 1].end : 0;
}

/** Plage vidéo pour des mots sélectionnés, avec marges (s) pour ne pas couper un mot, sans empiéter sur les mots voisins. */
export function wordsToRange(words: Word[], first: number, last: number, marginBefore = 0.03, marginAfter = 0.03): Range {
  const a = words[first], b = words[last];
  if (!a || !b || last < first) throw new RangeError("sélection de mots invalide");
  const prevEnd = first > 0 ? words[first - 1].end : 0;
  const nextStart = last < words.length - 1 ? words[last + 1].start : Infinity;
  return {
    start: Math.max(prevEnd, a.start - marginBefore),
    end: Math.min(nextStart, b.end + marginAfter),
  };
}

/** Raccords : positions (temps montage) où appliquer un court fondu audio. */
export function joints(duration: number, cuts: Range[]): number[] {
  const out: number[] = []; let acc = 0; const ks = kept(duration, cuts);
  for (let i = 0; i < ks.length - 1; i++) { acc += ks[i].end - ks[i].start; out.push(acc); }
  return out;
}

export interface EditSnapshot { cuts: Range[] }

/** État d'édition avec historique annuler/rétablir. L'original n'est jamais modifié. */
export class EditSession {
  private undoS: Range[][] = []; private redoS: Range[][] = [];
  cuts: Range[] = [];
  readonly duration: number;
  constructor(duration: number, initial: Range[] = []) { this.duration = duration; this.cuts = normalize(initial, duration); }
  private commit(next: Range[]) { this.undoS.push(this.cuts); this.redoS = []; this.cuts = normalize(next, this.duration); }
  addCut(r: Range) { this.commit([...this.cuts, r]); }
  addCuts(rs: Range[]) { this.commit([...this.cuts, ...rs]); }
  /** Restaure la partie supprimée recouverte par r (restauration totale ou partielle). */
  restore(r: Range) {
    const next: Range[] = [];
    for (const c of this.cuts) {
      if (c.end <= r.start + EPS || c.start >= r.end - EPS) { next.push(c); continue; }
      if (c.start < r.start) next.push({ start: c.start, end: r.start });
      if (c.end > r.end) next.push({ start: r.end, end: c.end });
    }
    this.commit(next);
  }
  /** Remplace toutes les coupes (rognage au doigt sur la timeline) : une seule étape d'annulation. */
  replace(next: Range[]) { this.commit(next); }
  /** Ajuste les bornes d'une coupe existante (index dans this.cuts). */
  adjust(index: number, start: number, end: number) {
    const next = this.cuts.map((c, i) => (i === index ? { start, end } : c)); this.commit(next);
  }
  get canUndo() { return this.undoS.length > 0; }
  get canRedo() { return this.redoS.length > 0; }
  undo() { const p = this.undoS.pop(); if (!p) return false; this.redoS.push(this.cuts); this.cuts = p; return true; }
  redo() { const n = this.redoS.pop(); if (!n) return false; this.undoS.push(this.cuts); this.cuts = n; return true; }
  get kept() { return kept(this.duration, this.cuts); }
  get editedDuration() { return editedDuration(this.duration, this.cuts); }
  snapshot(): EditSnapshot { return { cuts: this.cuts.map((c) => ({ ...c })) }; }
}
