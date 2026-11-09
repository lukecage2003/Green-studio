/** RecoveryManager : au démarrage, repère les enregistrements restés « recording » (crash, fermeture) et les marque récupérables. */
import type { Backend, RecMeta } from "./storage.ts";

export async function recoverInterrupted(b: Backend): Promise<RecMeta[]> {
  const out: RecMeta[] = [];
  for (const m of await b.listMeta()) {
    if (m.status !== "recording") continue;
    const f = await b.file(m.id).catch(() => null);
    if (!f || f.size === 0) { await b.putMeta({ ...m, status: "failed", error: "aucune donnée" }); continue; }
    const r: RecMeta = { ...m, status: "recovered", bytes: f.size };
    await b.putMeta(r); out.push(r);
  }
  return out;
}
