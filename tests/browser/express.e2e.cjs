// Test navigateur « Express » : node tests/browser/express.e2e.cjs (serveur `npx vite --port 5173` lancé).
// Prise filmée → ⚡ Express → transcription (Whisper simulé), nettoyage, export et enregistrement, sans autre geste.
const { chromium } = require('playwright'); const assert = require('assert');
let t = 0.4; const WORDS = ['Salut', 'euh', 'à', 'tous', 'on', 'parle', 'du', 'film'].map((x) => { const w = { text: x, start: +t.toFixed(2), end: +(t + 0.25).toFixed(2) }; t += x === 'tous' ? 1.4 : 0.35; return w; });
const FAKE = `self.onmessage = (e) => { if (e.data.type === 'run') self.postMessage({ type: 'done', words: ${JSON.stringify(WORDS)} }); };`;
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 832 }, acceptDownloads: true }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await ctx.addInitScript(() => { localStorage.setItem('gs.q', 'fast'); localStorage.setItem('gs.cd', '0'); localStorage.setItem('gsHint', '1');
    const f = MediaRecorder.isTypeSupported; MediaRecorder.isTypeSupported = (m) => !m.startsWith('video/mp4') && f.call(MediaRecorder, m); });
  await ctx.route(/transcribe\.worker/, (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await p.goto('http://localhost:5173/'); await p.click('#go'); await p.waitForSelector('#rec:not([hidden])', { timeout: 30000 });
  await p.click('#rec'); await p.waitForSelector('#recChip:not([hidden])', { timeout: 20000 }); await p.waitForTimeout(6000); await p.click('#rec');
  await p.waitForSelector('#pv:not([hidden])');
  const dl = p.waitForEvent('download', { timeout: 120000 });
  await p.click('#pvExpress');
  await p.waitForFunction(() => /Vidéo prête/.test(document.querySelector('.qe .modal')?.textContent ?? ''), null, { timeout: 120000 });
  const d = await dl; console.log('fichier enregistré :', d.suggestedFilename());
  const st = await p.textContent('.qe [data-r=status]'); console.log('montage :', st);
  assert.match(st, /[1-9]\d* coupe/, 'nettoyage appliqué avant l’export'); assert.match(d.suggestedFilename(), /green-studio-montage-.*\.(mp4|webm)$/);
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
