// Test navigateur de l'app : node tests/browser/app.e2e.cjs (serveur `npx vite --port 5173` lancé). Caméra simulée ;
// Whisper simulé (le vrai modèle se télécharge depuis huggingface.co).
const { chromium } = require('playwright'); const assert = require('assert');
const WORDS = [['Bonjour', .2, .6], ['je', .7, .9], ['je', 1.0, 1.2], ['euh', 1.4, 1.8], ['vais', 1.9, 2.2], ['vous', 2.3, 2.5], ['montrer', 2.6, 3.0], ['ça', 4.8, 5.2]]
  .map(([text, start, end]) => ({ text, start, end }));
const FAKE_WORKER = `self.onmessage = (e) => { if (e.data.type !== 'run') return; self.postMessage({ type: 'loaded', device: 'wasm' });
  self.postMessage({ type: 'progress', p: .5, eta: 3 }); self.postMessage({ type: 'done', words: ${JSON.stringify(WORDS)}, n: e.data.audio.length }); };`;
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 400, height: 800 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'warning' && console.log('[warn]', m.text().slice(0, 300))); p.on('dialog', (d) => d.accept());
  // Le Chromium de test encode le H.264 mais ne sait pas le décoder (Chrome Android, si) : on enregistre en WebM pour
  // exercer l'export rapide WebCodecs ; le repli temps réel est testé ensuite avec le MP4.
  if (!process.env.MP4) await ctx.addInitScript(() => { const f = MediaRecorder.isTypeSupported; MediaRecorder.isTypeSupported = (m) => !m.startsWith('video/mp4') && f.call(MediaRecorder, m); });
  await ctx.route(/transcribe\.worker/, (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_WORKER }));
  await p.goto('http://localhost:5173/');
  await p.click('#go'); await p.waitForSelector('#rec:not([hidden])', { timeout: 30000 });
  await p.click('#rec'); await p.waitForTimeout(6000); await p.click('#rec');
  await p.waitForSelector('#pv:not([hidden])'); console.log('aperçu :', await p.textContent('#pvInfo'));
  await p.click('#pvEdit'); await p.waitForSelector('.qe');
  await p.waitForFunction(() => /Montage \d/.test(document.querySelector('.qe [data-r=status]').textContent), null, { timeout: 15000 });
  await p.click('.qe [data-a=transcribe]'); await p.waitForSelector('.qe .tx span');
  assert.equal(await p.locator('.qe .tx span').count(), WORDS.length);
  await p.click('.qe [data-tab=sg]'); const n = await p.locator('.qe .sg').count();
  const types = await p.locator('.qe .sg b').allTextContents(); console.log('suggestions :', types);
  assert.ok(n >= 3, 'répétition + hésitation + silence');
  await p.click('.qe [data-a=safe]'); const st1 = await p.textContent('.qe [data-r=status]'); console.log('après « sûres » :', st1);
  await p.click('.qe [data-a=undo]'); assert.match(await p.textContent('.qe [data-r=status]'), /0 coupe/);
  await p.click('.qe [data-a=redo]'); assert.equal(await p.textContent('.qe [data-r=status]'), st1);
  await p.click('.qe [data-tab=tx]'); await p.click('.qe .tx span[data-i="4"]'); await p.click('.qe .tx span[data-i="5"]');
  assert.match(await p.textContent('.qe .selbar span'), /2 mots · vais vous/);
  await p.click('.qe [data-a=cutSel]'); assert.equal(await p.locator('.qe .tx span.cut').count() >= 4, true);
  const st2 = await p.textContent('.qe [data-r=status]'); console.log('après coupe manuelle :', st2);
  await p.screenshot({ path: process.argv[2] || 'qe.png' });
  await p.click('.qe [data-a=export]'); await p.waitForSelector('.qe .modal a[download]', { timeout: 30000 });
  console.log('export :', await p.textContent('.qe .modal p'));
  const outDur = await p.evaluate(async () => { const a = document.querySelector('.qe .modal a[download]'); const bl = await (await fetch(a.href)).blob();
    const m = await import('/src/core/media.ts'); return (await m.probe(bl)).duration; });
  const edited = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('gs.qe.')))));
  const expect = edited.duration - edited.cuts.reduce((s, c) => s + c.end - c.start, 0);
  console.log(`durée exportée ${outDur.toFixed(2)} s, attendue ${expect.toFixed(2)} s`); assert.ok(Math.abs(outDur - expect) < (process.env.MP4 ? 0.25 : 0.1));
  await p.click('.qe .modal [data-x=ok]'); await p.click('.qe [data-a=close]'); assert.equal(await p.locator('.qe').count(), 0);
  // persistance : rouvrir retrouve transcription et coupes
  await p.click('#pvEdit'); await p.waitForSelector('.qe .tx span'); assert.match(await p.textContent('.qe [data-r=status]'), new RegExp(st2.match(/(\d+) coupe/)[1] + ' coupe'));
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
