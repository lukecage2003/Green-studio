// Test navigateur « Assembler des prises » : node tests/browser/assemble.e2e.cjs (serveur `npx vite --port 5173` lancé).
// Deux prises filmées (caméra et micro simulés) → Mes prises → ＋ ＋ → Assembler → le montage s'ouvre sur la somme des deux.
const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 832 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await ctx.addInitScript(() => { localStorage.setItem('gs.q', 'fast'); localStorage.setItem('gs.cd', '0'); localStorage.setItem('gs.autoClean', '0');
    const f = MediaRecorder.isTypeSupported; MediaRecorder.isTypeSupported = (m) => !m.startsWith('video/mp4') && f.call(MediaRecorder, m); });
  await ctx.route(/transcribe\.worker/, (r) => r.fulfill({ contentType: 'text/javascript', body: 'self.onmessage=()=>{}' }));
  await p.goto('http://localhost:5173/'); await p.click('#go'); await p.waitForSelector('#rec:not([hidden])', { timeout: 30000 });
  for (const ms of [3000, 4500]) {
    await p.click('#rec'); await p.waitForSelector('#recChip:not([hidden])', { timeout: 20000 }); await p.waitForTimeout(ms); await p.click('#rec');
    await p.waitForSelector('#pv:not([hidden])'); await p.click('#pvClose'); await p.waitForSelector('#pv', { state: 'hidden' });
  }
  await p.click('#bLib'); await p.waitForSelector('.lib [data-a=pick]');
  const n = await p.locator('.lib [data-a=pick]').count(); assert.equal(n, 2);
  const durs = [];
  for (const k of [0, 1]) { await p.locator('.lib [data-a=play]').nth(k).click(); await p.waitForSelector('#pv:not([hidden])');
    durs.push(await p.evaluate(async () => { const mb = await import('/node_modules/.vite/deps/mediabunny.js'), bl = await (await fetch(document.getElementById('pvVid').src)).blob();
      return new mb.Input({ source: new mb.BlobSource(bl), formats: mb.ALL_FORMATS }).computeDuration(); }));
    await p.click('#pvClose'); await p.waitForSelector('#pv', { state: 'hidden' }); }
  const sum = durs[0] + durs[1];
  // ordre : la plus ancienne d'abord (elle est en bas de la liste)
  await p.locator('.lib [data-a=pick]').nth(1).click(); await p.locator('.lib [data-a=pick]').nth(0).click();
  assert.deepEqual(await p.$$eval('.lib [data-a=pick]', (l) => l.map((x) => x.textContent)), ['2', '1']);
  console.log('prises :', durs, '·', await p.textContent('.lib [data-r=asm]'));
  await p.click('.lib [data-a=asm]'); await p.waitForSelector('.qe', { timeout: 120000 });
  await p.waitForFunction(() => /Montage \d/.test(document.querySelector('.qe [data-r=status]').textContent), null, { timeout: 60000 });
  const st = await p.textContent('.qe [data-r=status]'); console.log('montage :', st);
  const d = await p.evaluate(() => document.querySelector('.qe video').duration); console.log('durée assemblée :', d);
  assert.ok(Math.abs(d - sum) < 0.5, `durée ≈ somme des deux prises (${sum.toFixed(2)} s)`);
  // son présent tout du long (raccord inclus) et images des deux prises
  const r = await p.evaluate(async () => {
    const bl = await (await fetch(document.querySelector('.qe video').src)).blob(), mb = await import('/node_modules/.vite/deps/mediabunny.js');
    const i = new mb.Input({ source: new mb.BlobSource(bl), formats: mb.ALL_FORMATS }), a = await i.getPrimaryAudioTrack(), v = await i.getPrimaryVideoTrack();
    let frames = 0; for await (const s of new mb.VideoSampleSink(v).samples()) { frames++; s.close(); }
    return { audio: a ? await a.computeDuration() : 0, video: await v.computeDuration(), frames };
  });
  console.log('fichier :', r); assert.ok(r.audio > sum - 0.5 && Math.abs(r.audio - r.video) < 0.4, 'audio synchronisé sur toute la durée');
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
