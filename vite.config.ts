import { defineConfig } from "vite";
export default defineConfig({
  worker: { format: "es" },
  build: { target: "es2022" },
  // Pré-optimisées au démarrage : évite un rechargement de page en plein montage la première fois qu'on les importe (dev).
  optimizeDeps: { include: ["mediabunny", "@huggingface/transformers"] },
});
