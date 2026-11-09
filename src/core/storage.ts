/** StorageManager : sauvegarde progressive des enregistrements (OPFS en priorité, IndexedDB en repli). */
export type RecStatus = "recording" | "complete" | "recovered" | "failed";
export interface RecMeta { id: string; mime: string; startedAt: number; status: RecStatus; bytes: number; chunks: number; durationMs: number; backend: string; error?: string;
  downloaded?: boolean; /** prise récupérée déjà proposée à l'utilisateur */ seen?: boolean }

export interface Backend {
  readonly name: string;
  putMeta(m: RecMeta): Promise<void>;
  listMeta(): Promise<RecMeta[]>;
  append(id: string, data: Blob): Promise<void>;
  /** Le fichier assemblé (Blob adossé au disque, sans copie en mémoire JS). */
  file(id: string): Promise<Blob>;
  remove(id: string): Promise<void>;
}

/* ---------- OPFS ---------- */
/** Chaque enregistrement est découpé en fichiers « parts » (id.00000.part, …). Fermer une part la rend durable sans
 *  recopier ce qui précède : l'ancienne version rouvrait le fichier entier avec keepExistingData, ce qui recopiait
 *  tout l'enregistrement à chaque flush (coût quadratique, retard d'écriture sur les longues prises). */
export class OpfsBackend implements Backend {
  readonly name = "opfs";
  private dir!: FileSystemDirectoryHandle;
  private parts = new Map<string, number>();
  private writers = new Map<string, FileSystemWritableFileStream>();
  static async available() { try { return !!(navigator.storage?.getDirectory) && !!(await navigator.storage.getDirectory()); } catch { return false; } }
  /** dir injectable pour les tests. */
  async init(dir?: FileSystemDirectoryHandle) {
    this.dir = dir ?? await (await navigator.storage.getDirectory()).getDirectoryHandle("gs-rec", { create: true }); return this;
  }
  async putMeta(m: RecMeta) {
    const h = await this.dir.getFileHandle(m.id + ".json", { create: true }); const w = await h.createWritable();
    await w.write(JSON.stringify(m)); await w.close();
  }
  private async names(): Promise<string[]> { const out: string[] = []; for await (const name of (this.dir as any).keys()) out.push(name); return out; }
  private async meta(id: string): Promise<RecMeta | null> {
    try { return JSON.parse(await (await (await this.dir.getFileHandle(id + ".json")).getFile()).text()); } catch { return null; }
  }
  async listMeta() {
    const out: RecMeta[] = [];
    for (const name of await this.names()) if (name.endsWith(".json")) { const m = await this.meta(name.slice(0, -5)); if (m) out.push(m); }
    return out;
  }
  private async partNames(id: string) {
    const n = await this.names();
    // id.bin = format des versions précédentes, conservé pour relire les anciens enregistrements.
    return [...n.filter((x) => x === id + ".bin"), ...n.filter((x) => x.startsWith(id + ".") && x.endsWith(".part")).sort()];
  }
  async append(id: string, data: Blob) {
    let w = this.writers.get(id);
    if (!w) {
      let k = this.parts.get(id);
      if (k == null) k = (await this.partNames(id)).length; // reprise après rechargement : ne jamais écraser une part
      this.parts.set(id, k + 1);
      const h = await this.dir.getFileHandle(`${id}.${String(k).padStart(5, "0")}.part`, { create: true });
      w = await h.createWritable(); this.writers.set(id, w);
    }
    await w.write(data);
  }
  /** Ferme la part en cours : elle devient durable. La suivante repart d'un fichier vide (aucune recopie). */
  async flush(id: string) {
    const w = this.writers.get(id); if (!w) return;
    this.writers.delete(id); await w.close();
  }
  async file(id: string) {
    await this.flush(id);
    const files: Blob[] = [];
    for (const n of await this.partNames(id)) files.push(await (await this.dir.getFileHandle(n)).getFile());
    return new Blob(files, { type: (await this.meta(id))?.mime || "video/webm" }); // Blob composé de fichiers disque : pas de copie en mémoire
  }
  async remove(id: string) {
    const w = this.writers.get(id); this.writers.delete(id); await w?.abort?.().catch(() => {});
    for (const n of [...await this.partNames(id), id + ".json"]) await this.dir.removeEntry(n).catch(() => {});
    this.parts.delete(id);
  }
}

/* ---------- IndexedDB (repli) ---------- */
export class IdbBackend implements Backend {
  readonly name = "idb";
  private db!: IDBDatabase; private seq = new Map<string, number>(); private mimes = new Map<string, string>();
  async init() {
    this.db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open("gs-rec", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("meta", { keyPath: "id" }); r.result.createObjectStore("chunks"); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }); return this;
  }
  private tx<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
    return new Promise((res, rej) => { const t = this.db.transaction(store, mode); const q = f(t.objectStore(store));
      t.oncomplete = () => res(q ? (q as IDBRequest<T>).result : (undefined as T)); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  }
  async putMeta(m: RecMeta) { this.mimes.set(m.id, m.mime); await this.tx("meta", "readwrite", (s) => { s.put(m); }); }
  listMeta() { return this.tx<RecMeta[]>("meta", "readonly", (s) => s.getAll()); }
  async append(id: string, data: Blob) {
    const n = this.seq.get(id) ?? 0; this.seq.set(id, n + 1);
    await this.tx("chunks", "readwrite", (s) => { s.put(data, `${id}:${String(n).padStart(8, "0")}`); });
  }
  async file(id: string) {
    const keys = await this.tx<IDBValidKey[]>("chunks", "readonly", (s) => s.getAllKeys(IDBKeyRange.bound(id + ":", id + ":\uffff")));
    const parts: Blob[] = [];
    for (const k of keys) parts.push(await this.tx<Blob>("chunks", "readonly", (s) => s.get(k)));
    const mime = this.mimes.get(id) ?? (await this.tx<RecMeta | undefined>("meta", "readonly", (s) => s.get(id)))?.mime;
    return new Blob(parts, { type: mime || "video/webm" });
  }
  async remove(id: string) {
    const keys = await this.tx<IDBValidKey[]>("chunks", "readonly", (s) => s.getAllKeys(IDBKeyRange.bound(id + ":", id + ":\uffff")));
    await this.tx("chunks", "readwrite", (s) => { for (const k of keys) s.delete(k); });
    await this.tx("meta", "readwrite", (s) => { s.delete(id); });
  }
}

export async function openBackend(): Promise<Backend> {
  if (await OpfsBackend.available()) { try { return await new OpfsBackend().init(); } catch { /* repli */ } }
  return new IdbBackend().init();
}

/* ---------- Écriture progressive ---------- */
export interface WriterOptions { minFreeBytes: number; maxQueue: number; metaEveryChunks: number; flushEveryChunks: number; estimate: () => Promise<{ quota?: number; usage?: number } | undefined> }
export const WRITER_DEFAULTS: WriterOptions = {
  minFreeBytes: 150e6, maxQueue: 20, metaEveryChunks: 5, flushEveryChunks: 5,
  estimate: async () => (typeof navigator !== "undefined" ? navigator.storage?.estimate?.() : undefined),
};

/** File d'attente séquentielle : un chunk à la fois, ordre garanti, alertes en cas de retard ou d'espace faible. */
export class RecordingWriter {
  private chain: Promise<void> = Promise.resolve();
  private pending = 0; private stopped = false;
  meta: RecMeta;
  onWarning: (code: "low_space" | "backlog" | "write_error", detail?: string) => void = () => {};
  private o: WriterOptions; private backend: Backend;
  constructor(backend: Backend, id: string, mime: string, opts: Partial<WriterOptions> = {}, now = Date.now()) {
    this.backend = backend; this.o = { ...WRITER_DEFAULTS, ...opts };
    this.meta = { id, mime, startedAt: now, status: "recording", bytes: 0, chunks: 0, durationMs: 0, backend: backend.name };
  }
  async start() {
    const est = await this.o.estimate();
    if (est?.quota != null && est.usage != null && est.quota - est.usage < this.o.minFreeBytes) throw new Error("Espace de stockage insuffisant");
    await this.backend.putMeta(this.meta);
  }
  /** Appelé depuis MediaRecorder.ondataavailable. Ne bloque jamais le thread. */
  write(data: Blob, elapsedMs: number) {
    if (this.stopped || data.size === 0) return;
    this.pending++;
    if (this.pending > this.o.maxQueue) this.onWarning("backlog", String(this.pending));
    this.chain = this.chain.then(async () => {
      try {
        await this.backend.append(this.meta.id, data);
        this.meta.bytes += data.size; this.meta.chunks++; this.meta.durationMs = elapsedMs;
        if (this.meta.chunks % this.o.metaEveryChunks === 0) await this.backend.putMeta(this.meta);
        if (this.meta.chunks % this.o.flushEveryChunks === 0) {
          const est = await this.o.estimate();
          if (est?.quota != null && est.usage != null && est.quota - est.usage < this.o.minFreeBytes) this.onWarning("low_space");
          await (this.backend as any).flush?.(this.meta.id);
        }
      } catch (e) { this.meta.error = String((e as Error).message); this.onWarning("write_error", this.meta.error); }
      finally { this.pending--; }
    });
  }
  async finish(elapsedMs: number): Promise<RecMeta> {
    this.stopped = true; await this.chain;
    this.meta.durationMs = elapsedMs; this.meta.status = this.meta.error && this.meta.chunks === 0 ? "failed" : "complete";
    await this.backend.putMeta(this.meta); return this.meta;
  }
}
