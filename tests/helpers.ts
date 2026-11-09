import type { Backend, RecMeta } from "../src/core/storage.ts";
export class MemoryBackend implements Backend {
  readonly name = "memory"; metas = new Map<string, RecMeta>(); data = new Map<string, Blob[]>(); failAt = -1; n = 0;
  async putMeta(m: RecMeta) { this.metas.set(m.id, { ...m }); }
  async listMeta() { return [...this.metas.values()]; }
  async append(id: string, d: Blob) { if (this.n++ === this.failAt) throw new Error("disque plein"); (this.data.get(id) ?? this.data.set(id, []).get(id)!).push(d); }
  async file(id: string) { return new Blob(this.data.get(id) ?? []); }
  async remove(id: string) { this.metas.delete(id); this.data.delete(id); }
}

/** Faux OPFS minimal : une écriture n'est visible qu'après close() (comme le vrai), compte les octets recopiés. */
export class FakeDir {
  files = new Map<string, Blob>(); copiedBytes = 0;
  async getFileHandle(name: string, o?: { create?: boolean }) {
    if (!this.files.has(name)) { if (!o?.create) throw new DOMException("absent", "NotFoundError"); this.files.set(name, new Blob([])); }
    const dir = this;
    return {
      async getFile() { return new File([dir.files.get(name)!], name); },
      async createWritable(opt?: { keepExistingData?: boolean }) {
        let buf: Blob[] = []; if (opt?.keepExistingData) { const old = dir.files.get(name)!; dir.copiedBytes += old.size; buf = [old]; }
        return { async write(d: any) { buf.push(d instanceof Blob ? d : new Blob([d?.data ?? d])); },
          async close() { dir.files.set(name, new Blob(buf)); }, async abort() { buf = []; } };
      },
    };
  }
  async *keys() { yield* [...this.files.keys()]; }
  async removeEntry(name: string) { this.files.delete(name); }
}
