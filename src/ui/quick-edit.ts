/** Quick Edit : montage par le texte. Lecteur qui saute les coupes, forme d'onde + timeline, transcription cliquable,
 *  suggestions (répétitions, hésitations, silences…), annuler/rétablir, export. Tout reste sur l'appareil. */
import { EditSession, wordsToRange, EPS, type Range, type Word } from "../core/timeline.ts";
import { analyze, type Suggestion, type IssueType } from "../core/speech-analysis.ts";
import { peaks as computePeaks } from "../core/audio.ts";
import { probe, extractAudio, exportEdited, webCodecsAvailable } from "../core/media.ts";
import { exportRealtime } from "../core/export.ts";

const LABEL: Record<IssueType, string> = { repetition: "Répétition", stutter: "Bégaiement", false_start: "Faux départ", hesitation: "Hésitation", long_silence: "Silence long" };
const SAFE = 0.7;
const fmt = (t: number) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, "0")}`; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const CSS = `
.qe{position:fixed;inset:0;z-index:60;background:var(--bg);color:var(--fg);display:flex;flex-direction:column;padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}
.qe header{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--line)}
.qe header h2{flex:1;margin:0;font-size:16px}
.qe .ib{background:var(--glass);padding:8px 12px;border-radius:999px;font-size:13px}
.qe .ib:disabled{opacity:.35}
.qe .go{background:var(--accent);color:#04120a;font-weight:600}
.qe video{width:100%;max-height:34vh;background:#000;display:block;object-fit:contain}
.qe .tl{position:relative;padding:6px 10px 0}
.qe canvas{width:100%;height:64px;display:block;border-radius:8px;background:#0d1411;touch-action:none}
.qe .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 10px;font-size:12px;color:var(--muted)}
.qe .row .sp{flex:1}
.qe .tabs{display:flex;border-bottom:1px solid var(--line);padding:0 10px}
.qe .tabs button{flex:1;padding:10px;background:none;color:var(--muted);border-bottom:2px solid transparent;font-size:14px}
.qe .tabs button[aria-selected=true]{color:var(--fg);border-color:var(--accent)}
.qe .body{flex:1;overflow:auto;padding:12px 14px 90px;-webkit-overflow-scrolling:touch}
.qe .tx{font-size:17px;line-height:1.75}
.qe .tx span{border-radius:4px;padding:1px 1px;cursor:pointer}
.qe .tx span.cut{text-decoration:line-through;color:#6d7a72;background:rgba(255,90,90,.12)}
.qe .tx span.sug{box-shadow:inset 0 -2px 0 #e8c547}
.qe .tx span.sel{background:rgba(52,224,139,.35);color:#fff}
.qe .tx span.cur{outline:1.5px solid var(--accent)}
.qe .card{background:var(--glass);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}
.qe .card p{margin:0;color:var(--muted);font-size:13px}
.qe .bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden}.qe .bar i{display:block;height:100%;background:var(--accent);width:0}
.qe .sg{display:flex;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.qe .sg .t{flex:1;min-width:0}.qe .sg .t b{font-size:12px;color:#e8c547;font-weight:600}.qe .sg .t div{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.qe .sg.on .t b{color:#ff8080}.qe .sg.ign{opacity:.45}
.qe .selbar{position:absolute;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));background:#16211b;border:1px solid var(--accent);border-radius:16px;padding:8px;display:flex;gap:6px;align-items:center;box-shadow:0 8px 30px #000a}
.qe .selbar span{flex:1;font-size:12px;color:var(--muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.qe .modal{position:absolute;inset:0;background:#000b;display:flex;align-items:center;justify-content:center;padding:20px}
.qe .modal .card{width:100%;max-width:420px}
.qe a.ib{text-decoration:none;text-align:center}
.qe select{background:var(--glass);color:var(--fg);border:1px solid var(--line);border-radius:10px;padding:8px}
`;

interface Saved { v: 1; duration: number; words: Word[] | null; cuts: Range[]; ignored: string[]; peaks?: number[] }

export interface EditorOptions { file: Blob; key: string; name?: string; onClose?: () => void; toast?: (m: string, ms?: number) => void }

export async function openEditor(o: EditorOptions) {
  if (!document.getElementById("qe-css")) { const st = document.createElement("style"); st.id = "qe-css"; st.textContent = CSS; document.head.appendChild(st); }
  const toast = o.toast ?? ((m: string) => console.log(m));
  const root = document.createElement("section"); root.className = "qe"; root.setAttribute("aria-label", "Montage");
  root.innerHTML = `
    <header><button class="ib" data-a="close" aria-label="Fermer">←</button><h2>Montage</h2>
      <button class="ib" data-a="undo" aria-label="Annuler">↶</button><button class="ib" data-a="redo" aria-label="Rétablir">↷</button>
      <button class="ib go" data-a="export">Exporter</button></header>
    <video playsinline preload="auto"></video>
    <div class="tl"><canvas aria-label="Timeline : touchez pour vous déplacer"></canvas></div>
    <div class="row"><button class="ib" data-a="play">▶</button><span data-r="time">0:00</span><span class="sp"></span>
      <button class="ib" data-a="in" title="Marquer le début d'une coupe à la tête de lecture">⟦ Début</button><button class="ib" data-a="out" disabled>Couper ⟧</button>
      <label><input type="checkbox" data-a="pv" checked> Sauter les coupes</label></div>
    <div class="row" data-r="status"></div>
    <div class="tabs" role="tablist"><button role="tab" data-tab="tx" aria-selected="true">Texte</button><button role="tab" data-tab="sg" aria-selected="false">Suggestions</button></div>
    <div class="body" data-r="body"></div>`;
  document.body.appendChild(root);
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as unknown as T;
  const video = q<HTMLVideoElement>("video"), cv = q<HTMLCanvasElement>("canvas"), body = q("[data-r=body]");
  const url = URL.createObjectURL(o.file); video.src = url;

  /* ---------- État ---------- */
  const storeKey = "gs.qe." + o.key;
  let saved: Saved | null = null; try { saved = JSON.parse(localStorage.getItem(storeKey) || "null"); } catch { /* */ }
  let duration = saved?.duration ?? 0;
  try { duration = (await probe(o.file)).duration || duration; } catch { /* repli : métadonnées du lecteur */ }
  if (!duration || !isFinite(duration)) { await new Promise((r) => (video.onloadedmetadata = r)); duration = isFinite(video.duration) ? video.duration : 0; }
  const session = new EditSession(duration, saved?.cuts ?? []);
  let words: Word[] | null = saved?.words ?? null, sugs: Suggestion[] = words ? analyze(words) : [];
  const ignored = new Set(saved?.ignored ?? []);
  let pk: Float32Array | null = saved?.peaks ? Float32Array.from(saved.peaks, (x) => x / 255) : null;
  let pcm: Float32Array | null = null, audioErr = "";
  let tab: "tx" | "sg" = "tx", sel: { anchor: number; a: number; b: number } | null = null, inPt: number | null = null, stopAt: number | null = null;
  let worker: Worker | null = null, raf = 0, closed = false, curWord = -1, follow = true;
  const ctl = new AbortController();

  const save = () => {
    const s: Saved = { v: 1, duration, words, cuts: session.cuts, ignored: [...ignored], peaks: pk ? Array.from(pk, (x) => Math.round(x * 255)) : undefined };
    try { localStorage.setItem(storeKey, JSON.stringify(s)); } catch { /* quota localStorage : on garde en mémoire */ }
  };
  const covered = (r: Range) => session.cuts.some((c) => c.start <= r.start + 0.02 && c.end >= r.end - 0.02);
  const inCut = (t: number) => session.cuts.find((c) => t >= c.start - EPS && t < c.end - 0.01);

  /* ---------- Audio : forme d'onde + PCM pour la transcription (lecture par morceaux, pas de chargement complet) ---------- */
  const audioP = extractAudio(o.file, 16000, (p) => { if (!pk) setStatus(`Analyse audio… ${Math.round(p * 100)} %`); }, ctl.signal)
    .then((a) => { pcm = a.pcm; if (!pk) { pk = computePeaks(a.pcm, 1200); let m = 0; for (const v of pk) m = Math.max(m, v); if (m > 0) for (let i = 0; i < pk.length; i++) pk[i] /= m; save(); } refresh(); })
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
    if (tab === "tx") renderText(); else renderSugs();
    renderSel();
  }

  function renderText() {
    if (!words) {
      const can = !audioErr;
      body.innerHTML = `<div class="card"><b>Transcription sur l’appareil</b>
        <p>Whisper tourne dans le téléphone : rien n’est envoyé en ligne. Premier usage : téléchargement du modèle (~80 à 300 Mo selon le choix), ensuite hors ligne.</p>
        ${audioErr ? `<p class="error">${esc(audioErr)}</p>` : ""}
        <label class="row" style="padding:0">Qualité <select data-a="model"><option value="base">Précise (recommandée)</option><option value="tiny">Rapide</option></select></label>
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
    const safe = open.filter((s) => s.confidence >= SAFE).length, sil = open.filter((s) => s.type === "long_silence").length;
    body.innerHTML = `<div class="row" style="padding:0 0 8px"><button class="ib go" data-a="safe" ${safe ? "" : "disabled"}>Appliquer les sûres (${safe})</button>
      <button class="ib" data-a="sil" ${sil ? "" : "disabled"}>Couper les silences (${sil})</button></div>` +
      sugs.map((s) => { const on = covered(s.range), ign = ignored.has(s.id);
        return `<div class="sg ${on ? "on" : ""} ${ign ? "ign" : ""}" data-s="${esc(s.id)}"><div class="t"><b>${LABEL[s.type]} · ${Math.round(s.confidence * 100)} %${on ? " · coupé" : ""}</b>
          <div data-a="hear" title="Écouter">▶ ${esc(s.excerpt)}</div></div>
          <button class="ib" data-a="${on ? "keep" : "cut"}">${on ? "↺ Garder" : "✂ Couper"}</button>
          <button class="ib" data-a="ign" aria-label="${ign ? "Rétablir la suggestion" : "Ignorer"}">${ign ? "↩" : "✕"}</button></div>`; }).join("");
  }

  let selBar: HTMLElement | null = null;
  function renderSel() {
    if (!sel || !words || tab !== "tx") { selBar?.remove(); selBar = null; return; }
    if (!selBar) {
      selBar = document.createElement("div"); selBar.className = "selbar";
      selBar.innerHTML = `<span></span><button class="ib" data-a="hearSel">▶</button><button class="ib go" data-a="cutSel">✂ Couper</button><button class="ib" data-a="keepSel">↺ Garder</button><button class="ib" data-a="clearSel" aria-label="Désélectionner">✕</button>`;
      root.appendChild(selBar);
    }
    const n = sel.b - sel.a + 1, txt = words.slice(sel.a, sel.b + 1).map((w) => w.text).join(" ");
    selBar.querySelector("span")!.textContent = `${n} mot${n > 1 ? "s" : ""} · ${txt}`;
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
  function seek(t: number) { stopAt = null; video.currentTime = Math.max(0, Math.min(duration, t)); }
  function playRange(a: number, b: number) { video.currentTime = Math.max(0, a); stopAt = b; follow = true; video.play().catch(() => {}); }
  const pvOn = () => (q("[data-a=pv]") as HTMLInputElement).checked;
  function tick() {
    if (closed) return;
    const t = video.currentTime;
    if (!video.paused) {
      if (stopAt != null && t >= stopAt) { video.pause(); stopAt = null; }
      else if (pvOn() && stopAt == null) { const c = inCut(t); if (c) { if (c.end >= duration - 0.05) video.pause(); else video.currentTime = c.end; } }
    }
    q("[data-r=time]").textContent = `${fmt(t)} / ${fmt(duration)}`;
    q("[data-a=play]").textContent = video.paused ? "▶" : "⏸";
    if (words && tab === "tx") { // mot en cours
      let lo = 0, hi = words.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (words[m].start <= t) { k = m; lo = m + 1; } else hi = m - 1; }
      if (k !== curWord) { const sp = body.querySelectorAll<HTMLElement>(".tx span"); sp[curWord]?.classList.remove("cur"); curWord = k;
        if (sp[k]) { sp[k].classList.add("cur"); if (!video.paused && follow) sp[k].scrollIntoView({ block: "center", behavior: "smooth" }); } }
    }
    draw(); raf = requestAnimationFrame(tick);
  }
  body.addEventListener("touchmove", () => (follow = false), { passive: true }); // l'utilisateur fait défiler : on ne le contrarie pas

  /* ---------- Transcription ---------- */
  async function transcribe() {
    const btn = body.querySelector<HTMLButtonElement>("[data-a=transcribe]"), bar = body.querySelector<HTMLElement>(".bar"), tp = body.querySelector<HTMLElement>("[data-r=tp]");
    const model = body.querySelector<HTMLSelectElement>("[data-a=model]")?.value ?? "base";
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
      else if (d.type === "loaded") show(0, `Transcription en cours (${d.device === "webgpu" ? "GPU" : "processeur"})…`);
      else if (d.type === "progress") show(d.p, `Transcription ${Math.round(d.p * 100)} %${d.eta > 1 ? ` · reste ~${fmt(d.eta)}` : ""}`);
      else if (d.type === "done") {
        worker?.terminate(); worker = null; words = d.words; sugs = analyze(words!); sel = null; save();
        body.innerHTML = ""; refresh();
        toast(`Transcrit en ${fmt((performance.now() - t0) / 1000)} · ${sugs.length} suggestion(s).`, 4000);
      } else if (d.type === "error") {
        worker?.terminate(); worker = null; if (btn) btn.disabled = false;
        const net = /fetch|network|load/i.test(d.message);
        show(0, net ? "Impossible de télécharger le modèle de transcription. Vérifiez la connexion (nécessaire une seule fois), puis réessayez."
          : "Échec de la transcription : " + d.message);
      }
    };
    const copy = pcm.slice(); worker.postMessage({ type: "run", audio: copy, language: "fr", model }, [copy.buffer]);
  }

  /* ---------- Export ---------- */
  async function doExport() {
    video.pause();
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
        const r = await exportEdited(o.file, session.cuts, { onProgress, signal: ac.signal }); blob = r.blob; ext = r.ext; how = `${r.video.toUpperCase()}${r.audio ? " + " + r.audio.toUpperCase() : ""}`;
      } catch (e: any) {
        if (e?.name === "AbortError") throw e;
        console.warn("Export rapide impossible, repli temps réel", e); ep.textContent = "Export en temps réel (plus lent)…";
        blob = await exportRealtime(video, duration, session.cuts, onProgress, ac.signal); ext = blob.type.includes("mp4") ? "mp4" : "webm"; how = "temps réel";
      }
      const name = `green-studio-montage-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${ext}`, href = URL.createObjectURL(blob);
      const file = new File([blob], name, { type: blob.type });
      const canShare = !!navigator.canShare?.({ files: [file] });
      m.querySelector(".card")!.innerHTML = `<b>Export terminé ✓</b><p>${(blob.size / 1e6).toFixed(1)} Mo · ${fmt(session.editedDuration)} · ${how} · ${((performance.now() - t0) / 1000).toFixed(1)} s</p>
        <div class="row" style="padding:0"><a class="ib go" href="${href}" download="${name}">Télécharger</a>${canShare ? `<button class="ib" data-x="share">Partager…</button>` : ""}<button class="ib" data-x="ok">Fermer</button></div>`;
      m.querySelector<HTMLElement>("[data-x=ok]")!.onclick = () => { URL.revokeObjectURL(href); m.remove(); };
      const sh = m.querySelector<HTMLElement>("[data-x=share]"); if (sh) sh.onclick = () => navigator.share({ files: [file], title: "Green Studio" }).catch(() => {});
    } catch (e: any) {
      if (e?.name === "AbortError") { toast("Export annulé.", 2000); return; }
      m.querySelector(".card")!.innerHTML = `<b>Export impossible</b><p class="error">${esc(e?.message ?? String(e))}</p><button class="ib" data-x="ok">Fermer</button>`;
      m.querySelector<HTMLElement>("[data-x=ok]")!.onclick = () => m.remove();
    }
  }

  /* ---------- Actions ---------- */
  const commit = () => { save(); refresh(); };
  function close() {
    closed = true; ctl.abort(); cancelAnimationFrame(raf); worker?.terminate(); video.pause(); video.removeAttribute("src"); video.load();
    URL.revokeObjectURL(url); removeEventListener("keydown", onKey); root.remove(); o.onClose?.();
  }
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement, a = t.closest<HTMLElement>("[data-a]")?.dataset.a, tb = t.closest<HTMLElement>("[data-tab]")?.dataset.tab;
    if (tb) { tab = tb as "tx" | "sg"; body.innerHTML = ""; refresh(); body.scrollTop = 0; return; }
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
  return { close, session, get words() { return words; } };
}
