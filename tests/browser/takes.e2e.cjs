// Test navigateur « Meilleure prise » : node tests/browser/takes.e2e.cjs (serveur `npx vite --port 5173` lancé).
// Script dans le prompteur ; prise avec un ad-lib, une phrase ratée puis reprise, une phrase oubliée ; Whisper simulé.
const { chromium } = require('playwright'); const assert = require('assert');
const said = ['euh', 'attends', 'Salut', 'à', 'tous', "Aujourd'hui", 'on', 'parle', 'du', 'non', "Aujourd'hui", 'on', 'parle', 'du', 'nouveau', 'Spider-Man', 'voilà'];
let t = 0.2; const WORDS = said.map((x) => { const w = { text: x, start: +t.toFixed(2), end: +(t + 0.25).toFixed(2) }; t += 0.32; return w; });
const FAKE = `self.onmessage = (e) => { if (e.data.type === 'run') self.postMessage({ type: 'done', words: ${JSON.stringify(WORDS)} }); };`;
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 832 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await ctx.addInitScript(() => { localStorage.setItem('gs.q', 'fast'); localStorage.setItem('gs.cd', '0');
    localStorage.setItem('gs.script', "Salut à tous. Aujourd'hui on parle du nouveau Spider-Man. Abonnez-vous !");
    const f = MediaRecorder.isTypeSupported; MediaRecorder.isTypeSupported = (m) => !m.startsWith('video/mp4') && f.call(MediaRecorder, m); });
  await ctx.route(/transcribe\.worker/, (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await p.goto('http://localhost:5173/'); await p.click('#go'); await p.waitForSelector('#rec:not([hidden])', { timeout: 30000 });
  await p.click('#rec'); await p.waitForSelector('#recChip:not([hidden])', { timeout: 20000 }); await p.waitForTimeout(7000); await p.click('#rec');
  await p.waitForSelector('#pv:not([hidden])'); await p.click('#pvClean'); await p.waitForSelector('.qe .tx span', { timeout: 30000 });
  await p.waitForFunction(() => /[1-9]\d* coupe/.test(document.querySelector('.qe [data-r=status]').textContent), null, { timeout: 30000 });
  await p.waitForTimeout(500);
  const cut = await p.evaluate(() => [...document.querySelectorAll('.qe .tx span')].map((s) => (s.classList.contains('cut') ? 1 : 0)).join(''));
  console.log('mots coupés :', cut, '·', await p.textContent('.qe [data-r=status]'));
  // gardés : « Salut à tous » et la 2e tentative complète ; coupés : ad-lib, tentative ratée, « voilà »
  assert.equal(cut, '11000111110000001');
  await p.click('.qe [data-tab=sg]'); const card = await p.textContent('.qe .body .card'); console.log('bilan :', card.replace(/\s+/g, ' '));
  assert.match(card, /2 phrase\(s\) gardée\(s\), 1 reprise\(s\) retirée\(s\)/); assert.match(card, /Abonnez-vous/);
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
