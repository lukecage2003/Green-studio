// Test navigateur « Planche en direct » : node tests/browser/presenter.e2e.cjs (serveur `npx vite --port 5173` lancé).
// Planche de 4 cases chargée sur l'écran de tournage ; pendant la prise : zoom sur la case bleue, retour, case suivante (rouge) ;
// au montage : étapes recréées (même cadrage), puis export → la case zoomée remplit l'incrustation au bon moment.
const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 832 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await ctx.addInitScript(() => { localStorage.setItem('gs.q', 'fast'); localStorage.setItem('gs.cd', '0'); localStorage.setItem('gs.onb', '1');
    const f = MediaRecorder.isTypeSupported; MediaRecorder.isTypeSupported = (m) => !m.startsWith('video/mp4') && f.call(MediaRecorder, m); });
  await p.goto('http://localhost:5173/'); await p.click('#go'); await p.waitForSelector('#rec:not([hidden])', { timeout: 30000 });
  // planche : fond blanc, case rouge en haut, bleue et verte au milieu, violette en bas
  const png = await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 600; c.height = 900; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 900);
    g.fillStyle = '#e01010'; g.fillRect(30, 30, 540, 270); g.fillStyle = '#1030e0'; g.fillRect(30, 330, 255, 270); g.fillStyle = '#10a030'; g.fillRect(315, 330, 255, 270); g.fillStyle = '#8020c0'; g.fillRect(30, 630, 540, 240);
    const bl = await new Promise((r) => c.toBlob(r, 'image/png')); const u = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); });
  await p.setInputFiles('#pageFile', { name: 'planche.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await p.waitForSelector('.pres:not([hidden])'); await p.waitForFunction(() => /Page · 1\/1/.test(document.querySelector('.presbar [data-p=n]')?.textContent ?? ''));
  const bb = await (await p.$('.pres canvas')).boundingBox(); console.log('planche affichée :', Math.round(bb.width), '×', Math.round(bb.height));
  const px = async (fx, fy) => p.evaluate(([fx, fy]) => { const c = document.querySelector('.pres canvas'); return [...c.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data.slice(0, 3)]; }, [fx, fy]);
  // correction des cases : 4 détectées ; toucher une case la retire, puis on la redessine en glissant
  await p.click('.presbar [data-p=edit]'); assert.match(await p.textContent('.presbar [data-p=n]'), /4 case/);
  await p.mouse.click(bb.x + bb.width * 0.75, bb.y + bb.height * 0.55); assert.match(await p.textContent('.presbar [data-p=n]'), /3 case/);
  await p.mouse.move(bb.x + bb.width * 0.56, bb.y + bb.height * 0.4); await p.mouse.down(); await p.mouse.move(bb.x + bb.width * 0.62, bb.y + bb.height * 0.62, { steps: 5 }); await p.mouse.up();
  assert.match(await p.textContent('.presbar [data-p=n]'), /4 case/); await p.click('.presbar [data-p=edit]'); assert.match(await p.textContent('.presbar [data-p=n]'), /^Page/);
  // prise
  await p.click('#rec'); await p.waitForSelector('#recChip:not([hidden])', { timeout: 20000 }); await p.waitForTimeout(1500);
  // la vue d'ensemble est recadrée (remplissage) : la case bleue est à gauche, vers le milieu en hauteur
  await p.mouse.click(bb.x + bb.width * 0.25, bb.y + bb.height * 0.55); await p.waitForTimeout(1200);
  const zoomed = await px(0.5, 0.5); console.log('centre après zoom :', zoomed, '·', await p.textContent('.presbar [data-p=n]'));
  assert.ok(zoomed[2] > 180 && zoomed[0] < 60, 'zoom sur la case bleue'); assert.match(await p.textContent('.presbar [data-p=n]'), /Case 2\/4/);
  await p.waitForTimeout(800); await p.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height * 0.5); await p.waitForTimeout(1200);
  assert.match(await p.textContent('.presbar [data-p=n]'), /^Page/); // retour à la page entière
  await p.click('.presbar [data-p=next]'); await p.waitForTimeout(1500); const red = await px(0.5, 0.5); console.log('case suivante :', red); assert.ok(red[0] > 180 && red[2] < 60, 'case 1 (rouge)');
  await p.click('#rec');
  await p.waitForSelector('#pv:not([hidden])', { timeout: 90000 }); /* finalisation de la prise : lente sur une machine de test chargée */
  const pend = await p.evaluate(() => JSON.parse(localStorage.getItem('gs.pres.pending'))); console.log('gestes :', JSON.stringify(pend.events.map((e) => [+e.t.toFixed(2), e.page, e.panel])));
  assert.ok(pend.events.length >= 4);
  // montage : étapes recréées
  await p.click('#pvEdit'); await p.waitForSelector('.qe'); await p.waitForFunction(() => /Montage \d/.test(document.querySelector('.qe [data-r=status]').textContent));
  const s = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('gs.qe.')))));
  const ov = s.overlays; console.log('étapes :', JSON.stringify(ov.map((o) => [+o.start.toFixed(2), +o.end.toFixed(2), o.seq, o.zoom ? [o.zoom.x, o.zoom.y] : 'page'])));
  assert.ok(ov.length >= 3 && ov.every((o) => o.zmove && o.src && o.mode === 'pip'));
  const blue = ov.find((o) => o.zoom && o.zoom.x < 0.4 && Math.abs(o.zoom.y - 0.5) < 0.1); assert.ok(blue, 'étape « case bleue »');
  assert.equal(await p.evaluate(() => localStorage.getItem('gs.pres.pending')), null, 'données consommées');
  // export : pendant l'étape « case bleue », le centre de l'incrustation est bleu
  await p.click('.qe [data-a=export]'); await p.click('.qe .modal [data-x=run]'); await p.waitForSelector('.qe .modal a[download], .qe .modal [data-x=save]', { timeout: 150000 });
  const r = await p.evaluate(async (t) => {
    const a = document.querySelector('.qe .modal a[download]'), bl = await (await fetch(a.href)).blob(), mb = await import('/node_modules/.vite/deps/mediabunny.js');
    const i = new mb.Input({ source: new mb.BlobSource(bl), formats: mb.ALL_FORMATS }), sink = new mb.VideoSampleSink(await i.getPrimaryVideoTrack());
    const s = await sink.getSample(t), c = new OffscreenCanvas(s.displayWidth, s.displayHeight), g = c.getContext('2d'); s.draw(g, 0, 0); s.close();
    return [...g.getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.33), 1, 1).data.slice(0, 3)];
  }, (blue.start + blue.end) / 2); // milieu de l’étape : tolère un léger décalage d’horloge quand la machine de test est chargée
  console.log('export, centre de l’incrustation :', r); assert.ok(r[2] > 150 && r[0] < 90, 'case bleue zoomée dans la vidéo exportée');
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
