// Test navigateur « Mes mots, banque d'images, accroche » : node tests/browser/tools.e2e.cjs (serveur `npx vite --port 5173` lancé).
const { chromium } = require('playwright'); const assert = require('assert');
const said = ['Salut', 'à', 'tous.', 'Voici', 'Iron', 'Man', 'contre', 'korvak,', 'un', 'combat', 'incroyable.', 'Pourquoi', 'korvak', 'est', 'si', 'fort ?'];
let t = 0.3; const WORDS = said.map((x) => { const w = { text: x, start: +t.toFixed(2), end: +(t + 0.28).toFixed(2) }; t += 0.4; return w; });
const FAKE = `self.onmessage = (e) => { if (e.data.type === 'run') self.postMessage({ type: 'done', words: ${JSON.stringify(WORDS)} }); };`;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 384, height: 832 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept(/Quel mot/.test(d.message()) ? 'Iron Man' : undefined));
  await ctx.addInitScript(() => { localStorage.setItem('gs.autoClean', '0'); if (!localStorage.getItem('gs.dict')) localStorage.setItem('gs.dict', JSON.stringify([{ from: 'korvak', to: 'Korvac' }])); });
  await ctx.route(/transcribe\.worker/, (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await p.goto('http://localhost:5173/');
  const [vid, png] = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 180; c.height = 320; const x = c.getContext('2d'); const st = c.captureStream(30);
    const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); d.stream.getAudioTracks().forEach((t) => st.addTrack(t));
    const rec = new MediaRecorder(st, { mimeType: 'video/webm;codecs=vp9,opus' }), parts = []; rec.ondataavailable = (e) => parts.push(e.data);
    const draw = () => { x.fillStyle = '#1a8a3a'; x.fillRect(0, 0, 180, 320); if (rec.state === 'recording') requestAnimationFrame(draw); }; rec.start(); draw();
    await new Promise((r) => setTimeout(r, 7500)); const s = new Promise((r) => (rec.onstop = r)); rec.stop(); await s;
    const i = document.createElement('canvas'); i.width = 200; i.height = 200; const g = i.getContext('2d'); g.fillStyle = '#ff00ff'; g.fillRect(0, 0, 200, 200);
    const b64 = async (bl) => { const u = new Uint8Array(await bl.arrayBuffer()); let s2 = ''; for (let k = 0; k < u.length; k += 0x8000) s2 += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000)); return btoa(s2); };
    return [await b64(new Blob(parts)), await b64(await new Promise((r) => i.toBlob(r, 'image/png')))];
  });
  await p.setInputFiles('#editFile', { name: 'outils.webm', mimeType: 'video/webm', buffer: Buffer.from(vid, 'base64') });
  await p.waitForSelector('.qe'); await p.waitForFunction(() => /Montage \d/.test(document.querySelector('.qe [data-r=status]').textContent));
  await p.click('.qe [data-a=transcribe]'); await p.waitForSelector('.qe .tx span[data-i]');
  // 1. Mes mots : « korvak » corrigé partout
  const text = (await p.$$eval('.qe .tx span[data-i]', (l) => l.map((x) => x.textContent))).join(' '); console.log('texte :', text);
  assert.match(text, /contre Korvac,/); assert.match(text, /Pourquoi Korvac est/); assert.ok(!/korvak/i.test(text));
  assert.match(await p.textContent('.qe [data-dict]'), /korvak → Korvac/);
  // 2. Banque d'images : « Iron Man » → image placée au moment où c'est dit
  await p.click('.qe [data-tab=dress]'); await p.setInputFiles('.qe [data-r=bankFile]', { name: 'iron-man.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await p.waitForSelector('.qe [data-a=bankAuto]'); await p.click('.qe [data-a=bankAuto]'); await p.waitForSelector('.qe [data-o]');
  const ov = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('gs.qe.')))).overlays); console.log('image placée :', JSON.stringify(ov));
  const iron = WORDS[4].start; assert.equal(ov.length, 1); assert.ok(Math.abs(ov[0].start - iron) < 0.01 && ov[0].mode === 'pip');
  // 3. Accroche : la question est rejouée en ouverture → export plus long de sa durée
  await p.click('.qe [data-a=pub]'); await p.waitForSelector('.qe .modal [data-x=hook]'); const hk = await p.getAttribute('.qe .modal [data-x=hook]', 'data-v'); console.log('accroche :', hk);
  await p.click('.qe .modal [data-x=hook]'); await p.click('.qe .modal [data-x=ok]');
  assert.match(await p.textContent('.qe [data-r=status]'), /accroche en ouverture/);
  const dur = await p.evaluate(() => document.querySelector('.qe video').duration);
  await p.click('.qe [data-a=export]'); await p.click('.qe .modal [data-x=run]'); await p.waitForSelector('.qe .modal a[download]', { timeout: 90000 });
  const out = await p.evaluate(async () => { const a = document.querySelector('.qe .modal a[download]'), bl = await (await fetch(a.href)).blob(), mb = await import('/node_modules/.vite/deps/mediabunny.js');
    const i = new mb.Input({ source: new mb.BlobSource(bl), formats: mb.ALL_FORMATS }); const s = await new mb.VideoSampleSink(await i.getPrimaryVideoTrack()).getSample(0.4);
    const c = new OffscreenCanvas(s.displayWidth, s.displayHeight), g = c.getContext('2d'); s.draw(g, 0, 0); s.close(); return { d: await i.computeDuration(), px: [...g.getImageData(c.width / 2, c.height * 0.92, 1, 1).data.slice(0, 3)] }; });
  const hook = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('gs.qe.')))).hook);
  console.log('durée source', dur.toFixed(2), '· accroche', JSON.stringify(hook), '· export', out.d.toFixed(2));
  assert.ok(hook && Math.abs(out.d - (dur + hook.end - hook.start)) < 0.4, 'export = montage + accroche');
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
