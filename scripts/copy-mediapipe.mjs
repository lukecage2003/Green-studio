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
