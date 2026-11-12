/**
 * Transcription « mot pour mot » : Whisper est amorcé avec un court texte plein d'hésitations (<|startofprev|> … ), ce qui
 * l'incite à écrire les « euh », répétitions et faux départs au lieu de les effacer (testé sur de vraies prises).
 *
 * transformers.js ne gère pas l'amorce pour l'horodatage par mot : l'alignement (DTW sur l'attention croisée) inclurait
 * les jetons de l'amorce comme s'ils avaient été prononcés. On retire donc l'amorce des séquences et de l'attention
 * avant l'alignement. Garde-fous : si le résultat ressemble à un décrochage (écho de l'amorce, transcription qui s'arrête
 * bien avant la fin de la parole), l'appelant refait le passage sans amorce.
 */
export const VERBATIM_PROMPT = " Euh, bon, du coup, euh… voilà, voilà.";

/** La fin de la suite est-elle une boucle ? (motif de 1 à 4 éléments répété au moins `reps` fois) */
export function tailLoop<T>(ids: T[], reps = 5): boolean {
  for (let k = 1; k <= 4; k++) {
    const n = k * reps; if (ids.length < n) continue; let ok = true;
    for (let i = ids.length - n + k; i < ids.length && ok; i++) ok = ids[i] === ids[i - k];
    if (ok) return true;
  }
  return false;
}
/**
 * Arrêt du décodage dès qu'une boucle démarre (« voilà, voilà, voilà… » jusqu'à la longueur maximale, ~30 s perdues).
 * transformers.js 3.8 ne transmet pas `stopping_criteria` pour Whisper : le critère est ajouté à la source, une fois par modèle.
 */
export function guardLoops(asr: any, T: { StoppingCriteria: any }) {
  const model = asr.model; if (model.__gsLoopGuard) return; model.__gsLoopGuard = true;
  class LoopStop extends T.StoppingCriteria { _call(input_ids: any[][]) { return input_ids.map((ids) => tailLoop(ids.slice(-24).map(Number), 6)); } }
  const orig = model._get_stopping_criteria.bind(model);
  model._get_stopping_criteria = (gc: any, sc: any) => { const c = orig(gc, sc); c.push(new LoopStop()); return c; };
}

export function verbatimPrompt(asr: any, language = "fr", prompt = VERBATIM_PROMPT) {
  const tok = asr.tokenizer, model = asr.model;
  const id = (t: string) => { const v = tok.model.tokens_to_ids.get(t); if (v == null) throw new Error("jeton inconnu " + t); return v; };
  const sop = id("<|startofprev|>"), tailIds = [id("<|startoftranscript|>"), id(`<|${language}|>`), id("<|transcribe|>"), id("<|notimestamps|>")];
  let P = 0, init: number[] = [], promptWords: string[] = [];
  /** Amorce = vocabulaire personnel (noms propres bien écrits) + hésitations. */
  const setVocab = (vocab: string[] = []) => {
    const text = (vocab.length ? " " + vocab.join(", ") + "." : "") + prompt;
    const head = [sop, ...(tok.encode(text, { add_special_tokens: false }) as number[])]; P = head.length; init = [...head, ...tailIds];
    promptWords = text.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  };
  setVocab();
  const orig = model._extract_token_timestamps.bind(model);
  let active = false;
  model._extract_token_timestamps = (out: any, heads: any, nf: any, tp: any) => {
    if (active) {
      const L = out.sequences.dims[1];
      out.sequences = out.sequences.slice(null, [P, L]);
      out.cross_attentions = out.cross_attentions.map((step: any[], i: number) => (i === 0 ? step.map((t: any) => t.slice(null, null, [P, t.dims[2]], null)) : step));
    }
    return orig(out, heads, nf, tp);
  };
  return {
    setVocab,
    get promptWords() { return promptWords; },
    async run(audio: Float32Array, opts: any) {
      active = true;
      try { return await asr(audio, { ...opts, decoder_input_ids: init }); } finally { active = false; }
    },
  };
}

/** Le passage amorcé a-t-il décroché ? (écho de l'amorce, ou texte qui s'arrête bien avant la fin de la parole) */
export function verbatimFailed(words: { text: string; start: number; end: number }[], promptWords: string[], lastVoice: number): boolean {
  if (!words.length) return lastVoice > 0.8;
  const n = words.map((w) => w.text.toLowerCase().replace(/[^\p{L}]/gu, "")).filter(Boolean);
  for (let i = 5; i <= n.length; i++) if (tailLoop(n.slice(0, i), 5)) return true; // boucle n'importe où dans le passage
  const echo = n.length > 0 && n.every((w) => promptWords.includes(w)) && n.length >= 2;
  return echo || words[words.length - 1].end < lastVoice - 1.5;
}
