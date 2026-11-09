/** Bibliothèque « Mes prises » : toutes les prises stockées sur l'appareil, avec vignette, durée, taille, espace utilisé.
 *  Revoir, monter, télécharger, supprimer ; nettoyage en un geste des prises déjà téléchargées. */
import type { Backend, RecMeta } from "../core/storage.ts";

const CSS = `
.lib{position:fixed;inset:0;z-index:55;background:var(--bg);color:var(--fg);display:flex;flex-direction:column;padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}
.lib header{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--line)}.lib header h2{flex:1;margin:0;font-size:16px}
.lib .ib{background:var(--glass);padding:8px 12px;border-radius:999px;font-size:13px;text-decoration:none;color:inherit}
.lib .ib:disabled{opacity:.35}.lib .go{background:var(--accent);color:#04120a;font-weight:600}
.lib .use{padding:10px 14px;font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:6px}
.lib .bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden}.lib .bar i{display:block;height:100%;background:var(--accent)}
.lib ul{list-style:none;margin:0;padding:0 10px 30px;overflow:auto;flex:1}
.lib li{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.lib .th{width:54px;height:96px;border-radius:8px;background:#0d1411 center/cover;flex:none}
.lib .in{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}.lib .in b{font-size:14px}.lib .in small{color:var(--muted);font-size:12px}
.lib .acts{display:flex;gap:6px;flex-wrap:wrap}.lib .tag{font-size:11px;color:var(--accent)}
.lib .empty{color:var(--muted);text-align:center;padding:40px 20px}`;

const mb = (b: number) => (b >= 1e9 ? (b / 1e9).toFixed(1).replace(".", ",") + " Go" : Math.max(0.1, b / 1e6).toFixed(1).replace(".", ",") + " Mo");
const dur = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

async function thumb(file: Blob): Promise<string> {
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
  onClose?: () => void;
}

export async function openLibrary(o: LibraryOptions) {
  if (!document.getElementById("lib-css")) { const st = document.createElement("style"); st.id = "lib-css"; st.textContent = CSS; document.head.appendChild(st); }
  document.querySelector(".lib")?.remove();
  const root = document.createElement("section"); root.className = "lib"; root.setAttribute("aria-label", "Mes prises");
  root.innerHTML = `<header><button class="ib" data-a="close" aria-label="Fermer">←</button><h2>Mes prises</h2><button class="ib" data-a="clean" disabled>🧹 Téléchargées</button></header>
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
    cb.disabled = !dl.length; cb.textContent = `🧹 Téléchargées (${dl.length})`;
    if (!metas.length) { ul.innerHTML = `<li class="empty">Aucune prise pour l’instant. Vos enregistrements apparaîtront ici, même après un crash.</li>`; return; }
    ul.innerHTML = metas.map((m) => {
      let th = ""; try { th = localStorage.getItem("gs.th." + m.id) ?? ""; } catch { /* */ }
      return `<li data-id="${m.id}"><div class="th" style="${th ? `background-image:url(${th})` : ""}"></div><div class="in">
        <b>${new Date(m.startedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</b>
        <small>${dur(m.durationMs)} · ${mb(m.bytes)} ${m.downloaded ? `<span class="tag">✓ téléchargée</span>` : ""}${m.status === "recovered" ? ` <span class="tag">récupérée</span>` : ""}</small>
        <div class="acts"><button class="ib" data-a="play">▶ Voir</button><button class="ib go" data-a="edit">✂ Monter</button><button class="ib" data-a="dl">⬇</button><button class="ib" data-a="del" aria-label="Supprimer">🗑</button></div></div></li>`;
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
      const url = URL.createObjectURL(f), l = document.createElement("a"); l.href = url; l.download = `green-studio-${new Date(m.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${f.type.includes("mp4") ? "mp4" : "webm"}`;
      document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      await o.backend.putMeta({ ...m, downloaded: true }); render();
    }
  });
  await render();
  return { close, refresh: render };
}
