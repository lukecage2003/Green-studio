// Test navigateur avec la VRAIE transcription (Whisper ONNX via transformers.js, dans le worker de l'app).
// Usage : ASR_MODELS=<dossier contenant whisper-base/ et whisper-small/> ASR_VIDEO=<vidéo .mp4> node tests/browser/asr-real.e2e.cjs
// Les téléchargements (Hugging Face, jsDelivr) sont servis depuis des fichiers locaux : utile hors ligne et en intégration continue.
const { chromium } = require('playwright'); const assert = require('assert'); const fs = require('fs'); const path = require('path');
const MODELS = process.env.ASR_MODELS, VIDEO = process.env.ASR_VIDEO, VERBATIM = process.env.ASR_VERBATIM !== '0';
if (!MODELS || !VIDEO) { console.log('ASR_MODELS et ASR_VIDEO requis : test ignoré'); process.exit(0); }
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errs = [], served = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await ctx.addInitScript((v) => { localStorage.setItem('gs.autoClean', '0'); localStorage.setItem('gs.verbatim', v ? '1' : '0'); }, VERBATIM);
  await ctx.route(/huggingface\.co\/onnx-community\/whisper-(base|small)_timestamped\/resolve\/[^/]+\/(.+)$/, (r) => {
    const m = r.request().url().match(/whisper-(base|small)_timestamped\/resolve\/[^/]+\/(.+)$/), f = path.join(MODELS, 'whisper-' + m[1], decodeURIComponent(m[2]));
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'absent' }); served.push(path.basename(f)); r.fulfill({ body: fs.readFileSync(f) });
  });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@[^/]+\/dist\/(.+)$/, (r) => {
    const f = path.join(__dirname, '../../node_modules/@huggingface/transformers/dist', r.request().url().split('/dist/')[1]);
    r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
  });
  await p.goto('http://localhost:5173/'); await p.setInputFiles('#editFile', VIDEO); await p.waitForSelector('.qe');
  await p.waitForFunction(() => /Montage \d/.test(document.querySelector('.qe [data-r=status]').textContent), null, { timeout: 60000 });
  const t0 = Date.now(); await p.click('.qe [data-a=transcribe]');
  await p.waitForFunction(() => document.querySelectorAll('.qe .tx span[data-i]').length > 0 || /Échec|Impossible/.test(document.querySelector('.qe .body').textContent), null, { timeout: 900000 });
  const text = (await p.$$eval('.qe .tx span[data-i]', (l) => l.map((x) => x.textContent))).join(' ');
  console.log(`transcription (${((Date.now() - t0) / 1000).toFixed(0)} s, ${VERBATIM ? 'mot pour mot' : 'classique'}) :`, text); console.log('fichiers servis :', [...new Set(served)].join(', '));
  assert.ok(text.split(' ').length > 10, 'la transcription produit du texte');
  await p.click('.qe [data-tab=sg]'); await p.waitForTimeout(500);
  await p.click('.qe [data-a=clean]'); await p.waitForTimeout(800); console.log('après « Tout supprimer » :', await p.textContent('.qe [data-r=status]'));
  await p.click('.qe [data-tab=tx]'); await p.waitForTimeout(400);
  const kept = (await p.$$eval('.qe .tx span[data-i]', (l) => l.filter((x) => !x.classList.contains('cut')).map((x) => x.textContent))).join(' ');
  console.log('texte gardé :', kept);
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
