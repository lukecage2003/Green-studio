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
  // Garde-fou : un masque soudain vide alors qu'une personne était là (raté ponctuel du modèle) est ignoré quelques images.
  let cov = 0; for (let i = 0; i < n; i += 7) cov += out[i]; cov /= (n / 7) * 255;
  if (cov < 0.004 && lastCov > 0.03 && holds < 8) { holds++; out.set(prev); return; }
  holds = 0; lastCov = cov;
  // Garde-fou : sortie du modèle anormale qui dure (≈ 1,5 s) → on prévient l'app, qui relance le détourage.
  // Deux signatures : masque « tout personne », ou rayures horizontales (sauts d'une ligne à l'autre bien plus forts
  // que d'un pixel au voisin — impossible sur une vraie silhouette).
  let dh = 0, dv = 0; const w = maskW;
  for (let i = 0; i + w < n; i += 3) { dh += Math.abs(out[i] - out[i + 1]); dv += Math.abs(out[i] - out[i + w]); }
  dh /= n / 3 * 255; dv /= n / 3 * 255; quality = { cov, dh, dv };
  if (cov > 0.97 || (dv > 0.03 && dv > 3 * dh)) { if (++fullN === 45) self.postMessage({ type: "suspect" }); } else fullN = 0;
  prev.set(out);
}
let lastCov = 0, holds = 0, lumN = 0, lumCv = null, fullN = 0, maskW = 256, quality = null;
function subjectLum(frame, m) {
  lumCv ??= new OffscreenCanvas(32, 32); const g = lumCv.getContext("2d", { willReadFrequently: true });
  g.drawImage(frame, 0, 0, 32, 32); const px = g.getImageData(0, 0, 32, 32).data;
  // sujet (masque > 0,6) et fond réel (masque < 0,2) : le rapport des deux révèle le contre-jour
  let s = 0, w = 0, bs = 0, bw = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const a = m.data[Math.floor((y + 0.5) / 32 * m.h) * m.w + Math.floor((x + 0.5) / 32 * m.w)] / 255, i = (y * 32 + x) * 4;
    const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    if (a > 0.6) { s += a * l; w += a; } else if (a < 0.2) { bs += l; bw++; }
  }
  return w > 20 ? { subj: s / w, bg: bw > 20 ? bs / bw : null } : null; // assez de sujet visible pour mesurer
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
      const b = await create(model);
      // Pas de préchauffage sur une image factice : sur le GPU du téléphone, le modèle restait calé sur ce format et
      // rendait ensuite des masques corrompus (rayures, fond conservé). La 1re vraie image fait office de préchauffage.
      prev = null; lastCov = 0; holds = 0; fullN = 0;
      return b;
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
        if (m) { const n = m.width * m.height, out = new Uint8Array(n); maskW = m.width; stabilize(m.getAsFloat32Array(), n, out); res = { w: m.width, h: m.height, data: out }; }
        r.close?.();
      });
    } catch (err) { self.postMessage({ type: "frameError", message: String(err?.message ?? err) }); }
    // Lumière auto : luminosité moyenne du SUJET (pas du fond), mesurée toutes les 6 images sur une miniature 32×32.
    let lum = null;
    try { if (res && ++lumN % 6 === 0) lum = subjectLum(d.frame, res); } catch { /* mesure facultative */ }
    finally { d.frame.close?.(); }
    self.postMessage({ type: "mask", ms: performance.now() - t0, lum, q: quality, ...(res ?? {}) }, res ? [res.data.buffer] : []);
  }
};
