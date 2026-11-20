// Test navigateur « Workflow » : habillage dit à voix haute (classement, concept, univers, frise), vérification express des raccords, publication TikTok (légende copiée).
// node tests/browser/workflow.e2e.cjs (serveur `npx vite --port 5173` lancé).
const { chromium } = require('playwright'); const assert = require('assert');
const said = 'En numéro 3, Venom qui a tout changé. euh Numéro deux : Carnage. Mais c\'est quoi la Force Phénix ? euh Une entité cosmique. Sur Terre-616 tout change, comme dans Amazing Spider-Man #300. Il apparaît en 1984 dans Secret Wars, puis en 1988 comme Venom.'.split(' ');
let t = 0.6; const WORDS = said.map((x) => { const w = { text: x, start: +t.toFixed(2), end: +(t + 0.26).toFixed(2) }; t += x === 'euh' ? 1.1 : 0.36; return w; });
const FAKE = `self.onmessage = (e) => { if (e.data.type === 'run') self.postMessage({ type: 'done', words: ${JSON.stringify(WORDS)} }); };`;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, permissions: ['clipboard-read', 'clipboard-write'] }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept(d.defaultValue()));
  await ctx.addInitScript(() => { localStorage.setItem('gs.autoClean', '0'); localStorage.setItem('gs.onb', '1'); });
  await ctx.route(/transcribe\.worker/, (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await p.goto('http://localhost:5173/');
  const vid = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 360; c.height = 640; const x = c.getContext('2d'); const st = c.captureStream(30);
    const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); d.stream.getAudioTracks().forEach((t) => st.addTrack(t));
    const rec = new MediaRecorder(st, { mimeType: 'video/webm;codecs=vp9,opus' }), parts = []; rec.ondataavailable = (e) => parts.push(e.data);
    const draw = () => { x.fillStyle = '#204060'; x.fillRect(0, 0, 360, 640); if (rec.state === 'recording') requestAnimationFrame(draw); }; rec.start(); draw();
    await new Promise((r) => setTimeout(r, 15500)); const s = new Promise((r) => (rec.onstop = r)); rec.stop(); await s;
    const u = new Uint8Array(await new Blob(parts).arrayBuffer()); let str = ''; for (let k = 0; k < u.length; k += 0x8000) str += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000)); return btoa(str);
  });
  await p.setInputFiles('#editFile', { name: 'workflow.webm', mimeType: 'video/webm', buffer: Buffer.from(vid, 'base64') });
  await p.waitForSelector('.qe'); await p.waitForFunction(() => /Montage \d/.test(document.querySelector('.qe [data-r=status]').textContent));
  await p.click('.qe [data-a=transcribe]'); await p.waitForSelector('.qe .tx span[data-i]');
  const saved = () => p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('gs.qe.')))));
  // 1. habillage repéré dans la voix
  await p.click('.qe [data-tab=dress]'); await p.waitForSelector('.qe [data-spoken]');
  console.log('repéré :', (await p.textContent('.qe [data-spoken]')).replace(/\s+/g, ' '));
  await p.click('.qe [data-a=spokenAll]'); let s = await saved();
  console.log('titres :', JSON.stringify(s.titles.map((x) => [x.kind, x.sub, x.text])));
  assert.deepEqual(s.titles.filter((x) => x.kind === 'rank').map((x) => x.sub + ' ' + x.text), ['3 Venom', '2 Carnage']);
  assert.ok(s.titles.some((x) => x.kind === 'term' && x.text === 'Force Phénix') && s.titles.some((x) => x.kind === 'tag' && x.text === 'Terre-616') && s.titles.some((x) => x.kind === 'timeline'));
  assert.equal(await p.$('.qe [data-spoken]'), null, 'plus rien à placer');
  assert.ok(s.titles.some((x) => x.kind === 'tag' && x.sub === 'Source' && x.text === 'Amazing Spider-Man #300'), 'source repérée');
  // schéma de relations, divergence, « À retenir » (valeurs proposées acceptées)
  for (const k of ['graph', 'branch', 'recap']) { await p.evaluate(() => { document.querySelector('.qe video').currentTime = 2; }); await p.click(`.qe .tiles [data-a=${k}]`); }
  s = await saved(); const g = s.titles.find((x) => x.kind === 'graph'), br = s.titles.find((x) => x.kind === 'branch'), rc = s.titles.find((x) => x.kind === 'recap');
  console.log('schémas :', JSON.stringify([g?.sub, br?.sub, rc?.sub]));
  assert.match(g.sub, /Jean Grey/); assert.match(br.sub, /Terre-616/); assert.match(rc.sub, /Force Phénix/);
  // 2. coupes (les « euh ») puis vérification express des raccords
  await p.click('.qe .tbar [data-a=clean]'); await p.waitForFunction(() => /[1-9]\d* coupe/.test(document.querySelector('.qe [data-r=status]').textContent), null, { timeout: 30000 });
  s = await saved(); const n0 = s.cuts.filter((c) => c.start > 0.05 && c.end < 15.4).length; console.log('coupes internes :', n0); assert.ok(n0 >= 2);
  await p.click('.qe .tbar [data-a=review]'); await p.waitForSelector('.qe .revbar'); console.log('barre :', await p.textContent('.qe .revbar span'));
  assert.match(await p.textContent('.qe .revbar span'), new RegExp(`Raccord 1 / ${n0}`));
  await p.waitForFunction(() => /Raccord 2/.test(document.querySelector('.qe .revbar span')?.textContent ?? ''), null, { timeout: 15000 }); // enchaînement automatique
  await p.click('.qe .revbar [data-a=revUndo]'); s = await saved(); assert.equal(s.cuts.filter((c) => c.start > 0.05 && c.end < 15.4).length, n0 - 1, 'coupe annulée');
  if (await p.$('.qe .revbar')) await p.click('.qe .revbar [data-a=revStop]'); assert.equal(await p.$('.qe .revbar'), null);
  // 3. export puis « Publier sur TikTok » : légende + hashtags copiés
  await p.click('.qe [data-a=export]'); await p.click('.qe .modal [data-x=run]'); await p.waitForSelector('.qe .modal [data-x=tiktok]', { timeout: 150000 });
  await p.click('.qe .modal [data-x=tiktok]'); await p.waitForFunction(() => /Légende copiée/.test(document.querySelector('.qe .modal [data-r=ttcap]')?.textContent ?? ''));
  const clip = await p.evaluate(() => navigator.clipboard.readText()); console.log('légende :', clip);
  assert.match(clip, /#comics/); assert.match(clip, /#pourtoi/);
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
