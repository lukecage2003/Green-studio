// Test navigateur « Annoter, onomatopées, miniature » : node tests/browser/marks.e2e.cjs (serveur `npx vite --port 5173` lancé).
const { chromium } = require('playwright'); const assert = require('assert');
const said = ['Et', 'là', 'boum', 'le', 'Hulk', 'arrive', 'et', 'franchement', 'c\'est', 'incroyable', 'regardez', 'ce', 'détail', 'ici.'];
let t = 0.4; const WORDS = said.map((x) => { const w = { text: x, start: +t.toFixed(2), end: +(t + 0.28).toFixed(2) }; t += 0.45; return w; });
const FAKE = `self.onmessage = (e) => { if (e.data.type === 'run') self.postMessage({ type: 'done', words: ${JSON.stringify(WORDS)} }); };`;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, acceptDownloads: true }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept(/miniature/i.test(d.message()) ? 'La théorie Hulk' : undefined));
  await ctx.addInitScript(() => { localStorage.setItem('gs.autoClean', '0'); localStorage.setItem('gs.onb', '1'); });
  await ctx.route(/transcribe\.worker/, (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await p.goto('http://localhost:5173/');
  const vid = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 360; c.height = 640; const x = c.getContext('2d'); const st = c.captureStream(30);
    const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); d.stream.getAudioTracks().forEach((t) => st.addTrack(t));
    const rec = new MediaRecorder(st, { mimeType: 'video/webm;codecs=vp9,opus' }), parts = []; rec.ondataavailable = (e) => parts.push(e.data);
    const draw = () => { x.fillStyle = '#204060'; x.fillRect(0, 0, 360, 640); if (rec.state === 'recording') requestAnimationFrame(draw); }; rec.start(); draw();
    await new Promise((r) => setTimeout(r, 7500)); const s = new Promise((r) => (rec.onstop = r)); rec.stop(); await s;
    const u = new Uint8Array(await new Blob(parts).arrayBuffer()); let str = ''; for (let k = 0; k < u.length; k += 0x8000) str += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000)); return btoa(str);
  });
  await p.setInputFiles('#editFile', { name: 'marques.webm', mimeType: 'video/webm', buffer: Buffer.from(vid, 'base64') });
  await p.waitForSelector('.qe'); await p.waitForFunction(() => /Montage \d/.test(document.querySelector('.qe [data-r=status]').textContent));
  await p.click('.qe [data-a=transcribe]'); await p.waitForSelector('.qe .tx span[data-i]');
  const saved = () => p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('gs.qe.')))));
  // 1. onomatopées dites
  await p.click('.qe [data-tab=dress]'); await p.waitForSelector('.qe [data-a=sfxAuto]'); await p.click('.qe [data-a=sfxAuto]');
  let s = await saved(); console.log('onomatopées :', JSON.stringify(s.marks.map((m) => [m.text, m.start]))); assert.equal(s.marks.length, 1); assert.equal(s.marks[0].text, 'BOOM !');
  // 2. flèche dessinée à 4 s : du bas gauche vers le centre
  await p.evaluate(() => { document.querySelector('.qe video').currentTime = 4; }); await p.waitForTimeout(400);
  await p.click('.qe .tbar [data-a=annot]'); await p.waitForSelector('.qe .modal [data-mz]');
  const bb = await (await p.$('.qe .modal [data-mz]')).boundingBox(), k = Math.min(bb.width / 360, bb.height / 640), ox = bb.x + (bb.width - 360 * k) / 2, oy = bb.y + (bb.height - 640 * k) / 2;
  await p.mouse.move(ox + 0.2 * 360 * k, oy + 0.8 * 640 * k); await p.mouse.down(); await p.mouse.move(ox + 0.5 * 360 * k, oy + 0.5 * 640 * k, { steps: 8 }); await p.mouse.up();
  await p.click('.qe .modal [data-mx=ok]');
  s = await saved(); const ar = s.marks.find((m) => m.type === 'arrow'); console.log('flèche :', JSON.stringify(ar)); assert.ok(ar && Math.abs(ar.x2 - 0.5) < 0.06 && Math.abs(ar.y2 - 0.5) < 0.07 && Math.abs(ar.start - 4) < 0.05);
  assert.match(await p.textContent('.qe .body'), /Flèche/);
  // 3. export : onomatopée (jaune / rouge) et flèche (jaune) gravées
  await p.click('.qe [data-a=export]'); await p.click('.qe .modal [data-x=run]'); await p.waitForSelector('.qe .modal a[download]', { timeout: 90000 });
  const r = await p.evaluate(async ([sfxT, arT]) => {
    const a = document.querySelector('.qe .modal a[download]'), bl = await (await fetch(a.href)).blob(), mb = await import('/node_modules/.vite/deps/mediabunny.js');
    const i = new mb.Input({ source: new mb.BlobSource(bl), formats: mb.ALL_FORMATS }), sink = new mb.VideoSampleSink(await i.getPrimaryVideoTrack());
    const yellow = async (t, fx0, fx1, fy0, fy1) => { const s = await sink.getSample(t), c = new OffscreenCanvas(s.displayWidth, s.displayHeight), g = c.getContext('2d'); s.draw(g, 0, 0); s.close();
      const d = g.getImageData(Math.round(c.width * fx0), Math.round(c.height * fy0), Math.round(c.width * (fx1 - fx0)), Math.round(c.height * (fy1 - fy0))).data; let n = 0;
      for (let q = 0; q < d.length; q += 4) if (d[q] > 200 && d[q + 1] > 170 && d[q + 2] < 90) n++; return n; };
    return { sfx: await yellow(sfxT + 0.5, 0.05, 0.55, 0.1, 0.4), sfxAvant: await yellow(0.1, 0.05, 0.55, 0.1, 0.4), arrow: await yellow(arT + 1, 0.15, 0.55, 0.45, 0.85) };
  }, [s.marks.find((m) => m.type === 'sfx').start, ar.start]);
  console.log('pixels jaunes :', JSON.stringify(r)); assert.ok(r.sfx > 500 && r.sfxAvant === 0, 'onomatopée gravée'); assert.ok(r.arrow > 200, 'flèche gravée');
  await p.click('.qe .modal [data-x=ok]');
  // 4. miniature
  await p.click('.qe .tbar [data-a=pub]'); await p.waitForSelector('.qe .modal [data-x=thumb]', { timeout: 15000 });
  const dl = p.waitForEvent('download'); await p.click('.qe .modal [data-x=thumb]'); const f = await dl; console.log('miniature :', f.suggestedFilename());
  assert.match(f.suggestedFilename(), /miniature.*\.png$/);
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
