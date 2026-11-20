// Test navigateur « Décor animé » : la vidéo générée se lit, dure 6 s, et sa première et sa dernière image se raccordent (boucle).
const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5173/');
  for (const kind of ['cosmos', 'multivers', 'labo']) {
    const r = await p.evaluate(async (kind) => {
      const { makeAnimatedDecor, drawDecor } = await import('/src/ui/animdecor.ts'), mb = await import('/node_modules/.vite/deps/mediabunny.js');
      const t0 = performance.now(), f = await makeAnimatedDecor(kind, undefined, 180, 320), ms = performance.now() - t0;
      const i = new mb.Input({ source: new mb.BlobSource(f), formats: mb.ALL_FORMATS }), tr = await i.getPrimaryVideoTrack();
      // boucle : l'image à t = 0 et à t = 6 s (calculées) sont identiques
      const a = new OffscreenCanvas(90, 160), c = new OffscreenCanvas(90, 160); drawDecor(a.getContext('2d'), 90, 160, kind, 0); drawDecor(c.getContext('2d'), 90, 160, kind, 6);
      const da = a.getContext('2d').getImageData(0, 0, 90, 160).data, dc = c.getContext('2d').getImageData(0, 0, 90, 160).data; let diff = 0; for (let k = 0; k < da.length; k++) diff += Math.abs(da[k] - dc[k]);
      return { type: f.type, size: f.size, dur: await tr.computeDuration(), w: await tr.getDisplayWidth(), ms: Math.round(ms), diff: diff / da.length };
    }, kind);
    console.log(kind, JSON.stringify(r)); assert.ok(r.size > 10000 && Math.abs(r.dur - 6) < 0.15 && r.w === 180, kind); assert.ok(r.diff < 1, 'boucle sans saut');
  }
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
