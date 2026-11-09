// Génère les icônes PWA (node scripts/make-icons.cjs) : silhouette détourée sur un décor, aux couleurs de l'app.
const { chromium } = require("playwright"); const fs = require("fs");
(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  const make = (size, maskable, layer) => p.evaluate(({ size, maskable, layer }) => {
    const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d"), s = size / 512;
    if (!maskable) { g.beginPath(); g.roundRect(0, 0, size, size, 112 * s); g.clip(); }
    const bg = g.createLinearGradient(0, 0, 0, size); bg.addColorStop(0, "#0f2a1d"); bg.addColorStop(1, "#1c6b46");
    if (layer !== "fg") { g.fillStyle = bg; g.fillRect(0, 0, size, size); }
    if (layer === "bg") return c.toDataURL("image/png").split(",")[1];
    const k = layer === "fg" ? 0.62 : maskable ? 0.78 : 1; // icône adaptative Android : sujet dans la zone sûre (66 %) g.translate(size / 2, size / 2); g.scale(k * s, k * s); g.translate(-256, -256); // zone sûre maskable
    g.fillStyle = "rgba(52,224,139,.18)"; g.beginPath(); g.arc(256, 236, 170, 0, 7); g.fill();               // halo « décor »
    g.fillStyle = "#34e08b"; g.beginPath(); g.arc(256, 196, 74, 0, 7); g.fill();                              // tête
    g.beginPath(); g.moveTo(118, 420); g.bezierCurveTo(118, 318, 182, 286, 256, 286); g.bezierCurveTo(330, 286, 394, 318, 394, 420); g.closePath(); g.fill(); // épaules
    g.strokeStyle = "#eef4f0"; g.lineWidth = 14; g.setLineDash([26, 18]); g.lineCap = "round";                 // contour de détourage
    g.beginPath(); g.arc(256, 196, 96, 0, 7); g.stroke();
    return c.toDataURL("image/png").split(",")[1];
  }, { size, maskable, layer });
  for (const [n, sz, m] of [["icon-192", 192, false], ["icon-512", 512, false], ["maskable-512", 512, true]])
    fs.writeFileSync(`public/icons/${n}.png`, Buffer.from(await make(sz, m), "base64"));
  // Android : calques de l'icône adaptative (assemblés aux bonnes densités par scripts/android-assets.py)
  fs.mkdirSync("scripts/out", { recursive: true });
  fs.writeFileSync("scripts/out/fg-432.png", Buffer.from(await make(432, true, "fg"), "base64"));
  fs.writeFileSync("scripts/out/bg-432.png", Buffer.from(await make(432, true, "bg"), "base64"));
  await b.close();
})();
