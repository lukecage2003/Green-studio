/** Quick Edit : montage par le texte. Lecteur qui saute les coupes, forme d'onde + timeline, transcription cliquable,
 *  suggestions (répétitions, hésitations, silences…), annuler/rétablir, export. Tout reste sur l'appareil. */
import { EditSession, wordsToRange, sourceToEdited, EPS, type Range, type Word } from "../core/timeline.ts";
import { bestTakes, type TakeResult } from "../core/takes.ts";
import { clipsOf, snapSplit, hitAt, trimEdge, wavePeaks } from "../core/derush.ts";
import { compose, drawTitle, activeAt, type Overlay, type OverlayMode, type Title } from "../core/overlay.ts";

/** Fichiers insérés (images, extraits) : gardés sur le téléphone (IndexedDB), retrouvés à la réouverture du projet. */
const mediaDb = () => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open("gs-media", 1); r.onupgradeneeded = () => r.result.createObjectStore("files"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function mediaPut(id: string, b: Blob) { const db = await mediaDb(); await new Promise((res, rej) => { const t = db.transaction("files", "readwrite"); t.objectStore("files").put(b, id); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function mediaGet(id: string): Promise<Blob | null> { const db = await mediaDb(); return new Promise((res) => { const q = db.transaction("files").objectStore("files").get(id); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); }); }
import { takeReport } from "../core/coach.ts";
import { TICS, RHYTHM, type Rhythm, type SnapMode, snapToQuiet, withBounds, tightenWords, dropCrumbs, cleanTranscript, analyze, analyzeAudio, type Suggestion, type IssueType } from "../core/speech-analysis.ts";
import { peaks as computePeaks, loudnessGain, speechBounds } from "../core/audio.ts";
import { buildCaptions, drawCaption, lineAt, CAPTION_DEFAULT, PRESETS, type CapLine, type CaptionStyle, type CaptionPreset } from "../core/captions.ts";
import { probe, extractAudio, exportEdited, webCodecsAvailable, extractClip } from "../core/media.ts";
import { StudioVoice, loadDenoiser } from "../core/voice.ts";
import { exportRealtime } from "../core/export.ts";

const LABEL: Record<IssueType, string> = { retake: "Reprise (« je reprends »)", filler_word: "Tic de langage", repetition: "Répétition", stutter: "Bégaiement", false_start: "Faux départ", hesitation: "Hésitation", long_silence: "Silence long", untranscribed: "Bégaiement / son non transcrit" };
const SAFE = 0.7;
const fmt = (t: number) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, "0")}`; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const CSS = `
.qe{position:fixed;inset:0;z-index:60;background:#000;color:var(--fg);display:flex;flex-direction:column;padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0);font-family:var(--font)}
.qe header{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;height:50px;padding:0 16px}
.qe header h2{margin:0;font-size:17px;font-weight:650}
.qe header [data-a=close]{justify-self:start;color:var(--accent);font-size:17px}
.qe header [data-a=export]{justify-self:end;color:var(--accent);font-size:17px;font-weight:650}
.qe .ib{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 14px;border-radius:17px;background:var(--fill);font-size:14px;font-weight:600;white-space:nowrap;transition:transform .12s}
.qe .ib:active{transform:scale(.95)}
.qe .ib:disabled{opacity:.3}
.qe .go{background:var(--accent);color:#000}
.qe .round{width:44px;height:44px;padding:0;border-radius:50%;font-size:17px}
.qe .icon{width:40px;padding:0;background:none;font-size:20px}
.qe .vw{position:relative;background:#000;height:36vh;margin:0 16px;border-radius:16px;overflow:hidden}
.qe video{position:absolute;inset:0;width:100%;height:100%;background:#000;object-fit:contain}.qe video.spare{visibility:hidden}
.qe .vw canvas.cc{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border-radius:0;background:none}
.qe .tl{padding:12px 16px 0}
.qe canvas.wave{width:100%;height:96px;display:block;border-radius:14px;background:#141416;touch-action:none}
.qe .dr{display:flex;align-items:center;gap:6px;padding:8px 0 0;overflow-x:auto;scrollbar-width:none}.qe .dr::-webkit-scrollbar{display:none}
.qe .dr .ib{flex:0 0 auto}.qe .dr .sp{flex:1}.qe .dr [data-a=del]:not(:disabled){color:#ff6961}
.qe .transport{display:flex;align-items:center;gap:10px;padding:10px 16px 0}
.qe .transport [data-r=time]{font-variant-numeric:tabular-nums;font-size:15px;font-weight:600}
.qe .sp{flex:1}
.qe .tools{display:flex;gap:8px;overflow-x:auto;padding:10px 16px 2px;scrollbar-width:none}.qe .tools::-webkit-scrollbar{display:none}
.qe .tools label{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 6px 0 14px;border-radius:17px;background:var(--fill);font-size:14px;font-weight:600;white-space:nowrap}
.qe input[type=checkbox]{-webkit-appearance:none;appearance:none;position:relative;width:42px;height:26px;border-radius:13px;background:rgba(120,120,128,.32);margin:0;transition:background .2s;flex:none}
.qe input[type=checkbox]::after{content:"";position:absolute;top:2px;left:2px;width:22px;height:22px;border-radius:50%;background:#fff;transition:left .2s}
.qe input[type=checkbox]:checked{background:var(--accent)}.qe input[type=checkbox]:checked::after{left:18px}
.qe .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px 16px 0;font-size:13px;color:var(--muted)}
.qe .tabs{display:flex;gap:2px;margin:12px 16px 0;padding:2px;border-radius:10px;background:var(--fill)}
.qe .tabs button{flex:1;height:32px;border-radius:8px;font-size:14px;font-weight:600;color:var(--fg)}
.qe .tabs button[aria-selected=true]{background:#636366;box-shadow:0 3px 8px rgba(0,0,0,.12)}
.qe .body{flex:1;overflow:auto;padding:14px 16px 100px;-webkit-overflow-scrolling:touch}
.qe .tx{font-size:18px;line-height:1.7;letter-spacing:-.01em}
.qe .tx span{border-radius:5px;padding:1px 2px;cursor:pointer;transition:background .15s}
.qe .tx span.cut{text-decoration:line-through;color:rgba(235,235,245,.3);background:rgba(255,69,58,.14)}
.qe .tx span.sug{box-shadow:inset 0 -2px 0 #ffd60a}
.qe .tx span.sel{background:var(--accent);color:#000}
.qe .tx span.cur{box-shadow:0 0 0 1.5px var(--accent)}
.qe .card{background:#1c1c1e;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px}
.qe .card b{font-size:17px;font-weight:650}
.qe .card p{margin:0;color:var(--muted);font-size:14px;line-height:1.4}
.qe .bar{height:4px;border-radius:2px;background:var(--fill);overflow:hidden}.qe .bar i{display:block;height:100%;background:var(--accent);width:0;transition:width .2s}
.qe .sg{display:flex;gap:10px;align-items:center;padding:10px 14px;background:#1c1c1e}
.qe .sg:first-of-type{border-radius:14px 14px 0 0}.qe .sg:last-of-type{border-radius:0 0 14px 14px}.qe .sg+.sg{border-top:.5px solid var(--line)}
.qe .sg .t{flex:1;min-width:0}.qe .sg .t b{font-size:12px;color:#ffd60a;font-weight:600}.qe .sg .t div{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;margin-top:2px}
.qe .sg.on .t b{color:var(--red)}.qe .sg.ign{opacity:.4}
.qe .selbar{position:absolute;left:12px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom,0px));background:rgba(44,44,46,.92);backdrop-filter:blur(30px) saturate(1.6);border-radius:18px;padding:8px;display:flex;gap:6px;align-items:center;box-shadow:0 12px 40px rgba(0,0,0,.5);animation:qeUp .25s cubic-bezier(.2,.9,.3,1)}
@keyframes qeUp{from{transform:translateY(20px);opacity:0}}
.qe .selbar span{flex:1;font-size:13px;color:var(--muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding-left:6px}
.qe .modal{position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;padding:12px 12px calc(12px + env(safe-area-inset-bottom,0px))}
.qe .modal .card{width:100%;max-width:440px;background:rgba(44,44,46,.96);border-radius:22px;animation:qeUp .3s cubic-bezier(.2,.9,.3,1)}
.qe .modal .row{padding:4px 0 0}.qe .modal .ib{height:46px;border-radius:12px;font-size:16px;flex:1}
.qe a.ib{text-decoration:none;text-align:center}
.qe select{-webkit-appearance:none;appearance:none;background:var(--fill);color:var(--fg);border:0;border-radius:10px;padding:8px 12px;font:inherit;font-size:15px}
.qe .opt{display:flex;align-items:center;gap:12px;font-size:15px}.qe .opt input[type=range]{flex:1;accent-color:var(--accent)}
.qe .chips{display:flex;gap:6px;flex-wrap:wrap}.qe .chips button[aria-pressed=true]{background:var(--accent);color:#000}

/* verre sombre (esprit iOS actuel) */
.qe header,.lib header{margin:6px 8px 8px;border-radius:22px;background:rgba(255,255,255,.08);-webkit-backdrop-filter:blur(26px) saturate(185%);backdrop-filter:blur(26px) saturate(185%);border:.5px solid rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.28)}
.qe .ib,.lib .ib{background:rgba(255,255,255,.1);border:.5px solid rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.22);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px)}
.qe .go,.lib .go{background:var(--accent);border-color:rgba(255,255,255,.3)}
.qe .tools label{background:rgba(255,255,255,.1);border:.5px solid rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.22)}
.qe .tabs{background:rgba(255,255,255,.08);border:.5px solid rgba(255,255,255,.12);border-radius:16px;padding:3px}
.qe .tabs button{border-radius:13px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 4px}.qe .tabs button[aria-selected=true]{background:rgba(255,255,255,.2);box-shadow:inset 0 1px 0 rgba(255,255,255,.25)}
.qe .card,.qe .sg,.lib li,.lib .empty{background:rgba(255,255,255,.07);border:.5px solid rgba(255,255,255,.1)}
.qe .card{border-radius:22px}
.qe .vw{border-radius:24px}.qe canvas.wave{border-radius:14px;background:rgba(255,255,255,.06)}
.qe .modal .card{background:rgba(28,28,32,.62);-webkit-backdrop-filter:blur(44px) saturate(190%);backdrop-filter:blur(44px) saturate(190%);border:.5px solid rgba(255,255,255,.2);border-radius:32px;box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 24px 60px rgba(0,0,0,.5)}
.qe .selbar{background:rgba(40,40,46,.55);-webkit-backdrop-filter:blur(30px) saturate(185%);backdrop-filter:blur(30px) saturate(185%);border:.5px solid rgba(255,255,255,.2);border-radius:26px;box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 14px 40px rgba(0,0,0,.5)}
.lib ul{margin:0 12px}.lib li:first-child{border-radius:20px 20px 0 0}.lib li:last-child{border-radius:0 0 20px 20px}.lib li:only-child{border-radius:20px}
`;

interface Saved { tight?: boolean; splits?: number[]; enWords?: Word[] | null; capLang?: "fr" | "en"; overlays?: Overlay[]; titles?: Title[]; v: 1; duration: number; words: Word[] | null; cuts: Range[]; ignored: string[]; peaks?: number[]; style?: CaptionStyle; norm?: boolean; q720?: boolean; voice?: boolean; zooms?: boolean }

export interface EditorOptions {
  file: Blob; key: string; name?: string; onClose?: () => void; toast?: (m: string, ms?: number) => void;
  /** App Android : enregistrer dans la Galerie / partager (sinon : lien de téléchargement et partage web). */
  save?: (b: Blob, name: string) => Promise<void>; share?: (b: Blob, name: string) => Promise<void>;
  /** Nettoyage en un geste : transcrire si besoin, puis supprimer tous les défauts détectés. */
  autoClean?: boolean;
  /** Express : transcription → nettoyage → export (réglages et modèle mémorisés) → Galerie, sans autre geste. */
  express?: boolean;
}
/** Seuil de confiance du nettoyage automatique (les suggestions plus incertaines restent proposées). */
const AUTO_MIN = 0.5;
/** Script du prompteur (s'il y en a un) : sert à « Meilleure prise ». */
const scriptText = () => { try { return (localStorage.getItem("gs.script") || "").trim(); } catch { return ""; } };
/** Modèle d'émission : réglages de montage réutilisables d'une vidéo à l'autre (style des sous-titres, zooms, voix, volume, bandeau d'ouverture). */
interface Template { id: string; name: string; rhythm?: Rhythm; lang?: "fr" | "en"; style: CaptionStyle; zooms: boolean; voice: boolean; norm: boolean; q720: boolean; intro?: { text: string; sub?: string } }
const loadTpls = (): Template[] => { try { return JSON.parse(localStorage.getItem("gs.tpl") || "[]"); } catch { return []; } };
const saveTpls = (l: Template[]) => { try { localStorage.setItem("gs.tpl", JSON.stringify(l)); } catch { /* */ } };
const autoTplId = () => { try { return localStorage.getItem("gs.tplAuto") || ""; } catch { return ""; } };
/** Tics de langage de l'utilisateur (modifiables dans Suggestions). */
const myTics = (): string[] => { try { const v = JSON.parse(localStorage.getItem("gs.tics") || "null"); return Array.isArray(v) ? v : TICS; } catch { return TICS; } };
const setTics = (l: string[]) => { try { localStorage.setItem("gs.tics", JSON.stringify(l)); } catch { /* */ } };
const myRhythm = (): Rhythm => { try { const v = localStorage.getItem("gs.rhythm") as Rhythm; return v && v in RHYTHM ? v : "punchy"; } catch { return "punchy"; } }; // Dynamique par défaut : le plus rythmé
const asrHost = () => { try { return localStorage.getItem("gs.asrHost") || ""; } catch { return ""; } };
const verbPref = () => { try { return localStorage.getItem("gs.verbatim") !== "0"; } catch { return true; } };
const autoPref = () => { try { return localStorage.getItem("gs.autoClean") !== "0"; } catch { return true; } };

export async function openEditor(o: EditorOptions) {
  if (!document.getElementById("qe-css")) { const st = document.createElement("style"); st.id = "qe-css"; st.textContent = CSS; document.head.appendChild(st); }
  const toast = o.toast ?? ((m: string) => console.log(m));
  const root = document.createElement("section"); root.className = "qe"; root.setAttribute("aria-label", "Montage");
  root.innerHTML = `
    <header><button data-a="close">Fermer</button><h2>Montage</h2><button data-a="export">Exporter</button></header>
    <div class="vw"><video playsinline preload="auto"></video><video class="spare" playsinline preload="auto" muted></video><canvas class="cc" aria-hidden="true"></canvas></div>
    <div class="tl"><canvas class="wave" aria-label="Timeline : glissez pour vous déplacer, pincez pour zoomer, touchez un clip pour le sélectionner"></canvas>
      <div class="dr"><button class="ib icon" data-a="zout" aria-label="Dézoomer">−</button><button class="ib icon" data-a="zin" aria-label="Zoomer">＋</button>
        <button class="ib" data-a="split" title="Scinder le clip à la tête de lecture (calé entre deux mots)">✂ Scinder</button>
        <button class="ib" data-a="del" disabled>🗑 Supprimer</button><button class="ib" data-a="rest" hidden>↺ Restaurer</button>
        <span class="sp"></span><button class="ib" data-a="fit" title="Voir toute la vidéo">⤢ Tout</button></div></div>
    <div class="transport"><button class="ib round go" data-a="play" aria-label="Lecture">▶</button><span data-r="time">0:00</span><span class="sp"></span>
      <button class="ib icon" data-a="undo" aria-label="Annuler">↶</button><button class="ib icon" data-a="redo" aria-label="Rétablir">↷</button></div>
    <div class="tools">
      <label>Zooms <input type="checkbox" data-a="zooms"></label>
      <button class="ib" data-a="ins" title="Insérer une image ou un extrait par-dessus la vidéo">🖼 Insérer</button>
      <button class="ib" data-a="title" title="Ajouter un bandeau titre">🅣 Bandeau</button>
      <button class="ib" data-a="pub" title="Titres, description, hashtags et accroche">✍️ Publication</button>
      <button class="ib" data-a="voiceAB" title="Écouter votre voix avant / après le traitement studio">🎙 Voix studio</button>
      <button class="ib" data-a="trim" title="Couper le silence avant la première et après la dernière parole">✂ Bords muets</button>
      <label>Sauter les coupes <input type="checkbox" data-a="pv" checked></label></div>
    <div class="row" data-r="status"></div>
    <div class="tabs" role="tablist"><button role="tab" data-tab="tx" aria-selected="true">Texte</button><button role="tab" data-tab="sg" aria-selected="false">Suggestions</button><button role="tab" data-tab="cc" aria-selected="false">Sous-titres</button><button role="tab" data-tab="dress" aria-selected="false">Habillage</button></div>
    <input type="file" data-r="ovFile" accept="image/*,video/*" hidden>
    <div class="body" data-r="body"></div>`;
  document.body.appendChild(root);
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as unknown as T;
  // Deux lecteurs : l'un joue, l'autre attend déjà calé sur la suite après la prochaine coupe → raccord instantané, sans pause.
  let [video, spare] = Array.from(root.querySelectorAll("video")) as HTMLVideoElement[];
  const cv = q<HTMLCanvasElement>("canvas.wave"), ccv = q<HTMLCanvasElement>("canvas.cc"), body = q("[data-r=body]");
  const url = URL.createObjectURL(o.file); video.src = url; spare.src = url;

  /* ---------- État ---------- */
  const storeKey = "gs.qe." + o.key;
  let saved: Saved | null = null; try { saved = JSON.parse(localStorage.getItem(storeKey) || "null"); } catch { /* */ }
  let duration = saved?.duration ?? 0;
  try { duration = (await probe(o.file)).duration || duration; } catch { /* repli : métadonnées du lecteur */ }
  if (!duration || !isFinite(duration)) { await new Promise((r) => (video.onloadedmetadata = r)); duration = isFinite(video.duration) ? video.duration : 0; }
  const session = new EditSession(duration, saved?.cuts ?? []);
  let words: Word[] | null = saved?.words ? cleanTranscript(saved.words) : null, sugs: Suggestion[] = words ? analyze(words, { tics: myTics(), longSilence: RHYTHM[myRhythm()].longSilence, keepPause: RHYTHM[myRhythm()].keepPause }) : [];
  /** Suggestions du texte + du son (bégaiements et hésitations que Whisper n'a pas écrits). */
  const suggest = (w: Word[]) => { const R = RHYTHM[myRhythm()]; const t = analyze(w, { tics: myTics(), longSilence: R.longSilence, keepPause: R.keepPause }); return pcm ? [...t, ...analyzeAudio(w, pcm, 16000, t)].sort((a, b) => a.range.start - b.range.start) : t; };
  const ignored = new Set(saved?.ignored ?? []);
  let pk: Float32Array | null = saved?.peaks ? Float32Array.from(saved.peaks, (x) => x / 255) : null;
  let pcm: Float32Array | null = null, audioErr = "";
  let style: CaptionStyle = { ...CAPTION_DEFAULT, ...(saved?.style ?? {}) }, norm = saved?.norm ?? true, q720 = saved?.q720 ?? false, voice = saved?.voice ?? true, zooms = saved?.zooms ?? true, /* zooms actifs par défaut : montage dynamique */ lines: CapLine[] = [];
  (root.querySelector("[data-a=zooms]") as HTMLInputElement).checked = zooms;
  let overlays: Overlay[] = saved?.overlays ?? [], titles: Title[] = saved?.titles ?? [];
  let splits: number[] = saved?.splits ?? [], tight = saved?.tight ?? false; // tight : débuts de mots déjà recalés sur le son
  let enWords: Word[] | null = saved?.enWords ?? null, capLang: "fr" | "en" = saved?.capLang ?? "fr";
  function applyTpl(tp: Template) {
    style = { ...CAPTION_DEFAULT, ...tp.style }; capLang = tp.lang ?? "fr"; if (tp.rhythm) try { localStorage.setItem("gs.rhythm", tp.rhythm); } catch { /* */ } zooms = tp.zooms; voice = tp.voice; norm = tp.norm; q720 = tp.q720;
    (root.querySelector("[data-a=zooms]") as HTMLInputElement).checked = zooms;
    if (tp.intro?.text && !titles.some((x) => x.id.startsWith("intro"))) titles.push({ id: "intro" + Date.now().toString(36), text: tp.intro.text, sub: tp.intro.sub, start: Math.min(0.3, duration / 4), end: Math.min(duration, 4.3) });
  }
  if (!saved) { const tp = loadTpls().find((x) => x.id === autoTplId()); if (tp) applyTpl(tp); }
  const ovSrc = new Map<string, { blob: Blob; img?: ImageBitmap; vid?: HTMLVideoElement }>();
  async function loadOverlay(id: string, kind: Overlay["kind"], blob?: Blob | null) {
    blob ??= await mediaGet(id); if (!blob) return;
    const e: { blob: Blob; img?: ImageBitmap; vid?: HTMLVideoElement } = { blob };
    if (kind === "image") e.img = await createImageBitmap(blob).catch(() => undefined);
    else { const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = URL.createObjectURL(blob); e.vid = v; }
    ovSrc.set(id, e);
  }
  overlays.forEach((ov) => loadOverlay(ov.id, ov.kind).catch(() => {}));
  let tab: "tx" | "sg" | "cc" | "dress" = "tx", sel: { anchor: number; a: number; b: number } | null = null, inPt: number | null = null, stopAt: number | null = null;
  let worker: Worker | null = null, raf = 0, closed = false, curWord = -1, follow = true;
  const ctl = new AbortController();

  const save = () => {
    const s: Saved = { v: 1, tight, splits, enWords, capLang, duration, words, cuts: session.cuts, ignored: [...ignored], style, norm, q720, voice, zooms, overlays, titles, peaks: pk ? Array.from(pk, (x) => Math.round(x * 255)) : undefined };
    try { localStorage.setItem(storeKey, JSON.stringify(s)); } catch { /* quota localStorage : on garde en mémoire */ }
  };
  const covered = (r: Range) => session.cuts.some((c) => c.start <= r.start + 0.02 && c.end >= r.end - 0.02);
  const inCut = (t: number) => session.cuts.find((c) => t >= c.start - EPS && t < c.end - 0.01);

  /* ---------- Audio : forme d'onde + PCM pour la transcription (lecture par morceaux, pas de chargement complet) ---------- */
  const audioP = extractAudio(o.file, 16000, (p) => { if (!pk) setStatus(`Analyse audio… ${Math.round(p * 100)} %`); }, ctl.signal)
    .then((a) => { pcm = a.pcm; if (words && !tight) { words = tightenWords(words, a.pcm, 16000); tight = true; save(); } if (words) sugs = suggest(words); if (!pk) { pk = computePeaks(a.pcm, 1200); let m = 0; for (const v of pk) m = Math.max(m, v); if (m > 0) for (let i = 0; i < pk.length; i++) pk[i] /= m; save(); } refresh(); })
    .catch((e) => { if (e?.name !== "AbortError") { audioErr = e?.message ?? String(e); refresh(); } });

  /* ---------- Rendu ---------- */
  const setStatus = (m: string) => { q("[data-r=status]").textContent = m; };
  function refresh() {
    if (closed) return;
    (q("[data-a=undo]") as HTMLButtonElement).disabled = !session.canUndo;
    (q("[data-a=redo]") as HTMLButtonElement).disabled = !session.canRedo;
    const ed = session.editedDuration, removed = duration - ed;
    setStatus(`Montage ${fmt(ed)} / ${fmt(duration)} · ${session.cuts.length} coupe(s)${removed > 0.5 ? ` · −${Math.round(removed)} s` : ""}`);
    const open = sugs.filter((s) => !ignored.has(s.id) && !covered(s.range)).length;
    q("[data-tab=sg]").textContent = `Suggestions${sugs.length ? ` (${open})` : ""}`;
    root.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    { const cw = capLang === "en" && enWords ? enWords : words; lines = cw ? buildCaptions(cw, session.cuts) : []; }
    if (tab === "tx") renderText(); else if (tab === "sg") renderSugs(); else if (tab === "dress") renderDress(); else renderCC();
    renderSel();
  }

  function renderText() {
    if (!words) {
      const can = !audioErr;
      body.innerHTML = `<div class="card"><b>Transcription sur l’appareil</b>
        <p>Whisper tourne dans le téléphone : rien n’est envoyé en ligne. Premier usage : téléchargement du modèle (~80 à 300 Mo selon le choix), ensuite hors ligne.</p>
        ${audioErr ? `<p class="error">${esc(audioErr)}</p>` : ""}
        <label class="row" style="padding:0">Qualité <select data-a="model"><option value="auto">Auto (la plus précise possible)</option><option value="small">Très précise (~250 Mo)</option><option value="base">Précise (~80 Mo)</option><option value="tiny">Rapide (~40 Mo)</option></select></label>
        <label class="row" style="padding:0;justify-content:space-between">Supprimer automatiquement les défauts<input type="checkbox" data-a="autoPref" ${autoPref() ? "checked" : ""}></label>
        <label class="row" style="padding:0;justify-content:space-between">Mot pour mot (écrit les « euh », répétitions et faux départs)<input type="checkbox" data-a="verbPref" ${verbPref() ? "checked" : ""}></label>
        <button class="ib go" data-a="transcribe" ${can ? "" : "disabled"}>Transcrire</button>
        <div class="bar" hidden><i></i></div><p data-r="tp"></p>
        <p>Sans transcription, vous pouvez couper avec ⟦ Début / Couper ⟧ sur la timeline.</p></div>`;
      return;
    }
    if (!body.querySelector(".tx")) {
      body.innerHTML = `<div class="tx">${words.map((w, i) => `<span data-i="${i}">${esc(w.text)}</span>`).join(" ")}</div>
        <p style="color:var(--muted);font-size:12px;margin-top:18px">Touchez un mot pour vous y placer, touchez-en un autre pour étendre la sélection. <button class="ib" data-a="retx">Retranscrire</button></p>`;
      curWord = -1;
    }
    const inSug = new Set<number>();
    for (const s of sugs) if (!ignored.has(s.id) && !covered(s.range) && s.type !== "long_silence") for (let i = s.firstWord; i <= s.lastWord; i++) inSug.add(i);
    const spans = body.querySelectorAll<HTMLElement>(".tx span");
    spans.forEach((el, i) => {
      const w = words![i], mid = (w.start + w.end) / 2;
      el.classList.toggle("cut", !!inCut(mid)); el.classList.toggle("sug", inSug.has(i)); el.classList.toggle("sel", !!sel && i >= sel.a && i <= sel.b);
    });
  }

  /** Bilan de la prise (coach) + comparaison avec la moyenne des prises précédentes. */
  function coachCard() {
    if (!words || words.length < 8) return "";
    const r = takeReport(words, sugs, duration, session.cuts);
    let hist: { k: string; score: number; wpm: number; tpm: number }[] = []; try { hist = JSON.parse(localStorage.getItem("gs.coach") || "[]"); } catch { /* */ }
    const prev = hist.filter((h) => h.k !== storeKey).slice(-10);
    hist = [...hist.filter((h) => h.k !== storeKey), { k: storeKey, score: r.score, wpm: r.wpm, tpm: r.ticsPerMin }].slice(-40);
    try { localStorage.setItem("gs.coach", JSON.stringify(hist)); } catch { /* */ }
    const avg = prev.length ? Math.round(prev.reduce((a, h) => a + h.score, 0) / prev.length) : null;
    const cmp = avg == null ? "" : r.score > avg + 2 ? ` · <span style="color:var(--accent)">▲ ${r.score - avg} vs vos ${prev.length} dernières prises</span>` : r.score < avg - 2 ? ` · <span style="color:#ffd60a">▼ ${avg - r.score} vs vos ${prev.length} dernières prises</span>` : " · comme d’habitude";
    const col = r.score >= 80 ? "var(--accent)" : r.score >= 60 ? "#ffd60a" : "#ff6961";
    return `<div class="card" data-coach style="margin-bottom:10px"><div style="display:flex;align-items:center;gap:14px">
      <div style="flex:0 0 58px;height:58px;border-radius:29px;border:4px solid ${col};display:grid;place-items:center;font-size:20px;font-weight:800">${r.score}</div>
      <div><b>Bilan de la prise</b><p style="margin:2px 0 0">${r.wpm ? r.wpm + " mots/min · " : ""}${r.tics} tic(s) · ${r.silences} silence(s)${r.removed > 0.5 ? ` · −${Math.round(r.removed)} s` : ""}${cmp}</p></div></div>
      <ul style="margin:8px 0 0;padding-left:18px">${r.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
  }
  /** Relance l'analyse avec la nouvelle liste de tics, en gardant le panneau ouvert. */
  function retic() { if (words) sugs = suggest(words); body.innerHTML = ""; refresh(); body.querySelector<HTMLDetailsElement>("[data-tics]")?.setAttribute("open", ""); }
  function rhythmCard() {
    const r = myRhythm();
    return `<div class="card" style="margin-bottom:10px;gap:8px"><b>Rythme</b><div class="chips">${(Object.keys(RHYTHM) as Rhythm[]).map((k) => `<button class="ib" data-a="rhythm" data-v="${k}" aria-pressed="${k === r}">${RHYTHM[k].label}</button>`).join("")}</div>
      <p>${r === "punchy" ? "Coupes serrées façon TikTok : silences de plus de 0,3 s retirés, 0,1 s de respiration gardée ; hésitations, répétitions et faux départs coupés au plus près du son." : r === "calm" ? "Pauses respectées : seuls les silences de plus de 1,2 s sont raccourcis." : "Silences de plus de 0,7 s raccourcis à 0,3 s."}</p></div>`;
  }
  function ticsCard() {
    const l = myTics();
    return `<details class="card" data-tics style="margin-bottom:10px"><summary><b>Mes tics de langage</b> (${l.length})</summary>
      <p>Retirés quand ils sont isolés par une pause (« du coup, … »). Touchez-en un pour l’enlever de la liste.</p>
      <div class="chips">${l.map((t) => `<button class="ib" data-a="ticDel" data-v="${esc(t)}">${esc(t)} ✕</button>`).join("")}<button class="ib go" data-a="ticAdd">＋ Ajouter</button></div></details>`;
  }
  function renderSugs() {
    if (!words) { body.innerHTML = `<div class="card"><p>Les suggestions apparaissent après la transcription (onglet Texte).</p></div>`; return; }
    if (!sugs.length) { body.innerHTML = coachCard() + rhythmCard() + ticsCard() + `<div class="card"><p>Aucune répétition, hésitation ni silence long détecté. 👌</p>${scriptText() ? `<button class="ib" data-a="take">🎬 Meilleure prise</button>` : ""}</div>`; return; }
    const open = sugs.filter((s) => !ignored.has(s.id) && !covered(s.range));
    const all = open.filter((s) => s.confidence >= AUTO_MIN).length, sil = open.filter((s) => s.type === "long_silence").length;
    const take = takeInfo ? `<div class="card" style="margin-bottom:10px"><b>Meilleure prise</b><p>${esc(takeSummary())}</p>${takeInfo.missing.length ? `<p>Non dit : ${takeInfo.missing.map((m) => "« " + esc(m) + " »").join(", ")}</p>` : ""}</div>` : "";
    body.innerHTML = coachCard() + take + rhythmCard() + ticsCard() + `<div class="row" style="padding:0 0 8px"><button class="ib go" data-a="clean" ${all ? "" : "disabled"}>✨ Tout supprimer (${all})</button>${scriptText() ? `<button class="ib" data-a="take">🎬 Meilleure prise</button>` : ""}
      <button class="ib" data-a="sil" ${sil ? "" : "disabled"}>Couper les silences (${sil})</button></div>` +
      sugs.map((s) => { const on = covered(s.range), ign = ignored.has(s.id);
        return `<div class="sg ${on ? "on" : ""} ${ign ? "ign" : ""}" data-s="${esc(s.id)}"><div class="t"><b>${LABEL[s.type]} · ${Math.round(s.confidence * 100)} %${on ? " · coupé" : ""}</b>
          <div data-a="hear" title="Écouter">▶ ${esc(s.excerpt)}</div></div>
          <button class="ib" data-a="${on ? "keep" : "cut"}">${on ? "↺ Garder" : "✂ Couper"}</button>
          <button class="ib" data-a="ign" aria-label="${ign ? "Rétablir la suggestion" : "Ignorer"}">${ign ? "↩" : "✕"}</button></div>`; }).join("");
  }

  const MODES: [OverlayMode, string][] = [["full", "Plein écran"], ["pip", "Incrustation"], ["me", "Moi en petit"]];
  function renderDress() {
    const ovRows = overlays.map((ov) => `<div class="sg" data-o="${ov.id}"><div class="t"><b style="color:#64d2ff">${ov.kind === "image" ? "Image" : "Extrait vidéo"} · ${fmt(ov.start)} → ${fmt(ov.end)}</b>
        <div class="chips" style="margin-top:6px">${MODES.map(([m, l]) => `<button class="ib" data-a="omode" data-v="${m}" aria-pressed="${ov.mode === m}">${l}</button>`).join("")}</div></div>
        <button class="ib" data-a="ominus" aria-label="Plus court">−</button><button class="ib" data-a="oplus" aria-label="Plus long">+</button><button class="ib" data-a="ohere">Ici</button><button class="ib" data-a="odel" aria-label="Supprimer">✕</button></div>`).join("");
    const tiRows = titles.map((ti) => `<div class="sg" data-ti="${ti.id}"><div class="t"><b style="color:#bf5af2">Bandeau · ${fmt(ti.start)} → ${fmt(ti.end)}</b>
        <input data-a="ttext" value="${esc(ti.text)}" placeholder="Titre" style="width:100%;margin-top:6px;background:rgba(255,255,255,.08);border:0;border-radius:10px;padding:8px;color:#fff;font:inherit">
        <input data-a="tsub" value="${esc(ti.sub ?? "")}" placeholder="Sous-titre (facultatif)" style="width:100%;margin-top:4px;background:rgba(255,255,255,.06);border:0;border-radius:10px;padding:8px;color:#fff;font:inherit;font-size:14px"></div>
        <button class="ib" data-a="tminus" aria-label="Plus court">−</button><button class="ib" data-a="tplus" aria-label="Plus long">+</button><button class="ib" data-a="there">Ici</button><button class="ib" data-a="tdel" aria-label="Supprimer">✕</button></div>`).join("");
    body.innerHTML = `<div class="row" style="padding:0 0 10px"><button class="ib go" data-a="ins">🖼 Image / extrait</button><button class="ib" data-a="title">🅣 Bandeau</button></div>
      ${ovRows || tiRows ? ovRows + tiRows : `<div class="card"><b>Habillez votre vidéo</b><p>Insérez une case de comic, une couverture ou un extrait : il s’affiche par-dessus la vidéo au moment choisi (tête de lecture, ou les mots sélectionnés dans Texte), en plein écran, en incrustation, ou avec vous en petit dans un coin. Ajoutez un bandeau « Nom · Thème du jour ».</p></div>`}`;
  }
  /** Insère le fichier choisi : sur les mots sélectionnés, sinon à la tête de lecture (3,5 s pour une image). */
  async function insertMedia(f: File) {
    const kind: Overlay["kind"] = f.type.startsWith("video/") ? "video" : "image", id = "ov" + Date.now().toString(36);
    let start = video.currentTime, end = start + 3.5;
    if (sel && words) { start = words[sel.a].start; end = Math.max(words[sel.b].end, start + 1); sel = null; }
    if (kind === "video") { try { const d = (await probe(f)).duration; if (!sel) end = start + Math.min(Math.max(1, d), 8); } catch { /* */ } }
    end = Math.min(duration, end); if (end - start < 0.5) start = Math.max(0, end - 2);
    await mediaPut(id, f).catch(() => toast("Fichier gardé pour cette session seulement (stockage indisponible).", 4000));
    await loadOverlay(id, kind, f);
    overlays.push({ id, kind, start, end, mode: "full" }); overlays.sort((a, b) => a.start - b.start);
    tab = "dress"; body.innerHTML = ""; commit(); toast("Inséré. Choisissez son affichage dans Habillage.", 2500);
  }
  function addTitle() {
    const t = prompt("Bandeau — titre (ex. « Comics News »)", "")?.trim(); if (!t) return;
    const sub = prompt("Sous-titre (facultatif, ex. « Le nouveau Spider-Man »)", "")?.trim() || undefined;
    const start = video.currentTime; titles.push({ id: "ti" + Date.now().toString(36), text: t, sub, start, end: Math.min(duration, start + 4) });
    titles.sort((a, b) => a.start - b.start); tab = "dress"; body.innerHTML = ""; commit();
  }
  /** Image de l'extrait pour l'aperçu (extrait vidéo calé sur la lecture). */
  function previewSrc(ov: Overlay, t: number) {
    const e = ovSrc.get(ov.id); if (!e) return null;
    if (e.img) return e.img;
    const v = e.vid!; const want = Math.max(0, t - ov.start);
    if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
    if (!video.paused && v.paused) v.play().catch(() => {}); if (video.paused && !v.paused) v.pause();
    return v.readyState >= 2 ? v : null;
  }

  function tplCard() {
    const l = loadTpls(), au = autoTplId();
    return `<div class="card" data-tpl style="margin-bottom:10px"><b>Modèle d’émission</b><p>Gardez votre style (sous-titres, zooms, voix, bandeau d’ouverture) et réappliquez-le en un geste.</p>
      ${l.length ? `<div class="chips">${l.map((tp) => `<button class="ib" data-a="tplUse" data-v="${tp.id}">${tp.id === au ? "★ " : ""}${esc(tp.name)}</button>`).join("")}</div>
      <label class="opt"><select data-a="tplAuto" style="flex:1"><option value="">Nouvelles vidéos : aucun modèle</option>${l.map((tp) => `<option value="${tp.id}" ${tp.id === au ? "selected" : ""}>Nouvelles vidéos : ${esc(tp.name)}</option>`).join("")}</select></label>` : ""}
      <div class="row" style="padding:6px 0 0"><button class="ib go" data-a="tplSave">＋ Enregistrer ce style</button>${l.length ? `<button class="ib" data-a="tplDel">Supprimer…</button>` : ""}</div></div>`;
  }
  function renderCC() {
    if (!words) { body.innerHTML = tplCard() + `<div class="card"><p>Les sous-titres sont générés à partir de la transcription (onglet Texte).</p></div>`; return; }
    if (body.querySelector("[data-cc]")) return; // déjà affiché : on ne casse pas le curseur en cours de glissement
    body.innerHTML = tplCard() + `<div class="card" data-cc><b>Sous-titres incrustés</b><p>Aperçu en direct sur la vidéo. Ils sont gravés dans l’export (visibles partout, même son coupé).</p>
      <div class="chips" style="margin-bottom:8px"><button class="ib" data-a="lang" data-v="fr" aria-pressed="${capLang === "fr"}">🇫🇷 Français</button><button class="ib" data-a="lang" data-v="en" aria-pressed="${capLang === "en"}">🇬🇧 Anglais (traduit)</button></div>
      ${capLang === "en" ? `<p data-r="trs">${enWords ? `Traduction prête (${enWords.length} mots). <button class="ib" data-a="retr">Retraduire</button>` : "Traduction en cours…"}</p>` : ""}
      <div class="chips">${(Object.keys(PRESETS) as CaptionPreset[]).map((k) => `<button class="ib" data-a="preset" data-v="${k}" aria-pressed="${style.preset === k}">${PRESETS[k]}</button>`).join("")}</div>
      <label class="opt">Haut <input type="range" data-a="pos" min="0.12" max="0.88" step="0.01" value="${style.pos}"> Bas</label>
      <label class="opt"><input type="checkbox" data-a="upper" ${style.upper ? "checked" : ""}> MAJUSCULES</label>
      <label class="opt">Couleur du mot actif <input type="color" data-a="color" value="${style.color}"></label>
      <p>Un mot mal transcrit ? Onglet Texte : touchez-le, puis ✎.</p></div>`;
  }
  const setStyle = (p: Partial<CaptionStyle>) => { style = { ...style, ...p }; save(); };
  q<HTMLInputElement>("[data-r=ovFile]").onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ""; if (f) insertMedia(f).catch((err) => toast("Insertion impossible : " + (err?.message ?? err), 5000)); };
  body.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement, a = t.dataset.a;
    if (a === "ttext" || a === "tsub") { const ti = titles.find((x) => x.id === t.closest<HTMLElement>("[data-ti]")?.dataset.ti); if (ti) { if (a === "ttext") ti.text = t.value; else ti.sub = t.value || undefined; save(); } return; }
    if (a === "tplAuto") { try { localStorage.setItem("gs.tplAuto", t.value); } catch { /* */ } body.innerHTML = ""; renderCC(); return; }
    if (a === "pos") setStyle({ pos: +t.value }); else if (a === "upper") setStyle({ upper: t.checked }); else if (a === "color") setStyle({ color: t.value });
  });

  /** Sous-titres en surimpression sur le lecteur (même rendu que l'export). */
  function drawCC() {
    const dpr = devicePixelRatio || 1, bw = ccv.clientWidth, bh = ccv.clientHeight;
    if (ccv.width !== Math.round(bw * dpr) || ccv.height !== Math.round(bh * dpr)) { ccv.width = Math.round(bw * dpr); ccv.height = Math.round(bh * dpr); }
    const g = ccv.getContext("2d")!; g.clearRect(0, 0, ccv.width, ccv.height);
    if (!video.videoWidth) return;
    const k = Math.min(bw / video.videoWidth, bh / video.videoHeight), w = video.videoWidth * k * dpr, h = video.videoHeight * k * dpr, t = video.currentTime;
    const ov = activeAt(overlays, t), ti = activeAt(titles, t);
    for (const o of overlays) if (o !== ov) { const v = ovSrc.get(o.id)?.vid; if (v && !v.paused) v.pause(); }
    if (ov || ti) {
      g.save(); g.translate((ccv.width - w) / 2, (ccv.height - h) / 2);
      compose(g, w, h, t, ov, ov ? previewSrc(ov, t) : null, (x, y, ww, hh) => { if (x || y || ww !== w || hh !== h) g.drawImage(video, x, y, ww, hh); });
      drawTitle(g, w, h, t, ti); g.restore();
    }
    if (!lines.length || style.preset === "none") return;
    drawCaption(g, (ccv.width - w) / 2, (ccv.height - h) / 2, w, h, lineAt(lines, video.currentTime), video.currentTime, style);
  }

  let selBar: HTMLElement | null = null;
  function renderSel() {
    if (!sel || !words || tab !== "tx") { selBar?.remove(); selBar = null; return; }
    if (!selBar) {
      selBar = document.createElement("div"); selBar.className = "selbar";
      selBar.innerHTML = `<span></span><button class="ib" data-a="hearSel">▶</button><button class="ib" data-a="fixSel" title="Corriger le mot">✎</button><button class="ib go" data-a="cutSel">✂ Couper</button><button class="ib" data-a="keepSel">↺ Garder</button><button class="ib" data-a="clearSel" aria-label="Désélectionner">✕</button>`;
      root.appendChild(selBar);
    }
    const n = sel.b - sel.a + 1, txt = words.slice(sel.a, sel.b + 1).map((w) => w.text).join(" ");
    selBar.querySelector("span")!.textContent = `${n} mot${n > 1 ? "s" : ""} · ${txt}`;
    (selBar.querySelector("[data-a=fixSel]") as HTMLElement).hidden = n !== 1;
  }

  /* ---------- Timeline de dérush ----------
     Vue d'ensemble (toute la vidéo) ou zoomée (tête de lecture fixe au centre, on fait défiler la vidéo dessous, comme CapCut).
     Clips = parties gardées (découpées aux scissions) ; coupes en rouge ; mots sous la forme d'onde ; poignées pour rogner. */
  let pps = 0, tsel: { kind: "clip" | "cut"; start: number; end: number } | null = null, trimPrev: Range[] | null = null;
  const fitPps = () => cv.clientWidth / (duration || 1), zoomed = () => pps > fitPps() * 1.05;
  const view = () => { const W = cv.clientWidth, p = zoomed() ? pps : fitPps(); return { p, t0: zoomed() ? video.currentTime - W / 2 / p : 0 }; };
  const timeAt = (x: number) => { const v = view(); return Math.max(0, Math.min(duration, v.t0 + x / v.p)); };
  const curCuts = () => trimPrev ?? session.cuts;
  function selClip() { if (tsel?.kind !== "clip") return null; const m = (tsel.start + tsel.end) / 2; return clipsOf(duration, curCuts(), splits).find((c) => m >= c.start && m < c.end) ?? null; }
  function updateDr() {
    const c = tsel?.kind === "clip", k = tsel?.kind === "cut";
    (q("[data-a=del]") as HTMLButtonElement).disabled = !c; (q("[data-a=rest]") as HTMLElement).hidden = !k; (q("[data-a=del]") as HTMLElement).hidden = k;
  }
  function draw() {
    const dpr = devicePixelRatio || 1, Wc = cv.clientWidth, Hc = cv.clientHeight, W = Math.round(Wc * dpr), H = Math.round(Hc * dpr);
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    if (!pps) pps = fitPps();
    const g = cv.getContext("2d")!, { p, t0 } = view(), t1 = t0 + Wc / p, X = (t: number) => (t - t0) * p * dpr, cuts = curCuts(), zm = zoomed();
    g.clearRect(0, 0, W, H);
    const yT = (zm ? 12 : 6) * dpr, yB = (words && p >= 40 ? Hc - 22 : Hc - 6) * dpr, hh = yB - yT;
    // vue d'ensemble miniature (en mode zoom) : coupes et fenêtre visible
    if (zm) { g.fillStyle = "#2c2c2e"; g.fillRect(0, 2 * dpr, W, 4 * dpr); g.fillStyle = "rgba(255,69,58,.8)"; for (const c of cuts) g.fillRect((c.start / duration) * W, 2 * dpr, Math.max(1, ((c.end - c.start) / duration) * W), 4 * dpr);
      g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect((Math.max(0, t0) / duration) * W, 1 * dpr, Math.max(3, ((t1 - t0) / duration) * W), 6 * dpr); }
    // forme d'onde (fine si le son est décodé)
    const cols = Math.max(1, Math.floor(W / (2 * dpr))), ta = Math.max(0, t0), tb = Math.min(duration, t1);
    let wav: Float32Array | null = null, wa = ta, wb = tb;
    if (pcm && tb > ta) { wav = wavePeaks(pcm, 16000, ta, tb, Math.max(1, Math.round(((tb - ta) * p) / 2))); }
    let wmax = 0.02; if (wav) for (const v of wav) wmax = Math.max(wmax, v);
    const waveIn = (a: number, b: number, color: string) => {
      g.fillStyle = color;
      if (wav) { const n = wav.length, step = (wb - wa) / n; for (let i = Math.max(0, Math.floor((a - wa) / step)); i < Math.min(n, Math.ceil((b - wa) / step)); i++) {
        const h = Math.max(1, (wav[i] / wmax) * (hh - 6 * dpr)); g.fillRect(X(wa + i * step), yT + (hh - h) / 2, Math.max(1, step * p * dpr - dpr), h); } }
      else if (pk) { const n = pk.length; for (let i = Math.max(0, Math.floor((a / duration) * n)); i < Math.min(n, Math.ceil((b / duration) * n)); i++) {
        const h = Math.max(1, pk[i] * (hh - 6 * dpr)); g.fillRect(X((i / n) * duration), yT + (hh - h) / 2, Math.max(1, (duration / n) * p * dpr - dpr), h); } }
    };
    void cols;
    const rr = (x: number, y: number, w: number, h: number, r: number) => { g.beginPath(); (g as any).roundRect ? (g as any).roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
    // coupes : fond rouge discret, son grisé
    for (const c of cuts) { if (c.end < t0 || c.start > t1) continue; g.fillStyle = "rgba(255,69,58,.16)"; g.fillRect(X(c.start), yT, X(c.end) - X(c.start), hh); waveIn(c.start, c.end, "rgba(255,255,255,.16)");
      g.fillStyle = "rgba(255,69,58,.9)"; g.fillRect(X(c.start), yT, X(c.end) - X(c.start), 2 * dpr); }
    // clips gardés
    const cl = clipsOf(duration, cuts, splits), sc = tsel?.kind === "clip" ? selClip() : null;
    for (const c of cl) { if (c.end < t0 || c.start > t1) continue; const x = X(c.start) + dpr, w = Math.max(2, X(c.end) - X(c.start) - 2 * dpr);
      rr(x, yT, w, hh, 7 * dpr); g.fillStyle = sc && c.start === sc.start ? "#24453a" : "#1f2f28"; g.fill(); g.save(); rr(x, yT, w, hh, 7 * dpr); g.clip(); waveIn(c.start, c.end, "#6fd39c"); g.restore(); }
    // repères : extraits (bleu), bandeaux (violet), suggestions (jaune)
    g.fillStyle = "rgba(100,210,255,.95)"; for (const o of overlays) g.fillRect(X(o.start), yT + 2 * dpr, Math.max(2, X(o.end) - X(o.start)), 3 * dpr);
    g.fillStyle = "rgba(191,90,242,.95)"; for (const ti of titles) g.fillRect(X(ti.start), yT + 6 * dpr, Math.max(2, X(ti.end) - X(ti.start)), 3 * dpr);
    g.fillStyle = "#ffd60a"; for (const s of sugs) if (!ignored.has(s.id) && !covered(s.range)) g.fillRect(X(s.range.start), yB - 4 * dpr, Math.max(2, X(s.range.end) - X(s.range.start)), 3 * dpr);
    // sélection : cadre blanc + poignées
    if (sc) { const x = X(sc.start), w = X(sc.end) - x; g.lineWidth = 2 * dpr; g.strokeStyle = "#fff"; rr(x + dpr, yT, w - 2 * dpr, hh, 7 * dpr); g.stroke();
      g.fillStyle = "#fff"; for (const hx of [x, x + w - 9 * dpr]) { rr(hx + dpr, yT, 8 * dpr, hh, 4 * dpr); g.fill(); }
      g.fillStyle = "#1f2f28"; for (const hx of [x, x + w - 9 * dpr]) g.fillRect(hx + 4 * dpr, yT + hh / 2 - 8 * dpr, 2 * dpr, 16 * dpr); }
    else if (tsel?.kind === "cut") { const x = X(tsel.start), w = X(tsel.end) - x; g.lineWidth = 2 * dpr; g.strokeStyle = "#ff6961"; g.setLineDash([5 * dpr, 4 * dpr]); g.strokeRect(x, yT, w, hh); g.setLineDash([]); }
    // mots
    if (words && p >= 40) { g.font = `${11 * dpr}px system-ui,sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; let lastR = -1e9;
      for (const w of words) { if (w.end < t0 || w.start > t1) continue; const cx = X((w.start + w.end) / 2), tw = g.measureText(w.text).width; if (cx - tw / 2 < lastR + 4 * dpr) continue; lastR = cx + tw / 2;
        const m = (w.start + w.end) / 2, off = cuts.some((c) => m >= c.start && m < c.end); g.fillStyle = off ? "rgba(255,105,97,.6)" : "rgba(235,235,245,.8)"; g.fillText(w.text, cx, yB + 11 * dpr);
        if (off) g.fillRect(cx - tw / 2, yB + 11 * dpr, tw, dpr); } }
    // tête de lecture
    const ph = X(video.currentTime); g.fillStyle = "#fff"; g.fillRect(ph - dpr, 0, 2 * dpr, H); g.beginPath(); g.moveTo(ph - 6 * dpr, 0); g.lineTo(ph + 6 * dpr, 0); g.lineTo(ph, 7 * dpr); g.fill();
    updateDr();
  }
  /* gestes : glisser = défiler (ou rogner sur une poignée), pincer = zoomer, toucher = sélectionner */
  const ptrs = new Map<number, number>(); let gst: { x0: number; cur0: number; moved: boolean; mode: "pan" | "trim" | "pinch"; side?: "start" | "end"; clip?: Range; d0?: number; p0?: number; was?: boolean } | null = null;
  const cx = (e: PointerEvent) => e.clientX - cv.getBoundingClientRect().left;
  cv.onpointerdown = (e) => {
    cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, cx(e));
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; gst = { x0: 0, cur0: video.currentTime, moved: true, mode: "pinch", d0: Math.abs(a - b) || 1, p0: zoomed() ? pps : fitPps() }; return; }
    const x = cx(e), sc = selClip(); let mode: "pan" | "trim" = "pan", side: "start" | "end" | undefined;
    if (sc) { const v = view(), xs = (sc.start - v.t0) * v.p, xe = (sc.end - v.t0) * v.p; if (Math.abs(x - xs) < 16) { mode = "trim"; side = "start"; } else if (Math.abs(x - xe) < 16) { mode = "trim"; side = "end"; } }
    gst = { x0: x, cur0: video.currentTime, moved: false, mode, side, clip: sc ?? undefined, was: !video.paused };
  };
  cv.onpointermove = (e) => {
    if (!gst || !ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, cx(e));
    if (gst.mode === "pinch") { if (ptrs.size < 2) return; const [a, b] = [...ptrs.values()]; pps = Math.max(fitPps(), Math.min(800, gst.p0! * (Math.abs(a - b) || 1) / gst.d0!)); return; }
    const x = cx(e); if (!gst.moved && Math.abs(x - gst.x0) < 6) return; gst.moved = true;
    if (gst.mode === "trim") { let t = timeAt(x); t = snapSplit(t, words, 0.08); trimPrev = trimEdge(duration, session.cuts, gst.clip!, gst.side!, t); if (!video.paused) video.pause(); seek(t); return; }
    if (!video.paused) video.pause();
    if (zoomed()) seek(gst.cur0 - (x - gst.x0) / pps); else seek(timeAt(x));
  };
  cv.onpointerup = cv.onpointercancel = (e) => {
    ptrs.delete(e.pointerId); if (!gst) return;
    if (gst.mode === "pinch") { if (ptrs.size === 0) gst = null; return; }
    if (gst.mode === "trim" && trimPrev) { const m = (gst.clip!.start + gst.clip!.end) / 2; session.replace(trimPrev); trimPrev = null; const c = clipsOf(duration, session.cuts, splits).find((k) => m >= k.start && m < k.end) ?? clipsOf(duration, session.cuts, splits).find((k) => k.end > gst!.clip!.start && k.start < gst!.clip!.end); tsel = c ? { kind: "clip", start: c.start, end: c.end } : null; commit(); }
    else if (!gst.moved) { const t = timeAt(gst.x0), h = hitAt(t, clipsOf(duration, session.cuts, splits), session.cuts);
      if (!zoomed()) seek(t);
      tsel = !h ? null : h.kind === "clip" ? (tsel?.kind === "clip" && tsel.start === h.clip.start && zoomed() ? null : { kind: "clip", start: h.clip.start, end: h.clip.end }) : { kind: "cut", start: h.cut.start, end: h.cut.end }; }
    gst = null;
  };
  /** Actions de la barre de dérush. */
  function derush(a: string) {
    switch (a) {
      case "zin": pps = Math.min(800, (zoomed() ? pps : fitPps()) * 1.8); break;
      case "zout": pps = Math.max(fitPps(), pps / 1.8); break;
      case "fit": pps = fitPps(); break;
      case "split": { const t = snapSplit(video.currentTime, words); const h = hitAt(t, clipsOf(duration, session.cuts, splits), session.cuts);
        if (h?.kind !== "clip" || t - h.clip.start < 0.05 || h.clip.end - t < 0.05) { toast("Placez la tête de lecture dans un clip gardé.", 2000); break; }
        splits = [...splits.filter((x) => Math.abs(x - t) > 0.02), t]; tsel = { kind: "clip", start: t, end: h.clip.end }; save(); toast("Clip scindé. Touchez un morceau pour le supprimer.", 2200); break; }
      case "del": { const c = selClip(); if (!c) break; session.addCut({ start: c.start, end: c.end }); tsel = null; commit(); toast(`Clip supprimé (${fmt(c.end - c.start)}).`, 1800); break; }
      case "rest": if (tsel?.kind === "cut") { session.restore({ start: tsel.start, end: tsel.end }); tsel = null; commit(); } break;
    }
  }

  /* ---------- Lecture : saute les parties coupées ---------- */
  /** Cale le lecteur de réserve sur `at` (en pause, image décodée) avant d'en avoir besoin. */
  function prepare(at: number) { if (+(spare.dataset.at ?? -1) !== at) { spare.dataset.at = String(at); spare.pause(); spare.currentTime = at; } }
  /** Passe à `at` : bascule instantanée vers le lecteur de réserve s'il est prêt, sinon saut classique. */
  function jump(at: number) {
    if (+(spare.dataset.at ?? -1) === at && !spare.seeking && spare.readyState >= 3) {
      spare.muted = false; spare.play().catch(() => {}); spare.classList.remove("spare");
      video.classList.add("spare"); video.muted = true; video.pause();
      [video, spare] = [spare, video]; spare.dataset.at = "-1"; arm();
    } else video.currentTime = at;
  }
  /* Garde-fou image par image : vérifié juste avant l'affichage de chaque image vidéo (indépendant de la fluidité de l'interface). */
  let vfEl: HTMLVideoElement | null = null, vfH = 0;
  const onVF = (_n: number, meta: { mediaTime: number }) => {
    if (closed) return;
    if (!video.paused && pvOn() && stopAt == null) { const c = inCut(meta.mediaTime + 0.008); if (c) { if (c.end >= duration - 0.05) video.pause(); else jump(c.end); } }
    arm();
  };
  function arm() { const v = video as any; if (!v.requestVideoFrameCallback) return; if (vfEl) (vfEl as any).cancelVideoFrameCallback(vfH); vfEl = video; vfH = v.requestVideoFrameCallback(onVF); }
  arm();
  function seek(t: number) { stopAt = null; video.currentTime = Math.max(0, Math.min(duration, t)); }
  function playRange(a: number, b: number) { video.currentTime = Math.max(0, a); stopAt = b; follow = true; video.play().catch(() => {}); }
  const pvOn = () => (q("[data-a=pv]") as HTMLInputElement).checked;
  function tick() {
    if (closed) return;
    const t = video.currentTime;
    if (!video.paused) {
      if (stopAt != null && t >= stopAt) { video.pause(); stopAt = null; }
      else if (pvOn() && stopAt == null) {
        const c = inCut(t + 0.008);
        if (c) { if (c.end >= duration - 0.05) video.pause(); else jump(c.end); }
        else { const nx = session.cuts.find((x) => x.start > t); if (nx && nx.start - t < 2 && nx.end < duration - 0.05) prepare(nx.end); }
      }
    }
    q("[data-r=time]").textContent = `${fmt(t)} / ${fmt(duration)}`;
    q("[data-a=play]").textContent = video.paused ? "▶" : "⏸";
    if (words && tab === "tx") { // mot en cours
      let lo = 0, hi = words.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (words[m].start <= t) { k = m; lo = m + 1; } else hi = m - 1; }
      if (k !== curWord) { const sp = body.querySelectorAll<HTMLElement>(".tx span"); sp[curWord]?.classList.remove("cur"); curWord = k;
        if (sp[k]) { sp[k].classList.add("cur"); if (!video.paused && follow) sp[k].scrollIntoView({ block: "center", behavior: "smooth" }); } }
    }
    { const z = zooms ? zoomAt(t) : 1; video.style.transform = z > 1 ? `scale(${z})` : ""; video.style.transformOrigin = "50% 30%"; spare.style.transform = ""; }
    draw(); drawCC(); raf = requestAnimationFrame(tick);
  }
  body.addEventListener("touchmove", () => (follow = false), { passive: true }); // l'utilisateur fait défiler : on ne le contrarie pas

  /* ---------- Transcription ---------- */
  async function transcribe() {
    const btn = body.querySelector<HTMLButtonElement>("[data-a=transcribe]"), bar = body.querySelector<HTMLElement>(".bar"), tp = body.querySelector<HTMLElement>("[data-r=tp]");
    const model = body.querySelector<HTMLSelectElement>("[data-a=model]")?.value ?? "auto";
    if (btn) btn.disabled = true; if (bar) bar.hidden = false;
    const show = (p: number, m: string) => { if (bar) (bar.firstElementChild as HTMLElement).style.width = Math.round(p * 100) + "%"; if (tp) tp.textContent = m; };
    show(0, "Préparation de l’audio…");
    await audioP; if (!pcm) { show(0, audioErr || "Audio indisponible."); if (btn) btn.disabled = false; return; }
    worker?.terminate();
    worker = new Worker(new URL("../workers/transcribe.worker.ts", import.meta.url), { type: "module" });
    const t0 = performance.now();
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === "download") show(d.p, `Téléchargement du modèle (une seule fois) : ${Math.round(d.p * 100)} % de ${Math.round(d.mb)} Mo`);
      else if (d.type === "loaded") show(0, `Transcription en cours (modèle ${d.model}, ${d.device === "webgpu" ? "GPU" : "processeur"})…`);
      else if (d.type === "progress") show(d.p, `Transcription ${Math.round(d.p * 100)} %${d.eta > 1 ? ` · reste ~${fmt(d.eta)}` : ""}`);
      else if (d.type === "done") {
        worker?.terminate(); worker = null; words = cleanTranscript(d.words); if (pcm) { words = tightenWords(words, pcm, 16000); tight = true; } else tight = false; sugs = suggest(words!); // élisions recollées, génériques inventés retirés sel = null; save();
        body.innerHTML = ""; refresh();
        if (o.express) cleanAll().then(() => runExport(true)); // express : tout s’enchaîne
        else if (o.autoClean || autoPref()) cleanAll(); // nettoyage automatique (option, activée par défaut)
        else toast(`Transcrit en ${fmt((performance.now() - t0) / 1000)} · ${sugs.length} suggestion(s).`, 4000);
      } else if (d.type === "error") {
        worker?.terminate(); worker = null; if (btn) btn.disabled = false;
        const net = /fetch|network|load/i.test(d.message);
        if (o.express) { toast("Transcription impossible : export sans nettoyage.", 4000); runExport(true); }
        show(0, net ? "Impossible de télécharger le modèle de transcription. Vérifiez la connexion (nécessaire une seule fois), puis réessayez."
          : "Échec de la transcription : " + d.message);
      }
    };
    const copy = pcm.slice(); worker.postMessage({ type: "run", audio: copy, language: "fr", model, verbatim: verbPref(), host: asrHost() }, [copy.buffer]);
  }

  /** Sous-titres anglais : Whisper traduit directement l'audio (sur l'appareil), phrase par phrase. */
  let trWorker: Worker | null = null;
  async function translateEN() {
    const msg = (m: string) => { const e = body.querySelector<HTMLElement>("[data-r=trs]"); if (e) e.textContent = m; };
    await audioP; if (!pcm) { msg(audioErr || "Audio indisponible."); return; }
    trWorker?.terminate(); trWorker = new Worker(new URL("../workers/transcribe.worker.ts", import.meta.url), { type: "module" });
    trWorker.onmessage = (e) => { const d = e.data;
      if (d.type === "download") msg(`Téléchargement du modèle (une seule fois) : ${Math.round(d.p * 100)} %`);
      else if (d.type === "progress") msg(`Traduction ${Math.round(d.p * 100)} %${d.eta > 1 ? ` · reste ~${fmt(d.eta)}` : ""}`);
      else if (d.type === "done") { trWorker?.terminate(); trWorker = null; enWords = d.words; save(); if (tab === "cc") body.innerHTML = ""; refresh(); toast("Sous-titres anglais prêts.", 2500); }
      else if (d.type === "error") { trWorker?.terminate(); trWorker = null; msg("Échec de la traduction : " + d.message); } };
    const copy = pcm.slice(); trWorker.postMessage({ type: "run", audio: copy, language: "fr", model: "auto", translate: true }, [copy.buffer]);
  }

  /** Coupe le silence avant la première parole et après la dernière (mots si transcrits, sinon énergie audio). */
  async function edgeCuts(): Promise<Range[] | null> {
    let b: { start: number; end: number } | null = null;
    if (words?.length) b = { start: words[0].start, end: words[words.length - 1].end };
    else { await audioP; if (pcm) b = speechBounds(pcm, 16000); }
    if (!b) return null;
    const r: Range[] = []; if (b.start - 0.25 > 0.1) r.push({ start: 0, end: b.start - 0.25 }); if (duration - (b.end + 0.4) > 0.1) r.push({ start: b.end + 0.4, end: duration });
    return r.filter((x) => !covered(x));
  }
  async function trimEdges() {
    const r = await edgeCuts();
    if (!r) return toast("Aucune parole détectée.", 2500);
    if (!r.length) return toast("Pas de silence à couper au début ni à la fin.", 2500);
    session.addCuts(r); commit(); toast(`Bords coupés (−${r.reduce((s, x) => s + x.end - x.start, 0).toFixed(1)} s). ↶ pour annuler.`, 3000);
  }
  /** Supprime d'un coup tous les défauts détectés (bégaiements, « euh », répétitions, faux départs, silences, bords muets).
   *  Une seule action : ↶ annule tout ; chaque coupe reste visible et réversible dans Suggestions. */
  /** Meilleure prise selon le script, seulement si la prise suit vraiment le script (≥ 40 % des mots reconnus). */
  let takeInfo: TakeResult | null = null;
  function takeCuts(): Range[] {
    const sc = scriptText(); if (!sc || !words?.length) return [];
    const r = bestTakes(words, sc, duration), hit = r.matched.filter((m) => m >= 0).length / words.length;
    if (hit < 0.4) { takeInfo = null; return []; }
    takeInfo = r; return r.cuts.filter((c) => !covered(c));
  }
  const takeSummary = () => takeInfo ? `🎬 ${takeInfo.kept.length} phrase(s) gardée(s)${takeInfo.retakes ? `, ${takeInfo.retakes} reprise(s) retirée(s)` : ""}${takeInfo.missing.length ? ` · ${takeInfo.missing.length} non dite(s)` : ""}` : "";
  async function bestTake() {
    const r = takeCuts();
    if (!takeInfo) return toast(scriptText() ? "Cette prise ne suit pas le script du prompteur." : "Ajoutez votre script dans le prompteur pour utiliser « Meilleure prise ».", 4000);
    if (r.length) { session.addCuts(r); commit(); } else refresh();
    toast(takeSummary() + " · ↶ pour annuler.", 6000);
  }
  /** Comment caler les bords d'une coupe : vers le silence autour (hésitation isolée), sans approcher le mot suivant (parole avalée, blanc), ou au plus près. */
  const snapMode = (s: Suggestion): SnapMode => s.id.startsWith("swallowed-") || /avant «/.test(s.excerpt) && s.type === "long_silence" ? "pre" : s.type === "long_silence" ? "both" : "out";
  async function cleanAll() {
    await audioP; if (words) sugs = suggest(words);
    let r: Range[] = sugs.filter((s) => !ignored.has(s.id) && !covered(s.range) && s.confidence >= AUTO_MIN).map((s) => ({ ...s.range, mode: snapMode(s) }));
    if (pcm) r = snapToQuiet(withBounds(r, words), pcm, 16000); // bords de coupe sur le silence le plus proche (au centième de seconde)
    r.push(...takeCuts()); // reprises et hors-script retirés si la prise suit le script
    r.push(...((await edgeCuts()) ?? []));
    if (!r.length) { refresh(); return toast("Aucun défaut à supprimer. 👌", 3000); }
    r = dropCrumbs([...session.cuts, ...r], words, duration); // miettes entre deux coupes (< 0,15 s, sans mot) : coupées aussi
    const before = session.editedDuration; session.addCuts(r); commit();
    toast(`✨ ${r.length} défaut(s) supprimé(s) (−${(before - session.editedDuration).toFixed(1)} s)${takeInfo ? " · " + takeSummary() : ""}. ↶ pour annuler.`, 6000);
  }

  /** Zooms dynamiques (« punch-in ») : le zoom alterne 1× / 1,12× à chaque raccord et à chaque fin de phrase, avec au moins
   *  1,2 s (temps monté) entre deux changements : masque les sauts d'image sans effet stroboscopique quand les coupes sont serrées. */
  let zCache: { cuts: Range[]; words: Word[] | null; at: number[] } | null = null;
  function zoomTimes(): number[] {
    if (zCache && zCache.cuts === session.cuts && zCache.words === words) return zCache.at;
    const cand = session.cuts.map((c) => c.end);
    if (words) for (let i = 0; i + 1 < words.length; i++) if (/[.!?…]$/.test(words[i].text) && !inCut((words[i].end + words[i + 1].start) / 2)) cand.push(words[i + 1].start);
    cand.sort((a, b) => a - b); const at: number[] = []; let last = 0;
    for (const t of cand) { if (t >= duration - 0.3) continue; const e = sourceToEdited(t, duration, session.cuts); if (e - last >= 1.2) { at.push(t); last = e; } }
    zCache = { cuts: session.cuts, words, at }; return at;
  }
  function zoomAt(t: number): number {
    const at = zoomTimes(); let lo = 0, hi = at.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (at[m] <= t) lo = m + 1; else hi = m; }
    return lo % 2 ? 1.12 : 1;
  }

  /** Écoute comparée : 6 s à partir de la tête de lecture, son d'origine puis voix studio. */
  /** Textes de publication : Gemini Nano sur le téléphone si possible, sinon version locale. */
  async function publishText() {
    if (!words) { toast("Transcrivez d’abord la vidéo (onglet Texte).", 3000); return; }
    video.pause();
    const W = await import("../core/writer.ts"), N = await import("../native.ts");
    const cutW = (w: Word) => { const m = (w.start + w.end) / 2; return session.cuts.some((c) => m >= c.start && m < c.end); };
    const text = words.filter((w) => !cutW(w)).map((w) => w.text).join(" ");
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<div class="card" style="max-height:80vh;overflow:auto"><b>Publication</b><p data-r="pst">Rédaction sur votre téléphone…</p><div data-r="pres"></div>
      <div class="row" style="padding:0"><button class="ib" data-x="again" hidden>↻ Autres idées</button><button class="ib" data-x="ok">Fermer</button></div></div>`;
    root.appendChild(m);
    const st = m.querySelector<HTMLElement>("[data-r=pst]")!, res = m.querySelector<HTMLElement>("[data-r=pres]")!;
    let temp = 0.6;
    const show = (d: import("../core/writer.ts").Draft) => {
      const row = (label: string, v: string) => v ? `<div class="sg" style="margin:6px 0"><div class="t"><b>${label}</b><div style="white-space:pre-wrap">${esc(v)}</div></div><button class="ib" data-copy="${esc(v)}">Copier</button></div>` : "";
      const all = [d.titles[0], "", d.description, "", d.hashtags.join(" ")].filter((x) => x != null).join("\n").trim();
      st.textContent = d.by === "ia" ? "Rédigé par Gemini Nano, sur votre téléphone." : "Version simple (l’IA de Google n’est pas disponible sur cet appareil).";
      res.innerHTML = d.titles.map((t, i) => row(`Titre ${i + 1}`, t)).join("") + row("Description", d.description) + row("Hashtags", d.hashtags.join(" "))
        + row("Accroche (à dire en premier)", d.hook)
        + `<div class="row" style="padding:6px 0 0"><button class="ib go" data-copy="${esc(all)}">Copier titre + description + hashtags</button>${N.isNative() ? `<button class="ib" data-x="share" data-v="${esc(all)}">Partager</button>` : ""}</div>`;
      m.querySelector<HTMLElement>("[data-x=again]")!.hidden = d.by !== "ia";
    };
    const run = async () => {
      if (N.isNative()) try {
        let s = (await N.Writer.status()).status;
        if (s === 1 || s === 2) { st.textContent = "Préparation de l’IA de Google (une seule fois)…"; const h = await N.Writer.addListener("progress", (e: any) => (st.textContent = `Téléchargement de l’IA : ${Math.round(e.p * 100)} %`)); try { await N.Writer.download(); s = 3; } finally { h.remove(); } }
        if (s === 3) { st.textContent = "Rédaction par Gemini Nano…"; const r = await N.Writer.generate({ prompt: W.buildPrompt(text), temperature: temp, maxTokens: 300 }); const d = W.parseDraft(r.text || ""); if (d) return show(d); }
      } catch (e: any) { console.warn("Gemini Nano", e?.message ?? e); }
      show(W.localDraft(text));
    };
    m.addEventListener("click", async (e) => {
      const t = e.target as HTMLElement, c = t.closest<HTMLElement>("[data-copy]"), x = t.closest<HTMLElement>("[data-x]")?.dataset.x;
      if (c) { try { await navigator.clipboard.writeText(c.dataset.copy!); toast("Copié.", 1200); } catch { toast("Copie impossible.", 2000); } }
      else if (x === "ok") m.remove();
      else if (x === "again") { temp = Math.min(1, temp + 0.2); res.innerHTML = ""; run(); }
      else if (x === "share") N.shareCaption(t.closest<HTMLElement>("[data-x]")!.dataset.v!).catch(() => {});
    });
    run();
  }
  async function voiceAB() {
    video.pause();
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<div class="card"><b>Voix studio</b><p data-r="vs">Préparation de l’extrait…</p>
      <div class="row" style="padding:0"><button class="ib" data-x="a" disabled>▶ Avant</button><button class="ib go" data-x="b" disabled>▶ Voix studio</button></div>
      <label class="opt"><input type="checkbox" data-x="on" ${voice ? "checked" : ""}> Appliquer à l’export</label>
      <div class="row" style="padding:0"><button class="ib" data-x="ok">Fermer</button></div></div>`;
    root.appendChild(m);
    const info = m.querySelector<HTMLElement>("[data-r=vs]")!; let ctx: AudioContext | null = null, node: AudioBufferSourceNode | null = null;
    const close = () => { node?.stop(); ctx?.close(); m.remove(); };
    m.querySelector<HTMLElement>("[data-x=ok]")!.onclick = close;
    m.querySelector<HTMLInputElement>("[data-x=on]")!.onchange = (e) => { voice = (e.target as HTMLInputElement).checked; save(); };
    try {
      const start = Math.max(0, Math.min(video.currentTime, duration - 6)), { pcm, sr } = await extractClip(o.file, start, 6);
      const v = new StudioVoice(sr, await loadDenoiser()), y = new Float32Array(pcm.length); let k = 0;
      for (const part of [v.process(pcm), v.flush()]) { y.set(part.subarray(0, y.length - k), k); k += part.length; }
      ctx = new AudioContext({ sampleRate: sr });
      const buf = (x: Float32Array) => { const b = ctx!.createBuffer(1, x.length, sr); b.getChannelData(0).set(x); return b; };
      const A = buf(pcm), B = buf(y);
      const play = (b: AudioBuffer) => { node?.stop(); node = ctx!.createBufferSource(); node.buffer = b; node.connect(ctx!.destination); node.start(); };
      m.querySelector<HTMLButtonElement>("[data-x=a]")!.onclick = () => play(A);
      m.querySelector<HTMLButtonElement>("[data-x=b]")!.onclick = () => play(B);
      m.querySelectorAll<HTMLButtonElement>("[data-x=a],[data-x=b]").forEach((b) => (b.disabled = false));
      info.textContent = `Extrait de ${fmt(start)} à ${fmt(start + 6)}. Écoutez au casque : bruit de fond retiré, voix plus nette et régulière.${v.denoising ? "" : " (Débruitage disponible seulement à 48 kHz : égaliseur et compresseur appliqués.)"}`;
    } catch (e: any) { info.textContent = "Écoute impossible : " + (e?.message ?? e); }
  }

  /* ---------- Export ---------- */
  /** Options d'export (mémorisées), puis lancement. */
  function doExport() {
    video.pause();
    const m = document.createElement("div"); m.className = "modal";
    const cc = !words ? "aucun (pas de transcription)" : style.preset === "none" ? "désactivés" : PRESETS[style.preset] + (capLang === "en" ? (enWords ? " · anglais" : " · anglais (traduction pas prête : français)") : "");
    m.innerHTML = `<div class="card"><b>Exporter le montage</b><p>${fmt(session.editedDuration)} · ${session.cuts.length} coupe(s)</p>
      <div class="opt">Sous-titres : ${esc(cc)} ${words ? `<button class="ib" data-x="cc">Modifier</button>` : ""}</div>
      <label class="opt"><input type="checkbox" data-x="zooms" ${zooms ? "checked" : ""}> Zooms dynamiques (à chaque coupe et fin de phrase)</label>
      <label class="opt"><input type="checkbox" data-x="voice" ${voice ? "checked" : ""}> Voix studio (bruit, écho, voix plus claire)</label>
      <label class="opt"><input type="checkbox" data-x="norm" ${norm ? "checked" : ""}> Volume optimisé pour les réseaux (≈ −14 LUFS)</label>
      <label class="opt"><input type="checkbox" data-x="q720" ${q720 ? "checked" : ""}> 720p (fichier ~2× plus léger)</label>
      <div class="row" style="padding:0"><button class="ib go" data-x="run">Exporter</button><button class="ib" data-x="no">Annuler</button></div></div>`;
    root.appendChild(m);
    m.querySelector<HTMLElement>("[data-x=no]")!.onclick = () => m.remove();
    const ccb = m.querySelector<HTMLElement>("[data-x=cc]"); if (ccb) ccb.onclick = () => { m.remove(); tab = "cc"; body.innerHTML = ""; refresh(); };
    m.querySelector<HTMLElement>("[data-x=run]")!.onclick = () => {
      norm = m.querySelector<HTMLInputElement>("[data-x=norm]")!.checked; voice = m.querySelector<HTMLInputElement>("[data-x=voice]")!.checked; zooms = m.querySelector<HTMLInputElement>("[data-x=zooms]")!.checked; q720 = m.querySelector<HTMLInputElement>("[data-x=q720]")!.checked; save(); m.remove(); runExport();
    };
  }
  async function runExport(auto = false) {
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<div class="card"><b>Export</b><div class="bar"><i></i></div><p data-r="ep">Préparation…</p>
      <div class="row" style="padding:0"><button class="ib" data-x="cancel">Annuler</button></div></div>`;
    root.appendChild(m);
    const ac = new AbortController(), bar = m.querySelector<HTMLElement>(".bar i")!, ep = m.querySelector<HTMLElement>("[data-r=ep]")!;
    m.querySelector<HTMLElement>("[data-x=cancel]")!.onclick = () => { ac.abort(); m.remove(); };
    const t0 = performance.now(), onProgress = (p: number) => { bar.style.width = Math.round(p * 100) + "%"; ep.textContent = `${Math.round(p * 100)} %`; };
    try {
      let blob: Blob, ext: string, how: string;
      try {
        if (!webCodecsAvailable()) throw new Error("WebCodecs indisponible");
        let gain = 1; if (norm) { await audioP; if (pcm) gain = loudnessGain(pcm, 16000, session.kept); }
        const captions = words && style.preset !== "none" ? { lines, style } : null;
        const r = await exportEdited(o.file, session.cuts, { onProgress, signal: ac.signal, gain, captions, maxHeight: q720 ? 1280 : 0, voice, zoom: zooms ? zoomAt : null,
          dress: overlays.length || titles.length ? { overlays, titles, images: new Map([...ovSrc].filter(([, e]) => e.img).map(([id, e]) => [id, e.img!])), videos: new Map([...ovSrc].filter(([, e]) => !e.img).map(([id, e]) => [id, e.blob])) } : null }); blob = r.blob; ext = r.ext; how = `${r.video.toUpperCase()}${r.audio ? " + " + r.audio.toUpperCase() : ""}`;
      } catch (e: any) {
        if (e?.name === "AbortError") throw e;
        console.warn("Export rapide impossible, repli temps réel", e); ep.textContent = "Export en temps réel (plus lent)…";
        blob = await exportRealtime(video, duration, session.cuts, onProgress, ac.signal); ext = blob.type.includes("mp4") ? "mp4" : "webm";
        how = "temps réel" + (words && style.preset !== "none" ? " · sans sous-titres (navigateur non compatible)" : "");
      }
      const name = `green-studio-montage-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${ext}`, href = URL.createObjectURL(blob);
      const file = new File([blob], name, { type: blob.type });
      const canShare = !!navigator.canShare?.({ files: [file] });
      m.querySelector(".card")!.innerHTML = `<b>Export terminé ✓</b><p>${(blob.size / 1e6).toFixed(1)} Mo · ${fmt(session.editedDuration)} · ${how} · ${((performance.now() - t0) / 1000).toFixed(1)} s</p>
        <div class="row" style="padding:0">${o.save ? `<button class="ib go" data-x="save">Enregistrer dans la Galerie</button>` : `<a class="ib go" href="${href}" download="${name}">Télécharger</a>`}${o.share || canShare ? `<button class="ib" data-x="share">Partager…</button>` : ""}<button class="ib" data-x="ok">Fermer</button></div>`;
      m.querySelector<HTMLElement>("[data-x=ok]")!.onclick = () => { URL.revokeObjectURL(href); m.remove(); };
      const sh = m.querySelector<HTMLElement>("[data-x=share]");
      if (sh) sh.onclick = () => (o.share ? o.share(blob, name) : navigator.share({ files: [file], title: "Green Studio" })).catch((e: any) => toast("Partage impossible : " + (e?.message ?? e), 5000));
      const sv = m.querySelector<HTMLButtonElement>("[data-x=save]");
      if (sv) sv.onclick = () => { sv.disabled = true; o.save!(blob, name).then(() => (sv.textContent = "✓ Enregistrée")).catch((e: any) => { sv.disabled = false; toast("Échec de l’enregistrement : " + (e?.message ?? e), 6000); }); };
      if (auto) { // express : enregistrée tout de suite, il ne reste qu'à partager
        if (sv) sv.click(); else m.querySelector<HTMLAnchorElement>("a[download]")?.click();
        m.querySelector(".card b")!.textContent = "⚡ Vidéo prête ✓";
      }
    } catch (e: any) {
      if (e?.name === "AbortError") { toast("Export annulé.", 2000); return; }
      m.querySelector(".card")!.innerHTML = `<b>Export impossible</b><p class="error">${esc(e?.message ?? String(e))}</p><button class="ib" data-x="ok">Fermer</button>`;
      m.querySelector<HTMLElement>("[data-x=ok]")!.onclick = () => m.remove();
    }
  }

  /* ---------- Actions ---------- */
  const commit = () => { save(); refresh(); };
  function close() {
    closed = true; ctl.abort(); cancelAnimationFrame(raf); worker?.terminate(); trWorker?.terminate();
    for (const e of ovSrc.values()) { e.img?.close(); if (e.vid) { e.vid.pause(); URL.revokeObjectURL(e.vid.src); } } for (const v of [video, spare]) { v.pause(); v.removeAttribute("src"); v.load(); }
    URL.revokeObjectURL(url); removeEventListener("keydown", onKey); root.remove(); o.onClose?.();
  }
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement, a = t.closest<HTMLElement>("[data-a]")?.dataset.a, tb = t.closest<HTMLElement>("[data-tab]")?.dataset.tab;
    if (tb) { tab = tb as typeof tab; body.innerHTML = ""; refresh(); body.scrollTop = 0; return; }
    const wi = t.closest<HTMLElement>(".tx span")?.dataset.i;
    if (wi != null && words) {
      const i = +wi;
      if (!sel) sel = { anchor: i, a: i, b: i };
      else if (sel.a === sel.b && sel.a === i) sel = null;
      else sel = { anchor: sel.anchor, a: Math.min(sel.anchor, i), b: Math.max(sel.anchor, i) };
      if (sel) seek(words[i].start); follow = true; refresh(); return;
    }
    const sid = t.closest<HTMLElement>("[data-s]")?.dataset.s, sg = sid ? sugs.find((s) => s.id === sid) : undefined;
    switch (a) {
      case "close": close(); break;
      case "undo": if (session.undo()) commit(); break;
      case "redo": if (session.redo()) commit(); break;
      case "export": doExport(); break;
      case "play": if (video.paused) { stopAt = null; follow = true; if (video.currentTime >= duration - 0.05) video.currentTime = 0; video.play().catch(() => {}); } else video.pause(); break;
      case "zin": case "zout": case "fit": case "split": case "del": case "rest": derush(a); break;
      case "transcribe": transcribe(); break;
      case "preset": style = { ...style, preset: t.closest<HTMLElement>("[data-v]")!.dataset.v as CaptionPreset }; save();
        root.querySelectorAll<HTMLElement>("[data-a=preset]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === style.preset))); break;
      case "fixSel": if (sel && words && sel.a === sel.b) { const v = prompt("Corriger le mot :", words[sel.a].text)?.trim();
        if (v) { words[sel.a] = { ...words[sel.a], text: v }; const sp = body.querySelector<HTMLElement>(`.tx span[data-i="${sel.a}"]`); if (sp) sp.textContent = v; sugs = suggest(words); sel = null; commit(); } } break;
      case "trim": trimEdges(); break;
      case "voiceAB": voiceAB(); break;
      case "pub": publishText(); break;
      case "zooms": zooms = (t as HTMLInputElement).checked; save(); break;
      case "lang": capLang = t.closest<HTMLElement>("[data-v]")!.dataset.v as "fr" | "en"; save(); body.innerHTML = ""; refresh(); if (capLang === "en" && !enWords) translateEN(); break;
      case "retr": enWords = null; save(); body.innerHTML = ""; refresh(); translateEN(); break;
      case "rhythm": { const v = t.closest<HTMLElement>("[data-v]")!.dataset.v!; try { localStorage.setItem("gs.rhythm", v); } catch { /* */ } if (words) sugs = suggest(words); body.innerHTML = ""; refresh();
        toast(`Rythme ${RHYTHM[v as Rhythm].label} : touchez « Tout supprimer » pour l’appliquer.`, 2500); break; }
      case "ticAdd": { const v = prompt("Votre tic (ex. « tu vois », « en mode ») :")?.trim().toLowerCase(); if (!v) break; setTics([...new Set([...myTics(), v])]); retic(); break; }
      case "ticDel": { const v = t.closest<HTMLElement>("[data-v]")!.dataset.v!; setTics(myTics().filter((x) => x !== v)); retic(); break; }
      case "tplSave": { const name = prompt("Nom du modèle (ex. « Mon émission ») :", "Mon émission")?.trim(); if (!name) break;
        const intro = titles.find((x) => x.start < 1.5); const l = loadTpls().filter((x) => x.name !== name);
        const tp: Template = { id: "t" + Date.now().toString(36), name, rhythm: myRhythm(), lang: capLang, style, zooms, voice, norm, q720, intro: intro ? { text: intro.text, sub: intro.sub } : undefined };
        l.push(tp); saveTpls(l); if (!autoTplId()) try { localStorage.setItem("gs.tplAuto", tp.id); } catch { /* */ }
        toast(`Modèle « ${name} » enregistré${intro ? " (avec bandeau d’ouverture)" : ""}.`, 2500); body.innerHTML = ""; renderCC(); break; }
      case "tplUse": { const tp = loadTpls().find((x) => x.id === t.closest<HTMLElement>("[data-v]")?.dataset.v); if (!tp) break;
        applyTpl(tp); commit(); body.innerHTML = ""; renderCC(); toast(`Modèle « ${tp.name} » appliqué.`, 2000); break; }
      case "tplDel": { const l = loadTpls(); const name = prompt("Nom du modèle à supprimer :\n" + l.map((x) => "• " + x.name).join("\n"))?.trim(); if (!name) break;
        const r = l.filter((x) => x.name !== name); if (r.length === l.length) { toast("Aucun modèle de ce nom.", 2000); break; }
        saveTpls(r); body.innerHTML = ""; renderCC(); break; }
      case "ins": q<HTMLInputElement>("[data-r=ovFile]").click(); break;
      case "title": addTitle(); break;
      case "omode": case "ominus": case "oplus": case "ohere": case "odel": {
        const id = t.closest<HTMLElement>("[data-o]")?.dataset.o, ov = overlays.find((x) => x.id === id); if (!ov) break;
        if (a === "omode") ov.mode = t.closest<HTMLElement>("[data-v]")!.dataset.v as OverlayMode;
        if (a === "ominus") ov.end = Math.max(ov.start + 0.5, ov.end - 0.5);
        if (a === "oplus") ov.end = Math.min(duration, ov.end + 0.5);
        if (a === "ohere") { const d = ov.end - ov.start; ov.start = video.currentTime; ov.end = Math.min(duration, ov.start + d); }
        if (a === "odel") overlays = overlays.filter((x) => x !== ov);
        body.innerHTML = ""; commit(); break; }
      case "tminus": case "tplus": case "there": case "tdel": {
        const id = t.closest<HTMLElement>("[data-ti]")?.dataset.ti, ti = titles.find((x) => x.id === id); if (!ti) break;
        if (a === "tminus") ti.end = Math.max(ti.start + 1, ti.end - 0.5);
        if (a === "tplus") ti.end = Math.min(duration, ti.end + 0.5);
        if (a === "there") { const d = ti.end - ti.start; ti.start = video.currentTime; ti.end = Math.min(duration, ti.start + d); }
        if (a === "tdel") titles = titles.filter((x) => x !== ti);
        body.innerHTML = ""; commit(); break; }
      case "retx": if (confirm("Refaire la transcription ? Vos coupes sont conservées.")) { words = null; sugs = []; sel = null; body.innerHTML = ""; refresh(); } break;
      case "cutSel": if (sel && words) { session.addCut(wordsToRange(words, sel.a, sel.b)); sel = null; commit(); } break;
      case "keepSel": if (sel && words) { session.restore({ start: sel.a > 0 ? words[sel.a - 1].end : 0, end: sel.b < words.length - 1 ? words[sel.b + 1].start : duration }); sel = null; commit(); } break;
      case "hearSel": if (sel && words) playRange(words[sel.a].start - 0.3, words[sel.b].end + 0.3); break;
      case "clearSel": sel = null; refresh(); break;
      case "cut": if (sg) { session.addCut(sg.range); commit(); } break;
      case "keep": if (sg) { session.restore(sg.range); commit(); } break;
      case "ign": if (sg) { ignored.has(sg.id) ? ignored.delete(sg.id) : ignored.add(sg.id); commit(); } break;
      case "hear": if (sg) playRange(sg.range.start - 1, sg.range.end + 1); break;
      case "safe": { const r = sugs.filter((s) => !ignored.has(s.id) && !covered(s.range) && s.confidence >= SAFE).map((s) => s.range); if (r.length) { session.addCuts(r); commit(); toast(`${r.length} coupe(s) appliquée(s). ↶ pour annuler.`, 3000); } break; }
      case "clean": cleanAll(); break;
      case "take": bestTake(); break;
      case "verbPref": { const c = (t as HTMLInputElement).checked; try { localStorage.setItem("gs.verbatim", c ? "1" : "0"); } catch { /* */ } break; }
      case "autoPref": { const c = (t as HTMLInputElement).checked; try { localStorage.setItem("gs.autoClean", c ? "1" : "0"); } catch { /* */ } break; }
      case "sil": { const r = sugs.filter((s) => s.type === "long_silence" && !ignored.has(s.id) && !covered(s.range)).map((s) => s.range); if (r.length) { session.addCuts(r); commit(); } break; }
    }
  });
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input,select,textarea")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === " ") { e.preventDefault(); q("[data-a=play]").click(); }
    else if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey ? session.redo() : session.undo()) commit(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); q<HTMLElement>("[data-a=cutSel]")?.click(); }
    else if (e.key === "Escape") { if (sel) { sel = null; refresh(); } else close(); }
  };
  addEventListener("keydown", onKey);

  refresh(); raf = requestAnimationFrame(tick);
  if (o.autoClean || o.express) { if (words) (o.express ? cleanAll().then(() => runExport(true)) : cleanAll()); else setTimeout(() => body.querySelector<HTMLElement>("[data-a=transcribe]")?.click(), 50); }
  return { close, session, get words() { return words; } };
}
