// Test navigateur du direct : node tests/browser/live.e2e.cjs (serveur `npx vite --port 5173` lancé). Caméra et micro simulés.
const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 400, height: 800 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:5173/'); await p.click('#go'); await p.waitForSelector('#rec:not([hidden])');
  // Micro : puce visible avec le nom du micro
  await p.waitForSelector('#micChip:not([hidden])'); console.log('micro :', await p.textContent('#micChip'));
  // Décors : changement instantané (préchargés sur le GPU), y compris par toucher sur une vignette lointaine
  await p.waitForTimeout(1500);
  const times = [];
  for (const k of [2, 3, 4, 1]) {
    const th = p.locator('#strip .th').nth(k); await th.dispatchEvent('pointerdown'); await p.waitForTimeout(120); // le doigt se pose…
    const t = await p.evaluate(async (k) => { const el = document.querySelectorAll('#strip .th')[k]; const t0 = performance.now(); el.click();
      while (window.gsDebug.bg !== ['g0', 'g1', 'g2', 'g3'][k - 1]) await new Promise((r) => setTimeout(r, 1)); return performance.now() - t0; }, k);
    times.push(Math.round(t)); await p.waitForTimeout(300);
  }
  console.log('changement de décor (ms) :', times); assert.ok(Math.max(...times) < 30, 'instantané');
  // IA : modèle Précis chargé en arrière-plan (puis éventuellement Rapide si l'appareil est lent : ici GPU logiciel)
  const seen = new Set(); for (let i = 0; i < 40; i++) { seen.add(await p.evaluate(() => window.gsDebug.model)); await p.waitForTimeout(500); }
  console.log('modèles utilisés :', [...seen], '· inférence', Math.round(await p.evaluate(() => window.gsDebug.inferMs)), 'ms · synchro', await p.evaluate(() => window.gsDebug.sync));
  assert.ok(seen.has('hq'), 'le modèle Précis se charge et tourne');
  // Prompteur « suit ma voix » : avance quand on parle (bips du micro simulé), s'arrête micro coupé
  await p.click('#bScript'); await p.fill('#tpIn', Array.from({ length: 80 }, (_, i) => `Ligne ${i} du script de test.`).join('\n'));
  await p.selectOption('#tpMode', 'voice'); await p.evaluate(() => { const e = document.getElementById('tpSpd'); e.value = 120; e.dispatchEvent(new Event('input')); });
  await p.click('#tpPlay'); await p.waitForTimeout(3000); const y1 = await p.evaluate(() => document.getElementById('tp').scrollTop);
  console.log('prompteur, voix présente : défilé de', y1, 'px'); assert.ok(y1 > 30);
  await p.evaluate(() => { const g = document.getElementById('gain'); g.value = 0; g.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(800); const y2 = await p.evaluate(() => document.getElementById('tp').scrollTop); await p.waitForTimeout(2000);
  const y3 = await p.evaluate(() => document.getElementById('tp').scrollTop); console.log('silence : défilé de', y3 - y2, 'px'); assert.ok(y3 - y2 < 3, "s'arrête au silence");
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
