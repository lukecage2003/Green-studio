// Test navigateur « Planche en direct » : node tests/browser/presenter.e2e.cjs (serveur `npx vite --port 5173` lancé).
// La planche devient le décor ; ses cases sont repérées (IA + bordures) ; toucher la case bleue → le décor zoome dessus ;
// toucher à nouveau → page entière ; › → case suivante ; correction des cases ; à la fermeture, décor et cadrage d'origine reviennent.
const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 832 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => { errs.push(e.message); console.log('[erreur page]', e.message); }); p.on('dialog', (d) => d.accept());
  await ctx.addInitScript(() => { localStorage.setItem('gs.q', 'fast'); localStorage.setItem('gs.cd', '0'); localStorage.setItem('gs.onb', '1');
    const f = MediaRecorder.isTypeSupported; MediaRecorder.isTypeSupported = (m) => !m.startsWith('video/mp4') && f.call(MediaRecorder, m); });
  await p.goto('http://localhost:5173/'); await p.click('#go'); await p.waitForSelector('#rec:not([hidden])', { timeout: 30000 });
  // planche : fond blanc, case rouge en haut, bleue et verte au milieu, violette en bas (bordures noires)
  const png = await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 600; c.height = 900; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 900);
    const cell = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); g.lineWidth = 5; g.strokeStyle = '#111'; g.strokeRect(x, y, w, h); };
    cell(30, 30, 540, 270, '#e01010'); cell(30, 330, 255, 270, '#1030e0'); cell(315, 330, 255, 270, '#10a030'); cell(30, 630, 540, 240, '#8020c0');
    const bl = await new Promise((r) => c.toBlob(r, 'image/png')); const u = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); });
  const before = await p.evaluate(() => window.gsPresStage.get());
  await p.setInputFiles('#pageFile', { name: 'planche.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await p.waitForFunction(() => /Page · 1\/1/.test(document.querySelector('.presbar [data-p=n]')?.textContent ?? ''), null, { timeout: 60000 });
  assert.equal(await p.$('.pres'), null, 'plus de rectangle par-dessus l’image');
  await p.click('.presbar [data-p=edit]'); const n = +(await p.textContent('.presbar [data-p=n]')).match(/\d+/)[0]; console.log('cases repérées :', n); assert.equal(n, 4); await p.click('.presbar [data-p=edit]');
  const fb = await (await p.$('.prestap')).boundingBox(), view = () => p.evaluate(() => window.gsPresStage.get());
  // vue d'ensemble : la page remplit l'écran (recadrée sur les côtés) ; case bleue : x ≈ 0,26 de la page → 0,22 de l'écran
  const [sx1, , ox] = await p.evaluate(() => window.gsPresStage.cover(1, 0, 0)), fx = (0.2625 - ox) / sx1;
  await p.mouse.click(fb.x + fb.width * fx, fb.y + fb.height * 0.52); await p.waitForTimeout(1600);
  let v = await view(); console.log('zoom sur la case bleue :', JSON.stringify(v), await p.textContent('.presbar [data-p=n]'));
  assert.ok(v.zoom > 1.8 && v.px < -0.3, 'le décor zoome sur la case bleue (à gauche)'); assert.match(await p.textContent('.presbar [data-p=n]'), /Case 2\/4/);
  const [bsx, bsy, box, boy] = await p.evaluate((v) => window.gsPresStage.cover(v.zoom, v.px, v.py), v);
  assert.ok(box < 0.06 && box + bsx > 0.46 && boy < 0.37 && boy + bsy > 0.66, 'toute la case bleue est visible');
  await p.mouse.click(fb.x + fb.width * 0.5, fb.y + fb.height * 0.5); for (let k = 0; k < 8; k++) { await p.waitForTimeout(200); console.log('t+' + (k + 1) * 200, JSON.stringify(await view())); } v = await view(); console.log('après appui :', JSON.stringify(v), await p.textContent('.presbar [data-p=n]')); assert.ok(Math.abs(v.zoom - 1) < 0.01, 'retour à la page entière');
  // double appui : zoom à l'endroit touché (ici entre deux cases), simple appui ensuite → page entière
  await p.mouse.dblclick(fb.x + fb.width * 0.5, fb.y + fb.height * 0.3); await p.waitForTimeout(1600); v = await view(); console.log('double appui :', JSON.stringify(v), await p.textContent('.presbar [data-p=n]'));
  assert.ok(v.zoom >= 2.4, 'zoom libre'); assert.match(await p.textContent('.presbar [data-p=n]'), /^Zoom/);
  await p.mouse.click(fb.x + fb.width * 0.5, fb.y + fb.height * 0.5); await p.waitForTimeout(1600); v = await view(); assert.ok(Math.abs(v.zoom - 1) < 0.01, 'retour à la page entière après le zoom libre');
  await p.click('.presbar [data-p=next]'); await p.waitForTimeout(1600); v = await view(); assert.ok(v.zoom > 1.2 && v.py < -0.5, 'case 1 (en haut)'); const px0 = v.px; await p.waitForTimeout(2500); v = await view(); console.log('panoramique :', px0.toFixed(2), '→', v.px.toFixed(2)); assert.ok(v.px > px0 + 0.3, 'case large : panoramique de gauche à droite'); assert.match(await p.textContent('.presbar [data-p=n]'), /Case 1\/4/);
  // prise : le zoom est dans la vidéo (décor), rien n'est laissé à rejouer au montage
  await p.click('#rec'); await p.waitForSelector('#recChip:not([hidden])', { timeout: 20000 }); await p.waitForTimeout(1500); await p.click('.presbar [data-p=next]'); await p.waitForTimeout(1500); await p.click('#rec');
  await p.waitForSelector('#pv:not([hidden])', { timeout: 90000 }); /* finalisation de la prise : lente sur une machine de test chargée */
  assert.equal(await p.evaluate(() => localStorage.getItem('gs.pres.pending')), null);
  await p.click('#pvClose').catch(() => {}); await p.waitForTimeout(500);
  // fermeture : décor et cadrage d'origine
  await p.click('.presbar [data-p=close]'); await p.waitForTimeout(400); const after = await view(); console.log('cadrage rétabli :', JSON.stringify(after));
  assert.deepEqual(after, before);
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
