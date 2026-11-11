import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
export default defineConfig({
  worker: { format: "es" },
  build: { target: "es2022" },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Pré-optimisées au démarrage : évite un rechargement de page en plein montage la première fois qu'on les importe (dev).
  optimizeDeps: { include: ["mediabunny", "@huggingface/transformers", "@shiguredo/rnnoise-wasm"] },
});
