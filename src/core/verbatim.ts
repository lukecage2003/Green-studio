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

export function verbatimPrompt(asr: any, language = "fr", prompt = VERBATIM_PROMPT) {
  const tok = asr.tokenizer, model = asr.model;
  const id = (t: string) => { const v = tok.model.tokens_to_ids.get(t); if (v == null) throw new Error("jeton inconnu " + t); return v; };
  const ptoks: number[] = tok.encode(prompt, { add_special_tokens: false });
  const head = [id("<|startofprev|>"), ...ptoks], P = head.length;
  const init = [...head, id("<|startoftranscript|>"), id(`<|${language}|>`), id("<|transcribe|>"), id("<|notimestamps|>")];
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
    promptWords: prompt.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean),
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
  const echo = n.length > 0 && n.every((w) => promptWords.includes(w)) && n.length >= 2;
  return echo || words[words.length - 1].end < lastVoice - 1.5;
}
