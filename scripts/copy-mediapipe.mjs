// Copie MediaPipe (installé par npm) dans public/mediapipe/<version>/ : l'app ne dépend plus d'un CDN
// et le service worker peut le garder en cache (chemin versionné).
import { cpSync, existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
const src = "node_modules/@mediapipe/tasks-vision", v = JSON.parse(readFileSync(src + "/package.json", "utf8")).version;
const dst = `public/mediapipe/${v}`;
if (!existsSync(dst + "/wasm/vision_wasm_internal.wasm")) {
  rmSync("public/mediapipe", { recursive: true, force: true }); mkdirSync(dst + "/wasm", { recursive: true });
  cpSync(src + "/vision_bundle.mjs", dst + "/vision_bundle.mjs"); cpSync(src + "/wasm", dst + "/wasm", { recursive: true });
}
console.log("MediaPipe", v, "->", dst);

// Modèles de détourage livrés avec l'app (hors ligne, démarrage instantané) ; en cas d'échec, l'app les télécharge en ligne.
const MODELS = {
  "selfie_segmenter.tflite": "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
  "selfie_multiclass_256x256.tflite": "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
};
mkdirSync("public/models", { recursive: true });
for (const [name, url] of Object.entries(MODELS)) {
  if (existsSync("public/models/" + name)) continue;
  try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); (await import("node:fs")).writeFileSync("public/models/" + name, Buffer.from(await r.arrayBuffer())); console.log("modèle", name); }
  catch (e) { console.warn("modèle non téléchargé (l'app le chargera en ligne) :", name, e.message); }
}
