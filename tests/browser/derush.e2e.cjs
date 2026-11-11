// Test navigateur « Dérush » : node tests/browser/derush.e2e.cjs (serveur `npx vite --port 5173` lancé).
// Timeline : scinder, sélectionner un clip, le supprimer, restaurer la coupe, rogner un clip à la poignée, annuler.
const { chromium } = require('playwright'); const assert = require('assert');
let t = 0.3; const WORDS = Array.from({ length: 16 }, (_, i) => { const w = { text: 'mot' + i, start: +t.toFixed(2), end: +(t + 0.3).toFixed(2) }; t += 0.45; return w; });
const FAKE = `self.onmessage = (e) => { if (e.data.type === 'run') self.postMessage({ type: 'done', words: ${JSON.stringify(WORDS)} }); };`;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 384, height: 832 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await ctx.addInitScript(() => localStorage.setItem('gs.autoClean', '0'));
  await ctx.route(/transcribe\.worker/, (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await p.goto('http://localhost:5173/');
  const vid = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 180; c.height = 320; const x = c.getContext('2d'); const st = c.captureStream(30);
    const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); d.stream.getAudioTracks().forEach((t) => st.addTrack(t));
    const rec = new MediaRecorder(st, { mimeType: 'video/webm;codecs=vp9,opus' }), parts = []; rec.ondataavailable = (e) => parts.push(e.data);
    let f = 0; const draw = () => { x.fillStyle = `hsl(${f++ % 360},60%,40%)`; x.fillRect(0, 0, 180, 320); if (rec.state === 'recording') requestAnimationFrame(draw); }; rec.start(); draw();
    await new Promise((r) => setTimeout(r, 8000)); const s = new Promise((r) => (rec.onstop = r)); rec.stop(); await s;
    const u = new Uint8Array(await new Blob(parts).arrayBuffer()); let str = ''; for (let k = 0; k < u.length; k += 0x8000) str += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000)); return btoa(str);
  });
  await p.setInputFiles('#editFile', { name: 'derush.webm', mimeType: 'video/webm', buffer: Buffer.from(vid, 'base64') });
  await p.waitForSelector('.qe'); await p.waitForFunction(() => /Montage \d/.test(document.querySelector('.qe [data-r=status]').textContent));
  await p.click('.qe [data-a=transcribe]'); await p.waitForSelector('.qe .tx span[data-i]');
  const dur = await p.evaluate(() => document.querySelector('.qe video').duration); console.log('durée', dur);
  const status = () => p.textContent('.qe [data-r=status]');
  const setT = (t) => p.evaluate((t) => { document.querySelector('.qe video').currentTime = t; }, t).then(() => p.waitForTimeout(250));
  const box = await (await p.$('.qe canvas.wave')).boundingBox(), xAt = (t) => box.x + (t / dur) * box.width, yMid = box.y + box.height / 2;
  // scinder à 2,0 s et 4,0 s (calés dans les blancs entre les mots)
  await setT(2.0); await p.click('.qe [data-a=split]'); await setT(4.0); await p.click('.qe [data-a=split]');
  await p.click('.qe [data-a=fit]'); await p.mouse.click(xAt(3), yMid); await p.waitForTimeout(200);
  assert.equal(await p.$eval('.qe [data-a=del]', (e) => e.disabled), false, 'clip sélectionné');
  await p.click('.qe [data-a=del]'); await p.waitForTimeout(200); const s1 = await status(); console.log('après suppression :', s1);
  assert.match(s1, /1 coupe/); const cut = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('gs.qe.')))).cuts);
  console.log('coupe :', cut); assert.ok(cut.length === 1 && Math.abs(cut[0].end - cut[0].start - 2) < 0.3, 'le clip du milieu (≈ 2 s) est coupé');
  for (const w of WORDS) { const m = (w.start + w.end) / 2; const inCut = m >= cut[0].start && m < cut[0].end; assert.ok(!(w.start < cut[0].start && w.end > cut[0].start) && !(w.start < cut[0].end && w.end > cut[0].end), 'aucun mot coupé en deux : ' + w.text); }
  // toucher la coupe → Restaurer
  await p.mouse.click(xAt((cut[0].start + cut[0].end) / 2), yMid); await p.waitForTimeout(200);
  assert.equal(await p.$eval('.qe [data-a=rest]', (e) => e.hidden), false); await p.click('.qe [data-a=rest]'); await p.waitForTimeout(200);
  assert.match(await status(), /0 coupe/);
  // rogner : sélectionner le dernier clip puis tirer sa poignée gauche d'environ 1 s vers la droite
  await p.mouse.click(xAt(6), yMid); await p.waitForTimeout(200);
  const st0 = cut[0].end; await p.mouse.move(xAt(st0) + 3, yMid); await p.mouse.down(); await p.mouse.move(xAt(st0 + 0.5), yMid, { steps: 4 }); await p.mouse.move(xAt(st0 + 1), yMid, { steps: 4 }); await p.mouse.up();
  await p.waitForTimeout(200); const s2 = await status(); console.log('après rognage :', s2); assert.match(s2, /1 coupe/);
  const cut2 = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('gs.qe.')))).cuts);
  console.log('coupe rognée :', cut2); assert.ok(Math.abs(cut2[0].start - st0) < 0.05 && cut2[0].end - cut2[0].start > 0.6 && cut2[0].end - cut2[0].start < 1.4);
  await p.click('.qe [data-a=undo]'); await p.waitForTimeout(200); assert.match(await status(), /0 coupe/, 'annuler défait le rognage');
  // zoom : boutons et retour à la vue d'ensemble
  await p.click('.qe [data-a=zin]'); await p.click('.qe [data-a=zin]'); await p.click('.qe [data-a=fit]');
  await p.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
