/** Bibliothèque « Mes prises » : toutes les prises stockées sur l'appareil, avec vignette, durée, taille, espace utilisé.
 *  Revoir, monter, télécharger, supprimer ; nettoyage en un geste des prises déjà téléchargées. */
import type { Backend, RecMeta } from "../core/storage.ts";

const CSS = `
.lib{position:fixed;inset:0;z-index:55;background:#000;color:var(--fg);display:flex;flex-direction:column;padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0);font-family:var(--font)}
.lib header{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;height:50px;padding:0 16px}
.lib header h2{margin:0;font-size:17px;font-weight:650}
.lib header [data-a=close]{justify-self:start;color:var(--accent);font-size:17px}
.lib header [data-a=clean]{justify-self:end;color:var(--accent);font-size:15px}
.lib header [data-a=clean]:disabled{opacity:.3}
.lib .ib{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 13px;border-radius:16px;background:var(--fill);font-size:14px;font-weight:600;text-decoration:none;color:inherit}
.lib .go{background:var(--accent);color:#000}
.lib .ic{width:32px;padding:0}.lib .ic svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lib .use{padding:4px 16px 14px;font-size:13px;color:var(--muted);display:flex;flex-direction:column;gap:8px}
.lib .bar{height:4px;border-radius:2px;background:var(--fill);overflow:hidden}.lib .bar i{display:block;height:100%;background:var(--accent)}
.lib ul{list-style:none;margin:0 16px;padding:0;overflow:auto;flex:1;border-radius:14px}
.lib li{display:flex;gap:12px;align-items:center;padding:10px 12px;background:#1c1c1e}
.lib li+li{border-top:.5px solid var(--line)}
.lib li:first-child{border-radius:14px 14px 0 0}.lib li:last-child{border-radius:0 0 14px 14px}.lib li:only-child{border-radius:14px}
.lib .th{width:54px;height:96px;border-radius:10px;background:#2c2c2e center/cover;flex:none}
.lib .in{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px}.lib .in b{font-size:16px;font-weight:600}.lib .in small{color:var(--muted);font-size:13px}
.lib .acts{display:flex;gap:6px;flex-wrap:nowrap}.lib .tag{font-size:12px;color:var(--accent)}
.lib .empty{color:var(--muted);text-align:center;padding:48px 24px;background:#1c1c1e;font-size:15px;line-height:1.4}
/* verre sombre (esprit iOS actuel) */
.qe header,.lib header{margin:6px 8px 8px;border-radius:22px;background:rgba(255,255,255,.08);-webkit-backdrop-filter:blur(26px) saturate(185%);backdrop-filter:blur(26px) saturate(185%);border:.5px solid rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.28)}
.qe .ib,.lib .ib{background:rgba(255,255,255,.1);border:.5px solid rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.22);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px)}
.qe .go,.lib .go{background:var(--accent);border-color:rgba(255,255,255,.3)}
.qe .tools label{background:rgba(255,255,255,.1);border:.5px solid rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.22)}
.qe .tabs{background:rgba(255,255,255,.08);border:.5px solid rgba(255,255,255,.12);border-radius:16px;padding:3px}
.qe .tabs button{border-radius:13px}.qe .tabs button[aria-selected=true]{background:rgba(255,255,255,.2);box-shadow:inset 0 1px 0 rgba(255,255,255,.25)}
.qe .card,.qe .sg,.lib li,.lib .empty{background:rgba(255,255,255,.07);border:.5px solid rgba(255,255,255,.1)}
.qe .card{border-radius:22px}
.qe .vw{border-radius:24px}.qe canvas.wave{border-radius:14px;background:rgba(255,255,255,.06)}
.qe .modal .card{background:rgba(28,28,32,.62);-webkit-backdrop-filter:blur(44px) saturate(190%);backdrop-filter:blur(44px) saturate(190%);border:.5px solid rgba(255,255,255,.2);border-radius:32px;box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 24px 60px rgba(0,0,0,.5)}
.qe .selbar{background:rgba(40,40,46,.55);-webkit-backdrop-filter:blur(30px) saturate(185%);backdrop-filter:blur(30px) saturate(185%);border:.5px solid rgba(255,255,255,.2);border-radius:26px;box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 14px 40px rgba(0,0,0,.5)}
.lib ul{margin:0 12px}.lib li:first-child{border-radius:20px 20px 0 0}.lib li:last-child{border-radius:0 0 20px 20px}.lib li:only-child{border-radius:20px}
`;

const mb = (b: number) => (b >= 1e9 ? (b / 1e9).toFixed(1).replace(".", ",") + " Go" : Math.max(0.1, b / 1e6).toFixed(1).replace(".", ",") + " Mo");
const dur = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export async function thumb(file: Blob): Promise<string> {
  const v = document.createElement("video"), url = URL.createObjectURL(file); v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  try {
    await new Promise((r, j) => { v.onloadeddata = r; v.onerror = j; setTimeout(j, 8000); });
    await new Promise((r) => { v.onseeked = r; v.currentTime = 0.4; setTimeout(r, 3000); });
    const c = document.createElement("canvas"); c.width = 108; c.height = 192; const g = c.getContext("2d")!;
    const k = Math.max(108 / v.videoWidth, 192 / v.videoHeight); g.drawImage(v, (108 - v.videoWidth * k) / 2, (192 - v.videoHeight * k) / 2, v.videoWidth * k, v.videoHeight * k);
    return c.toDataURL("image/jpeg", 0.7);
  } finally { v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url); }
}

export interface LibraryOptions {
  backend: Backend;
  onPlay: (m: RecMeta, f: Blob) => void;
  onEdit: (m: RecMeta, f: Blob) => void;
  toast: (m: string, ms?: number) => void;
  /** Enregistre la vidéo (Galerie dans l'app Android, téléchargement dans le navigateur). */
  save: (f: Blob, name: string) => Promise<void>;
  onClose?: () => void;
}

export async function openLibrary(o: LibraryOptions) {
  if (!document.getElementById("lib-css")) { const st = document.createElement("style"); st.id = "lib-css"; st.textContent = CSS; document.head.appendChild(st); }
  document.querySelector(".lib")?.remove();
  const root = document.createElement("section"); root.className = "lib"; root.setAttribute("aria-label", "Mes prises");
  root.innerHTML = `<header><button data-a="close">Fermer</button><h2>Mes prises</h2><button data-a="clean" disabled>Nettoyer</button></header>
    <div class="use"><span data-r="use">…</span><div class="bar"><i style="width:0"></i></div></div><ul></ul>`;
  document.body.appendChild(root);
  const ul = root.querySelector("ul")!, close = () => { root.remove(); o.onClose?.(); };
  let metas: RecMeta[] = [];
  const del = async (m: RecMeta) => {
    await o.backend.remove(m.id).catch(() => {});
    try { localStorage.removeItem("gs.qe." + m.id); localStorage.removeItem("gs.th." + m.id); } catch { /* */ }
  };

  async function render() {
    metas = (await o.backend.listMeta()).filter((m) => m.status !== "recording" && m.status !== "failed").sort((a, b) => b.startedAt - a.startedAt);
    const est = await navigator.storage?.estimate?.().catch(() => undefined), used = metas.reduce((s, m) => s + m.bytes, 0);
    root.querySelector<HTMLElement>("[data-r=use]")!.textContent = `${metas.length} prise(s) · ${mb(used)}` + (est?.quota ? ` · ${mb(Math.max(0, est.quota - (est.usage ?? 0)))} libres` : "");
    if (est?.quota) root.querySelector<HTMLElement>(".bar i")!.style.width = Math.min(100, ((est.usage ?? 0) / est.quota) * 100) + "%";
    const dl = metas.filter((m) => m.downloaded); const cb = root.querySelector<HTMLButtonElement>("[data-a=clean]")!;
    cb.disabled = !dl.length; cb.textContent = dl.length ? `Nettoyer (${dl.length})` : "Nettoyer";
    if (!metas.length) { ul.innerHTML = `<li class="empty">Aucune prise pour l’instant. Vos enregistrements apparaîtront ici, même après un crash.</li>`; return; }
    ul.innerHTML = metas.map((m) => {
      let th = ""; try { th = localStorage.getItem("gs.th." + m.id) ?? ""; } catch { /* */ }
      return `<li data-id="${m.id}"><div class="th" style="${th ? `background-image:url(${th})` : ""}"></div><div class="in">
        <b>${new Date(m.startedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</b>
        <small>${dur(m.durationMs)} · ${mb(m.bytes)} ${m.downloaded ? `<span class="tag">✓ téléchargée</span>` : ""}${m.status === "recovered" ? ` <span class="tag">récupérée</span>` : ""}</small>
        <div class="acts"><button class="ib" data-a="play">Voir</button><button class="ib go" data-a="edit">Monter</button><button class="ib ic" data-a="dl" aria-label="Enregistrer dans la Galerie"><svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/></svg></button><button class="ib ic" data-a="del" aria-label="Supprimer" style="color:var(--red)"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/></svg></button></div></div></li>`;
    }).join("");
    for (const m of metas) { // vignettes manquantes, une à la fois
      if (root.isConnected === false) return;
      try { if (localStorage.getItem("gs.th." + m.id)) continue; } catch { continue; }
      try { const d = await thumb(await o.backend.file(m.id)); try { localStorage.setItem("gs.th." + m.id, d); } catch { /* */ }
        const el = ul.querySelector<HTMLElement>(`[data-id="${m.id}"] .th`); if (el) el.style.backgroundImage = `url(${d})`; } catch { /* vidéo illisible : pas de vignette */ }
    }
  }

  root.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement, a = t.closest<HTMLElement>("[data-a]")?.dataset.a, id = t.closest<HTMLElement>("[data-id]")?.dataset.id;
    const m = metas.find((x) => x.id === id);
    if (a === "close") return close();
    if (a === "clean") {
      const dl = metas.filter((x) => x.downloaded); if (!dl.length || !confirm(`Supprimer ${dl.length} prise(s) déjà téléchargée(s) de l’appareil ?`)) return;
      for (const x of dl) await del(x); o.toast(`${dl.length} prise(s) supprimée(s).`, 2500); return render();
    }
    if (!m) return;
    if (a === "del") { if (!confirm(m.downloaded ? "Supprimer cette prise ?" : "Cette prise n’a jamais été téléchargée. La supprimer définitivement ?")) return; await del(m); return render(); }
    const f = await o.backend.file(m.id);
    if (a === "play") o.onPlay(m, f);
    else if (a === "edit") o.onEdit(m, f);
    else if (a === "dl") {
      try { await o.save(f, `green-studio-${new Date(m.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${f.type.includes("mp4") ? "mp4" : "webm"}`); }
      catch (err: any) { o.toast("Échec de l’enregistrement : " + (err?.message ?? err), 6000); return; }
      await o.backend.putMeta({ ...m, downloaded: true }); render();
    }
  });
  await render();
  return { close, refresh: render };
}
