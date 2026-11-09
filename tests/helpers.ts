import type { Backend, RecMeta } from "../src/core/storage.ts";
export class MemoryBackend implements Backend {
  readonly name = "memory"; metas = new Map<string, RecMeta>(); data = new Map<string, Blob[]>(); failAt = -1; n = 0;
  async putMeta(m: RecMeta) { this.metas.set(m.id, { ...m }); }
  async listMeta() { return [...this.metas.values()]; }
  async append(id: string, d: Blob) { if (this.n++ === this.failAt) throw new Error("disque plein"); (this.data.get(id) ?? this.data.set(id, []).get(id)!).push(d); }
  async file(id: string) { return new Blob(this.data.get(id) ?? []); }
  async remove(id: string) { this.metas.delete(id); this.data.delete(id); }
}
