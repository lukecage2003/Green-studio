// Détourage hors du thread principal : MediaPipe + stabilisation du masque tournent ici, le rendu et l'interface restent fluides.
// Worker « classique » (pas module) : le chargeur WASM de MediaPipe utilise importScripts.
let seg = null, prev = null, stab = 0.6, invert = false, lastTs = 0, multi = false, fileset = null, backend = "GPU";
// multi = modèle « Précis » (selfie_multiclass) : 6 classes dont cheveux/visage/corps/vêtements ; la personne = 1 − fond.

/* Stabilité temporelle : zone morte (ignore le bruit), lissage fort sur les pixels calmes, réaction immédiate au mouvement réel. */
function stabilize(f, n, out) {
  if (!prev || prev.length !== n) prev = new Uint8Array(n);
  const base = 0.45 - 0.4 * stab, dead = (3 + 9 * stab) | 0;
  for (let i = 0; i < n; i++) {
    const p = multi ? 1 - f[i] : f[i], x = invert ? 1 - p : p, c = x <= 0 ? 0 : x >= 1 ? 255 : (x * 255) | 0;
    const d = c - prev[i], a = d < 0 ? -d : d;
    if (a <= dead) { out[i] = prev[i]; continue; }
    const r = a / 255, k = Math.min(1, base + 6 * r * r);
    out[i] = Math.round(prev[i] + d * k);
  }
  prev.set(out);
}

let ImageSegmenter = null;
async function create(model) {
  let lastErr;
  for (const url of model.urls) { try { return await createFrom(model, url); } catch (e) { lastErr = e; } } // fichier local, puis en ligne
  throw lastErr;
}
async function createFrom(model, url) {
  const make = (delegate) => ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: url, delegate }, runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false,
    ...(delegate === "GPU" && typeof OffscreenCanvas !== "undefined" ? { canvas: new OffscreenCanvas(1, 1) } : {}),
  });
  let s, b = "GPU";
  try { s = await make("GPU"); } catch { s = await make("CPU"); b = "CPU"; }
  seg?.close?.(); seg = s; backend = b; multi = !!model.multi; prev = null; // l'ancien modèle reste actif jusqu'à ce que le nouveau soit prêt
  return b;
}
async function init({ bases, model }) {
  let lastErr;
  for (const base of bases) {
    try {
      ({ ImageSegmenter } = await import(base + "/vision_bundle.mjs"));
      fileset = await (await import(base + "/vision_bundle.mjs")).FilesetResolver.forVisionTasks(base + "/wasm");
      return await create(model);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

self.onmessage = async (e) => {
  const d = e.data;
  if (d.type === "init") {
    try { self.postMessage({ type: "ready", backend: await init(d) }); }
    catch (err) { self.postMessage({ type: "error", message: String(err?.message ?? err) }); }
  } else if (d.type === "opts") { stab = d.stab; invert = d.invert; }
  else if (d.type === "model") {
    try { self.postMessage({ type: "modelReady", backend: await create(d.model), model: d.model.id }); }
    catch (err) { self.postMessage({ type: "modelError", message: String(err?.message ?? err), model: d.model.id }); }
  }
  else if (d.type === "frame") {
    const t0 = performance.now(); let res = null;
    try {
      lastTs = Math.max(lastTs + 1, Math.round(d.ts));
      seg.segmentForVideo(d.frame, lastTs, (r) => {
        const m = r.confidenceMasks?.[0]; // modèle Précis : masque 0 = fond
        if (m) { const n = m.width * m.height, out = new Uint8Array(n); stabilize(m.getAsFloat32Array(), n, out); res = { w: m.width, h: m.height, data: out }; }
        r.close?.();
      });
    } catch (err) { self.postMessage({ type: "frameError", message: String(err?.message ?? err) }); }
    finally { d.frame.close?.(); }
    self.postMessage({ type: "mask", ms: performance.now() - t0, ...(res ?? {}) }, res ? [res.data.buffer] : []);
  }
};
