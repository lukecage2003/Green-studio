// Test navigateur « Plateau 3D » : node tests/browser/stage.e2e.cjs (serveur `npx vite --port 5173` lancé).
// Positions de tête injectées → le décor glisse à l'opposé, grossit quand on s'approche, ne montre jamais de bord, revient au centre.
const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 384, height: 832 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem('gs.q', 'fast'); localStorage.setItem('gsHint', '1'); });
  await p.goto('http://localhost:5173/'); await p.click('#go'); await p.waitForSelector('#rec:not([hidden])', { timeout: 30000 });
  await p.waitForFunction(() => window.gsPar?.b, null, { timeout: 60000 });
  // la vraie détection est remplacée par des positions connues (miroir actif : x image 0,2 = droite de l'écran)
  const hold = (h, ms) => p.evaluate(async ([h, ms]) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { window.gsPar.seen(h); await new Promise((r) => setTimeout(r, 30)); }
    const P = window.gsPar; return { ox: P.b[2], oy: P.b[3], sx: P.b[0], sy: P.b[1], x: P.x, z: P.z }; }, [h, ms]);
  const c = await hold({ x: 0.5, y: 0.22, s: 0.3 }, 2500), r = await hold({ x: 0.2, y: 0.22, s: 0.3 }, 2500), l = await hold({ x: 0.8, y: 0.22, s: 0.3 }, 2500);
  console.log('centre', c, '\ndroite', r, '\ngauche', l);
  assert.ok(r.ox > c.ox + 0.01, "tête à droite → le décor glisse vers la gauche"); assert.ok(l.ox < c.ox - 0.01, 'tête à gauche → le décor glisse vers la droite');
  for (const v of [c, r, l]) assert.ok(v.ox >= 0 && v.ox <= 1 - v.sx + 1e-6 && v.oy >= 0 && v.oy <= 1 - v.sy + 1e-6, 'jamais de bord visible');
  const near = await hold({ x: 0.5, y: 0.22, s: 0.4 }, 1500); console.log('proche', near); assert.ok(near.sx < c.sx, 'on s’approche → le décor grossit');
  // réglage à 0 : décor fixe
  await p.evaluate(() => { const e = document.getElementById('par'); e.value = 0; e.dispatchEvent(new Event('input')); });
  const off = await hold({ x: 0.2, y: 0.22, s: 0.3 }, 800); console.log('coupé', off); assert.ok(Math.abs(off.ox - (1 - off.sx) / 2) < 1e-4, 'Plateau 3D à 0 : décor centré');
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
