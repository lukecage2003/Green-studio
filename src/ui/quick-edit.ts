/** Quick Edit : montage par le texte. Lecteur qui saute les coupes, forme d'onde + timeline, transcription cliquable,
 *  suggestions (répétitions, hésitations, silences…), annuler/rétablir, export. Tout reste sur l'appareil. */
import { EditSession, wordsToRange, EPS, type Range, type Word } from "../core/timeline.ts";
import { analyze, analyzeAudio, type Suggestion, type IssueType } from "../core/speech-analysis.ts";
import { peaks as computePeaks, loudnessGain, speechBounds } from "../core/audio.ts";
import { buildCaptions, drawCaption, lineAt, CAPTION_DEFAULT, PRESETS, type CapLine, type CaptionStyle, type CaptionPreset } from "../core/captions.ts";
import { probe, extractAudio, exportEdited, webCodecsAvailable } from "../core/media.ts";
import { exportRealtime } from "../core/export.ts";

const LABEL: Record<IssueType, string> = { repetition: "Répétition", stutter: "Bégaiement", false_start: "Faux départ", hesitation: "Hésitation", long_silence: "Silence long", untranscribed: "Bégaiement / son non transcrit" };
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
.qe canvas.wave{width:100%;height:56px;display:block;border-radius:10px;background:#1c1c1e;touch-action:none}
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
`;

interface Saved { v: 1; duration: number; words: Word[] | null; cuts: Range[]; ignored: string[]; peaks?: number[]; style?: CaptionStyle; norm?: boolean; q720?: boolean }

export interface EditorOptions {
  file: Blob; key: string; name?: string; onClose?: () => void; toast?: (m: string, ms?: number) => void;
  /** App Android : enregistrer dans la Galerie / partager (sinon : lien de téléchargement et partage web). */
  save?: (b: Blob, name: string) => Promise<void>; share?: (b: Blob, name: string) => Promise<void>;
  /** Nettoyage en un geste : transcrire si besoin, puis supprimer tous les défauts détectés. */
  autoClean?: boolean;
}
/** Seuil de confiance du nettoyage automatique (les suggestions plus incertaines restent proposées). */
const AUTO_MIN = 0.5;
const autoPref = () => { try { return localStorage.getItem("gs.autoClean") !== "0"; } catch { return true; } };

export async function openEditor(o: EditorOptions) {
  if (!document.getElementById("qe-css")) { const st = document.createElement("style"); st.id = "qe-css"; st.textContent = CSS; document.head.appendChild(st); }
  const toast = o.toast ?? ((m: string) => console.log(m));
  const root = document.createElement("section"); root.className = "qe"; root.setAttribute("aria-label", "Montage");
  root.innerHTML = `
    <header><button data-a="close">Fermer</button><h2>Montage</h2><button data-a="export">Exporter</button></header>
    <div class="vw"><video playsinline preload="auto"></video><video class="spare" playsinline preload="auto" muted></video><canvas class="cc" aria-hidden="true"></canvas></div>
    <div class="tl"><canvas class="wave" aria-label="Timeline : touchez pour vous déplacer"></canvas></div>
    <div class="transport"><button class="ib round go" data-a="play" aria-label="Lecture">▶</button><span data-r="time">0:00</span><span class="sp"></span>
      <button class="ib icon" data-a="undo" aria-label="Annuler">↶</button><button class="ib icon" data-a="redo" aria-label="Rétablir">↷</button></div>
    <div class="tools">
      <button class="ib" data-a="trim" title="Couper le silence avant la première et après la dernière parole">✂ Bords muets</button>
      <button class="ib" data-a="in" title="Marquer le début d'une coupe à la tête de lecture">⟦ Début</button><button class="ib" data-a="out" disabled>Couper ⟧</button>
      <label>Sauter les coupes <input type="checkbox" data-a="pv" checked></label></div>
    <div class="row" data-r="status"></div>
    <div class="tabs" role="tablist"><button role="tab" data-tab="tx" aria-selected="true">Texte</button><button role="tab" data-tab="sg" aria-selected="false">Suggestions</button><button role="tab" data-tab="cc" aria-selected="false">Sous-titres</button></div>
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
  let words: Word[] | null = saved?.words ?? null, sugs: Suggestion[] = words ? analyze(words) : [];
  /** Suggestions du texte + du son (bégaiements et hésitations que Whisper n'a pas écrits). */
  const suggest = (w: Word[]) => { const t = analyze(w); return pcm ? [...t, ...analyzeAudio(w, pcm, 16000, t)].sort((a, b) => a.range.start - b.range.start) : t; };
  const ignored = new Set(saved?.ignored ?? []);
  let pk: Float32Array | null = saved?.peaks ? Float32Array.from(saved.peaks, (x) => x / 255) : null;
  let pcm: Float32Array | null = null, audioErr = "";
  let style: CaptionStyle = { ...CAPTION_DEFAULT, ...(saved?.style ?? {}) }, norm = saved?.norm ?? true, q720 = saved?.q720 ?? false, lines: CapLine[] = [];
  let tab: "tx" | "sg" | "cc" = "tx", sel: { anchor: number; a: number; b: number } | null = null, inPt: number | null = null, stopAt: number | null = null;
  let worker: Worker | null = null, raf = 0, closed = false, curWord = -1, follow = true;
  const ctl = new AbortController();

  const save = () => {
    const s: Saved = { v: 1, duration, words, cuts: session.cuts, ignored: [...ignored], style, norm, q720, peaks: pk ? Array.from(pk, (x) => Math.round(x * 255)) : undefined };
    try { localStorage.setItem(storeKey, JSON.stringify(s)); } catch { /* quota localStorage : on garde en mémoire */ }
  };
  const covered = (r: Range) => session.cuts.some((c) => c.start <= r.start + 0.02 && c.end >= r.end - 0.02);
  const inCut = (t: number) => session.cuts.find((c) => t >= c.start - EPS && t < c.end - 0.01);

  /* ---------- Audio : forme d'onde + PCM pour la transcription (lecture par morceaux, pas de chargement complet) ---------- */
  const audioP = extractAudio(o.file, 16000, (p) => { if (!pk) setStatus(`Analyse audio… ${Math.round(p * 100)} %`); }, ctl.signal)
    .then((a) => { pcm = a.pcm; if (words) sugs = suggest(words); if (!pk) { pk = computePeaks(a.pcm, 1200); let m = 0; for (const v of pk) m = Math.max(m, v); if (m > 0) for (let i = 0; i < pk.length; i++) pk[i] /= m; save(); } refresh(); })
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
    lines = words ? buildCaptions(words, session.cuts) : [];
    if (tab === "tx") renderText(); else if (tab === "sg") renderSugs(); else renderCC();
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

  function renderSugs() {
    if (!words) { body.innerHTML = `<div class="card"><p>Les suggestions apparaissent après la transcription (onglet Texte).</p></div>`; return; }
    if (!sugs.length) { body.innerHTML = `<div class="card"><p>Aucune répétition, hésitation ni silence long détecté. 👌</p></div>`; return; }
    const open = sugs.filter((s) => !ignored.has(s.id) && !covered(s.range));
    const all = open.filter((s) => s.confidence >= AUTO_MIN).length, sil = open.filter((s) => s.type === "long_silence").length;
    body.innerHTML = `<div class="row" style="padding:0 0 8px"><button class="ib go" data-a="clean" ${all ? "" : "disabled"}>✨ Tout supprimer (${all})</button>
      <button class="ib" data-a="sil" ${sil ? "" : "disabled"}>Couper les silences (${sil})</button></div>` +
      sugs.map((s) => { const on = covered(s.range), ign = ignored.has(s.id);
        return `<div class="sg ${on ? "on" : ""} ${ign ? "ign" : ""}" data-s="${esc(s.id)}"><div class="t"><b>${LABEL[s.type]} · ${Math.round(s.confidence * 100)} %${on ? " · coupé" : ""}</b>
          <div data-a="hear" title="Écouter">▶ ${esc(s.excerpt)}</div></div>
          <button class="ib" data-a="${on ? "keep" : "cut"}">${on ? "↺ Garder" : "✂ Couper"}</button>
          <button class="ib" data-a="ign" aria-label="${ign ? "Rétablir la suggestion" : "Ignorer"}">${ign ? "↩" : "✕"}</button></div>`; }).join("");
  }

  function renderCC() {
    if (!words) { body.innerHTML = `<div class="card"><p>Les sous-titres sont générés à partir de la transcription (onglet Texte).</p></div>`; return; }
    if (body.querySelector("[data-cc]")) return; // déjà affiché : on ne casse pas le curseur en cours de glissement
    body.innerHTML = `<div class="card" data-cc><b>Sous-titres incrustés</b><p>Aperçu en direct sur la vidéo. Ils sont gravés dans l’export (visibles partout, même son coupé).</p>
      <div class="chips">${(Object.keys(PRESETS) as CaptionPreset[]).map((k) => `<button class="ib" data-a="preset" data-v="${k}" aria-pressed="${style.preset === k}">${PRESETS[k]}</button>`).join("")}</div>
      <label class="opt">Haut <input type="range" data-a="pos" min="0.12" max="0.88" step="0.01" value="${style.pos}"> Bas</label>
      <label class="opt"><input type="checkbox" data-a="upper" ${style.upper ? "checked" : ""}> MAJUSCULES</label>
      <label class="opt">Couleur du mot actif <input type="color" data-a="color" value="${style.color}"></label>
      <p>Un mot mal transcrit ? Onglet Texte : touchez-le, puis ✎.</p></div>`;
  }
  const setStyle = (p: Partial<CaptionStyle>) => { style = { ...style, ...p }; save(); };
  body.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement, a = t.dataset.a;
    if (a === "pos") setStyle({ pos: +t.value }); else if (a === "upper") setStyle({ upper: t.checked }); else if (a === "color") setStyle({ color: t.value });
  });

  /** Sous-titres en surimpression sur le lecteur (même rendu que l'export). */
  function drawCC() {
    const dpr = devicePixelRatio || 1, bw = ccv.clientWidth, bh = ccv.clientHeight;
    if (ccv.width !== Math.round(bw * dpr) || ccv.height !== Math.round(bh * dpr)) { ccv.width = Math.round(bw * dpr); ccv.height = Math.round(bh * dpr); }
    const g = ccv.getContext("2d")!; g.clearRect(0, 0, ccv.width, ccv.height);
    if (!lines.length || style.preset === "none" || !video.videoWidth) return;
    const k = Math.min(bw / video.videoWidth, bh / video.videoHeight), w = video.videoWidth * k * dpr, h = video.videoHeight * k * dpr;
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

  /* ---------- Timeline ---------- */
  function draw() {
    const dpr = devicePixelRatio || 1, W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext("2d")!, X = (t: number) => (t / (duration || 1)) * W;
    g.clearRect(0, 0, W, H);
    if (pk) { g.fillStyle = "#4f6b5c"; const bw = W / pk.length;
      for (let i = 0; i < pk.length; i++) { const h = Math.max(1, pk[i] * (H - 8)); g.fillRect(i * bw, (H - h) / 2, Math.max(1, bw - 0.5), h); } }
    else { g.fillStyle = "#24332b"; g.fillRect(0, H / 2 - 1, W, 2); }
    g.fillStyle = "rgba(255,80,80,.45)"; for (const c of session.cuts) g.fillRect(X(c.start), 0, Math.max(1, X(c.end) - X(c.start)), H);
    g.fillStyle = "#e8c547"; for (const s of sugs) if (!ignored.has(s.id) && !covered(s.range)) g.fillRect(X(s.range.start), H - 4 * dpr, Math.max(2, X(s.range.end) - X(s.range.start)), 4 * dpr);
    if (inPt != null) { g.fillStyle = "#34e08b"; g.fillRect(X(inPt) - dpr, 0, 2 * dpr, H); }
    g.fillStyle = "#fff"; g.fillRect(X(video.currentTime) - dpr, 0, 2 * dpr, H);
  }
  const seekX = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * duration); };
  cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); seekX(e); cv.onpointermove = seekX; };
  cv.onpointerup = cv.onpointercancel = () => (cv.onpointermove = null);

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
        worker?.terminate(); worker = null; words = d.words; sugs = suggest(words!); sel = null; save();
        body.innerHTML = ""; refresh();
        if (o.autoClean || autoPref()) cleanAll(); // nettoyage automatique (option, activée par défaut)
        else toast(`Transcrit en ${fmt((performance.now() - t0) / 1000)} · ${sugs.length} suggestion(s).`, 4000);
      } else if (d.type === "error") {
        worker?.terminate(); worker = null; if (btn) btn.disabled = false;
        const net = /fetch|network|load/i.test(d.message);
        show(0, net ? "Impossible de télécharger le modèle de transcription. Vérifiez la connexion (nécessaire une seule fois), puis réessayez."
          : "Échec de la transcription : " + d.message);
      }
    };
    const copy = pcm.slice(); worker.postMessage({ type: "run", audio: copy, language: "fr", model }, [copy.buffer]);
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
  async function cleanAll() {
    await audioP; if (words) sugs = suggest(words);
    const r = sugs.filter((s) => !ignored.has(s.id) && !covered(s.range) && s.confidence >= AUTO_MIN).map((s) => s.range);
    r.push(...((await edgeCuts()) ?? []));
    if (!r.length) { refresh(); return toast("Aucun défaut à supprimer. 👌", 3000); }
    const before = session.editedDuration; session.addCuts(r); commit();
    toast(`✨ ${r.length} défaut(s) supprimé(s) (−${(before - session.editedDuration).toFixed(1)} s). ↶ pour annuler.`, 5000);
  }

  /* ---------- Export ---------- */
  /** Options d'export (mémorisées), puis lancement. */
  function doExport() {
    video.pause();
    const m = document.createElement("div"); m.className = "modal";
    const cc = !words ? "aucun (pas de transcription)" : style.preset === "none" ? "désactivés" : PRESETS[style.preset];
    m.innerHTML = `<div class="card"><b>Exporter le montage</b><p>${fmt(session.editedDuration)} · ${session.cuts.length} coupe(s)</p>
      <div class="opt">Sous-titres : ${esc(cc)} ${words ? `<button class="ib" data-x="cc">Modifier</button>` : ""}</div>
      <label class="opt"><input type="checkbox" data-x="norm" ${norm ? "checked" : ""}> Volume optimisé pour les réseaux (≈ −14 LUFS)</label>
      <label class="opt"><input type="checkbox" data-x="q720" ${q720 ? "checked" : ""}> 720p (fichier ~2× plus léger)</label>
      <div class="row" style="padding:0"><button class="ib go" data-x="run">Exporter</button><button class="ib" data-x="no">Annuler</button></div></div>`;
    root.appendChild(m);
    m.querySelector<HTMLElement>("[data-x=no]")!.onclick = () => m.remove();
    const ccb = m.querySelector<HTMLElement>("[data-x=cc]"); if (ccb) ccb.onclick = () => { m.remove(); tab = "cc"; body.innerHTML = ""; refresh(); };
    m.querySelector<HTMLElement>("[data-x=run]")!.onclick = () => {
      norm = m.querySelector<HTMLInputElement>("[data-x=norm]")!.checked; q720 = m.querySelector<HTMLInputElement>("[data-x=q720]")!.checked; save(); m.remove(); runExport();
    };
  }
  async function runExport() {
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
        const r = await exportEdited(o.file, session.cuts, { onProgress, signal: ac.signal, gain, captions, maxHeight: q720 ? 1280 : 0 }); blob = r.blob; ext = r.ext; how = `${r.video.toUpperCase()}${r.audio ? " + " + r.audio.toUpperCase() : ""}`;
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
    } catch (e: any) {
      if (e?.name === "AbortError") { toast("Export annulé.", 2000); return; }
      m.querySelector(".card")!.innerHTML = `<b>Export impossible</b><p class="error">${esc(e?.message ?? String(e))}</p><button class="ib" data-x="ok">Fermer</button>`;
      m.querySelector<HTMLElement>("[data-x=ok]")!.onclick = () => m.remove();
    }
  }

  /* ---------- Actions ---------- */
  const commit = () => { save(); refresh(); };
  function close() {
    closed = true; ctl.abort(); cancelAnimationFrame(raf); worker?.terminate(); for (const v of [video, spare]) { v.pause(); v.removeAttribute("src"); v.load(); }
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
      case "in": inPt = video.currentTime; (q("[data-a=out]") as HTMLButtonElement).disabled = false; toast("Début marqué. Avancez puis « Couper ⟧ ».", 2500); break;
      case "out": if (inPt != null) { const a2 = Math.min(inPt, video.currentTime), b2 = Math.max(inPt, video.currentTime);
        if (b2 - a2 > 0.05) { session.addCut({ start: a2, end: b2 }); commit(); } inPt = null; (q("[data-a=out]") as HTMLButtonElement).disabled = true; } break;
      case "transcribe": transcribe(); break;
      case "preset": style = { ...style, preset: t.closest<HTMLElement>("[data-v]")!.dataset.v as CaptionPreset }; save();
        root.querySelectorAll<HTMLElement>("[data-a=preset]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === style.preset))); break;
      case "fixSel": if (sel && words && sel.a === sel.b) { const v = prompt("Corriger le mot :", words[sel.a].text)?.trim();
        if (v) { words[sel.a] = { ...words[sel.a], text: v }; const sp = body.querySelector<HTMLElement>(`.tx span[data-i="${sel.a}"]`); if (sp) sp.textContent = v; sugs = suggest(words); sel = null; commit(); } } break;
      case "trim": trimEdges(); break;
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
  if (o.autoClean) { if (words) cleanAll(); else setTimeout(() => body.querySelector<HTMLElement>("[data-a=transcribe]")?.click(), 50); }
  return { close, session, get words() { return words; } };
}
