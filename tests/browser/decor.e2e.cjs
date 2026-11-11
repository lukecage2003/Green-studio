// Test navigateur « Décors » : node tests/browser/decor.e2e.cjs (serveur `npx vite --port 5173` lancé).
// Appui long → mode édition ; ✕ supprime (avec Annuler) ; glisser déplace ; l'ordre et les suppressions survivent au redémarrage.
const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 832 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await ctx.addInitScript(() => { localStorage.setItem('gs.q', 'fast'); localStorage.setItem('gsHint', '1'); });
  const ids = () => p.$$eval('#strip .th[data-id]', (l) => l.map((x) => x.dataset.id));
  await p.goto('http://localhost:5173/'); await p.click('#go'); await p.waitForSelector('#rec:not([hidden])', { timeout: 30000 });
  const start = await ids(); console.log('décors :', start.join(' ')); assert.deepEqual(start, ['g0', 'g1', 'g2', 'g3', 'blur']);
  const th = async (k) => (await p.$$('#strip .th[data-id]'))[k];
  // appui long → mode édition
  let bb = await (await th(1)).boundingBox(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.waitForTimeout(650); await p.mouse.up();
  assert.ok(await p.$('#strip.edit'), 'mode édition'); assert.equal(await p.$eval('#strip .done', (e) => getComputedStyle(e).display), 'block');
  // ✕ sur g2, puis Annuler
  await p.click('#strip .th[data-id=g2] .x', { force: true }); assert.deepEqual(await ids(), ['g0', 'g1', 'g3', 'blur']); assert.ok(await p.$eval('#snack', (e) => !e.hidden || e.dataset.shown));
  await p.$eval('#snack button', (e) => e.click()); assert.deepEqual(await ids(), ['g0', 'g1', 'g2', 'g3', 'blur'], 'Annuler remet le décor');
  // glisser g0 après g2
  bb = await (await th(0)).boundingBox(); const tgt = await (await th(2)).boundingBox();
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + 30, bb.y + bb.height / 2, { steps: 3 });
  await p.mouse.move(tgt.x + tgt.width * 0.8, bb.y + bb.height / 2, { steps: 6 }); await p.mouse.up();
  const moved = await ids(); console.log('après déplacement :', moved.join(' ')); assert.deepEqual(moved, ['g1', 'g2', 'g0', 'g3', 'blur']);
  // supprimer g3 pour de bon, OK, changer de décor en direct
  await p.click('#strip .th[data-id=g3] .x', { force: true }); await p.click('#strip .done'); assert.ok(!(await p.$('#strip.edit')), 'OK termine');
  await p.click('#strip .th[data-id=g0]'); await p.waitForTimeout(300); assert.ok(await p.$('#strip .th[data-id=g0].on'), 'décor choisi');
  await p.reload(); await p.click('#go'); await p.waitForSelector('#rec:not([hidden])', { timeout: 30000 });
  const after = await ids(); console.log('après redémarrage :', after.join(' ')); assert.deepEqual(after, ['g1', 'g2', 'g0', 'blur']);
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
