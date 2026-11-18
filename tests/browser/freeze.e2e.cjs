// Test navigateur « Pause + zoom » : node tests/browser/freeze.e2e.cjs (serveur `npx vite --port 5173` lancé).
// Vidéo moitié rouge / moitié bleue dont la teinte change à chaque image → arrêt sur image à 3 s avec zoom 3× sur la moitié rouge
// → export : 2 s de plus, image figée (identique d'une image à l'autre), zoomée (rouge partout), puis la vidéo reprend.
const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 384, height: 832 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await ctx.addInitScript(() => localStorage.setItem('gs.autoClean', '0'));
  await p.goto('http://localhost:5173/');
  const vid = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 360; c.height = 640; const x = c.getContext('2d'); const st = c.captureStream(30);
    const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); d.stream.getAudioTracks().forEach((t) => st.addTrack(t));
    const rec = new MediaRecorder(st, { mimeType: 'video/webm;codecs=vp9,opus' }), parts = []; rec.ondataavailable = (e) => parts.push(e.data);
    const t0 = performance.now(); const draw = () => { const k = (performance.now() - t0) / 1000; x.fillStyle = `rgb(220,${Math.round(20 + 15 * (k % 4))},20)`; x.fillRect(0, 0, 180, 640);
      x.fillStyle = `rgb(20,40,${Math.round(150 + 20 * (k % 4))})`; x.fillRect(180, 0, 180, 640); if (rec.state === 'recording') requestAnimationFrame(draw); }; rec.start(); draw();
    await new Promise((r) => setTimeout(r, 6000)); const s = new Promise((r) => (rec.onstop = r)); rec.stop(); await s;
    const u = new Uint8Array(await new Blob(parts).arrayBuffer()); let str = ''; for (let k = 0; k < u.length; k += 0x8000) str += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000)); return btoa(str);
  });
  await p.setInputFiles('#editFile', { name: 'pause.webm', mimeType: 'video/webm', buffer: Buffer.from(vid, 'base64') });
  await p.waitForSelector('.qe'); await p.waitForFunction(() => /Montage \d/.test(document.querySelector('.qe [data-r=status]').textContent));
  const dur = await p.evaluate(() => document.querySelector('.qe video').duration);
  // loupe de l'aperçu : double-tap → 2,5×, bouton → 1×
  const vb = await (await p.$('.qe .vw')).boundingBox(); await p.mouse.dblclick(vb.x + vb.width * 0.3, vb.y + vb.height * 0.4);
  const tr = await p.$eval('.qe .vwz', (e) => e.style.transform); console.log('loupe :', tr); assert.match(tr, /scale\(2\.5\)/);
  await p.click('.qe [data-a=vzReset]'); assert.equal(await p.$eval('.qe .vwz', (e) => e.style.transform), '');
  await p.evaluate(() => { const v = document.querySelector('.qe video'); v.currentTime = 3; }); await p.waitForTimeout(500);
  // outil de cadrage : toucher le quart gauche (moitié rouge), zoom 3×, valider
  await p.click('.qe [data-a=freezeAdd]'); await p.waitForSelector('.qe .modal [data-z]');
  const bb = await (await p.$('.qe .modal [data-z]')).boundingBox(), k = Math.min(bb.width / 360, bb.height / 640), ox = (bb.width - 360 * k) / 2, oy = (bb.height - 640 * k) / 2;
  await p.mouse.click(bb.x + ox + 0.2 * 360 * k, bb.y + oy + 0.5 * 640 * k);
  await p.evaluate(() => { const s = document.querySelector('.qe .modal [data-zl]'); s.value = 3; s.dispatchEvent(new Event('input')); });
  await p.click('.qe .modal [data-zx=ok]');
  const fz = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('gs.qe.')))).freezes);
  console.log('arrêt sur image :', JSON.stringify(fz)); assert.equal(fz.length, 1); assert.ok(Math.abs(fz[0].at - 3) < 0.05 && fz[0].zoom.z === 3 && fz[0].zoom.x < 0.3);
  assert.match(await p.textContent('.qe [data-r=status]'), /1 arrêt\(s\) sur image/);
  // aperçu : la lecture se fige puis repart
  await p.evaluate(() => { const v = document.querySelector('.qe video'); v.currentTime = 2.6; }); await p.waitForTimeout(300); await p.click('.qe [data-a=play]');
  await p.waitForFunction(() => document.querySelector('.qe video').currentTime >= 3, null, { timeout: 5000 }); await p.waitForTimeout(800);
  const held = await p.evaluate(() => ({ t: document.querySelector('.qe video').currentTime, paused: document.querySelector('.qe video').paused, btn: document.querySelector('.qe [data-a=play]').textContent }));
  console.log('aperçu pendant l’arrêt :', JSON.stringify(held)); assert.ok(held.paused && held.t < 3.2 && held.btn === '⏸', 'figé, bouton toujours en lecture');
  await p.waitForFunction(() => document.querySelector('.qe video').currentTime > 3.4, null, { timeout: 6000 }); await p.click('.qe [data-a=play]');
  // extrait vidéo inséré (le même clip) : figé à 1,5 s de la vidéo, zoom 3× sur sa moitié rouge
  await p.evaluate(() => { const v = document.querySelector('.qe video'); v.currentTime = 0.5; }); await p.waitForTimeout(300);
  await p.setInputFiles('.qe [data-r=ovFile]', { name: 'extrait.webm', mimeType: 'video/webm', buffer: Buffer.from(vid, 'base64') }); await p.waitForSelector('.qe [data-o]');
  await p.evaluate(() => { const v = document.querySelector('.qe video'); v.currentTime = 1.5; }); await p.waitForTimeout(300);
  for (let k = 0; k < 6; k++) { await p.click('.qe [data-a=ominus]'); await p.waitForTimeout(150); } // extrait raccourci : 0,5 → ~3 s
  await p.click('.qe [data-a=ofreeze]'); await p.click('.qe [data-a=ozoom]'); await p.waitForSelector('.qe .modal [data-z]');
  const ob = await (await p.$('.qe .modal [data-z]')).boundingBox(), ok2 = Math.min(ob.width / 360, ob.height / 640);
  await p.mouse.click(ob.x + (ob.width - 360 * ok2) / 2 + 0.2 * 360 * ok2, ob.y + ob.height / 2);
  await p.evaluate(() => { const s = document.querySelector('.qe .modal [data-zl]'); s.value = 3; s.dispatchEvent(new Event('input')); }); await p.click('.qe .modal [data-zx=ok]');
  const ovs = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('gs.qe.')))).overlays);
  console.log('extrait :', JSON.stringify(ovs)); assert.ok(Math.abs(ovs[0].freeze - 1) < 0.05 && ovs[0].zoom.z === 3);
  // export
  await p.click('.qe [data-a=export]'); await p.click('.qe .modal [data-x=run]'); await p.waitForSelector('.qe .modal a[download]', { timeout: 90000 });
  const r = await p.evaluate(async () => {
    const a = document.querySelector('.qe .modal a[download]'), bl = await (await fetch(a.href)).blob(), mb = await import('/node_modules/.vite/deps/mediabunny.js');
    const i = new mb.Input({ source: new mb.BlobSource(bl), formats: mb.ALL_FORMATS }), sink = new mb.VideoSampleSink(await i.getPrimaryVideoTrack());
    const px = async (t) => { const s = await sink.getSample(t), c = new OffscreenCanvas(s.displayWidth, s.displayHeight), g = c.getContext('2d'); s.draw(g, 0, 0); s.close();
      const at = (fx) => [...g.getImageData(Math.round(c.width * fx), Math.round(c.height * 0.5), 1, 1).data.slice(0, 3)]; return { left: at(0.1), right: at(0.9) }; };
    return { d: await i.computeDuration(), o1: await px(2.3), o2: await px(2.7), before: await px(0.3), z1: await px(4.2), z2: await px(4.8), after: await px(7.6) };
  });
  console.log('export :', JSON.stringify(r));
  assert.ok(Math.abs(r.d - (dur + 2)) < 0.3, 'export = vidéo + 2 s d’arrêt');
  const red = (c) => c[0] > 150 && c[2] < 90, blue = (c) => c[2] > 110 && c[0] < 90;
  assert.ok(red(r.before.left) && blue(r.before.right), 'avant : moitié rouge / moitié bleue');
  assert.ok(red(r.z1.left) && red(r.z1.right), 'pendant l’arrêt : zoomé sur la moitié rouge');
  assert.ok(Math.abs(r.z1.left[1] - r.z2.left[1]) <= 6, 'image figée (même teinte 0,6 s plus tard)');
  assert.ok(red(r.after.left) && blue(r.after.right), 'après : la vidéo reprend, sans zoom');
  assert.ok(red(r.o1.left) && red(r.o1.right) && Math.abs(r.o1.left[1] - r.o2.left[1]) <= 6, 'extrait : figé et zoomé sur sa moitié rouge');
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
