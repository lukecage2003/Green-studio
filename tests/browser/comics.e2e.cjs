// Test navigateur « Parcours de cases » : node tests/browser/comics.e2e.cjs (serveur `npx vite --port 5173` lancé).
// Page de comic en 4 cases de couleur (rouge, vert / bleu, jaune) insérée en plein écran ; parcours case rouge → case jaune ;
// export : d'abord la page entière (4 couleurs), puis tout rouge, puis tout jaune.
const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 384, height: 832 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await ctx.addInitScript(() => localStorage.setItem('gs.autoClean', '0'));
  await p.goto('http://localhost:5173/');
  const [vid, png] = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 180; c.height = 320; const x = c.getContext('2d'); const st = c.captureStream(30);
    const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); d.stream.getAudioTracks().forEach((t) => st.addTrack(t));
    const rec = new MediaRecorder(st, { mimeType: 'video/webm;codecs=vp9,opus' }), parts = []; rec.ondataavailable = (e) => parts.push(e.data);
    const draw = () => { x.fillStyle = '#444'; x.fillRect(0, 0, 180, 320); if (rec.state === 'recording') requestAnimationFrame(draw); }; rec.start(); draw();
    await new Promise((r) => setTimeout(r, 8000)); const s = new Promise((r) => (rec.onstop = r)); rec.stop(); await s;
    const i = document.createElement('canvas'); i.width = 900; i.height = 1600; const g = i.getContext('2d');
    [['#e02020', 0, 0], ['#20c040', 450, 0], ['#2050e0', 0, 800], ['#f0d020', 450, 800]].forEach(([col, X, Y]) => { g.fillStyle = col; g.fillRect(X, Y, 450, 800); });
    const b64 = async (bl) => { const u = new Uint8Array(await bl.arrayBuffer()); let s2 = ''; for (let k = 0; k < u.length; k += 0x8000) s2 += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000)); return btoa(s2); };
    return [await b64(new Blob(parts)), await b64(await new Promise((r) => i.toBlob(r, 'image/png')))];
  });
  await p.setInputFiles('#editFile', { name: 'comics.webm', mimeType: 'video/webm', buffer: Buffer.from(vid, 'base64') });
  await p.waitForSelector('.qe'); await p.waitForFunction(() => /Montage \d/.test(document.querySelector('.qe [data-r=status]').textContent));
  await p.evaluate(() => { document.querySelector('.qe video').currentTime = 0.5; }); await p.waitForTimeout(300);
  await p.setInputFiles('.qe [data-r=ovFile]', { name: 'page.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }); await p.waitForSelector('.qe [data-o]');
  await p.click('.qe [data-a=ozoom]'); await p.waitForSelector('.qe .modal [data-z]');
  const bb = await (await p.$('.qe .modal [data-z]')).boundingBox(), k = Math.min(bb.width / 900, bb.height / 1600), ox = bb.x + (bb.width - 900 * k) / 2, oy = bb.y + (bb.height - 1600 * k) / 2;
  const setZ = (v) => p.evaluate((v) => { const s = document.querySelector('.qe .modal [data-zl]'); s.value = v; s.dispatchEvent(new Event('input')); }, v);
  await p.mouse.click(ox + 0.25 * 900 * k, oy + 0.25 * 1600 * k); await setZ(2.2); await p.click('.qe .modal [data-zx=add]');
  assert.match(await p.textContent('.qe .modal [data-zn]'), /Case 2/);
  await p.mouse.click(ox + 0.75 * 900 * k, oy + 0.75 * 1600 * k); await setZ(2.2); await p.click('.qe .modal [data-zx=ok]');
  const ov = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('gs.qe.')))).overlays[0]);
  console.log('parcours :', JSON.stringify(ov)); assert.equal(ov.path.length, 2); assert.ok(ov.end - ov.start >= 5.1, 'extrait allongé pour le parcours');
  assert.match(await p.textContent('.qe [data-o]'), /Parcours 2 cases/);
  await p.click('.qe [data-a=export]'); await p.click('.qe .modal [data-x=run]'); await p.waitForSelector('.qe .modal a[download]', { timeout: 90000 });
  const r = await p.evaluate(async (st) => {
    const a = document.querySelector('.qe .modal a[download]'), bl = await (await fetch(a.href)).blob(), mb = await import('/node_modules/.vite/deps/mediabunny.js');
    const i = new mb.Input({ source: new mb.BlobSource(bl), formats: mb.ALL_FORMATS }), sink = new mb.VideoSampleSink(await i.getPrimaryVideoTrack());
    const px = async (t) => { const s = await sink.getSample(t), c = new OffscreenCanvas(s.displayWidth, s.displayHeight), g = c.getContext('2d'); s.draw(g, 0, 0); s.close();
      const at = (fx, fy) => [...g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data.slice(0, 3)]; return [at(0.15, 0.15), at(0.85, 0.85)]; };
    return { page: await px(st + 0.5), c1: await px(st + 0.8 + 1.6), c2: await px(st + 0.8 + 2.2 + 1.8) };
  }, ov.start);
  console.log('export :', JSON.stringify(r));
  const near = (c, h) => { const t = { r: [224, 32, 32], g: [32, 192, 64], y: [240, 208, 32] }[h]; return c.every((v, j) => Math.abs(v - t[j]) < 45); };
  assert.ok(near(r.page[0], 'r') && near(r.page[1], 'y'), 'page entière au début');
  assert.ok(near(r.c1[0], 'r') && near(r.c1[1], 'r'), 'case 1 (rouge) plein cadre');
  assert.ok(near(r.c2[0], 'y') && near(r.c2[1], 'y'), 'case 2 (jaune) plein cadre');
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
