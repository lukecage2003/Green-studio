// Test navigateur « Rétention TikTok » : accroche, rythme visuel, classement, vrai/faux, question, barre de progression, look.
// node tests/browser/viral.e2e.cjs (serveur `npx vite --port 5173` lancé).
const { chromium } = require('playwright'); const assert = require('assert');
const said = 'Salut tout le monde aujourd\'hui on parle de Venom. Il est né en 1984. Pourquoi personne ne parle de son vrai créateur ? C\'est une histoire de mort et de secret. Et vous vous en pensez quoi ?'.split(' ');
let t = 1.5; const WORDS = said.map((x) => { const w = { text: x, start: +t.toFixed(2), end: +(t + 0.26).toFixed(2) }; t += 0.36; return w; });
const FAKE = `self.onmessage = (e) => { if (e.data.type === 'run') self.postMessage({ type: 'done', words: ${JSON.stringify(WORDS)} }); };`;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 412, height: 915 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => { const m = d.message(); d.accept(/Classement — le nom/.test(m) ? 'Venom' : /Concept à mettre/.test(m) ? 'Force Phénix' : d.defaultValue()); });
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
  await p.setInputFiles('#editFile', { name: 'viral.webm', mimeType: 'video/webm', buffer: Buffer.from(vid, 'base64') });
  await p.waitForSelector('.qe'); await p.waitForFunction(() => /Montage \d/.test(document.querySelector('.qe [data-r=status]').textContent));
  await p.click('.qe [data-a=transcribe]'); await p.waitForSelector('.qe .tx span[data-i]');
  const saved = () => p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('gs.qe.')))));
  // 1. accroche : note basse, salutation + blanc détectés, meilleure phrase proposée
  await p.click('.qe [data-tab=sg]'); await p.waitForSelector('.qe [data-hookc]');
  const hc = (await p.textContent('.qe [data-hookc]')).replace(/\s+/g, ' '); console.log('accroche :', hc.slice(0, 260));
  assert.match(hc, /salutation/); assert.match(hc, /Pourquoi personne ne parle de son vrai créateur \?/);
  await p.click('.qe [data-a=leadCut]'); let s = await saved(); assert.ok(s.cuts.some((c) => c.start === 0 && c.end > 1.3), 'blanc du début coupé');
  await p.click('.qe [data-a=hookUse]'); s = await saved(); assert.ok(s.hook && s.hook.start > 6, 'phrase rejouée en ouverture');
  await p.click('.qe [data-a=loopEnd]'); s = await saved(); assert.ok(s.cuts.some((c) => c.end >= 15 && c.start < 15), 'fin coupée net sur le dernier mot');
  // 2. habillage : rythme, accroche géante, classement, vrai/faux, question
  await p.click('.qe [data-tab=dress]'); await p.waitForSelector('.qe .tiles');
  assert.match(await p.textContent('.qe .body'), /Rythme visuel|sans changement/);
  await p.click('.qe .tiles [data-a=hookText]');
  await p.evaluate(() => { document.querySelector('.qe video').currentTime = 3.5; }); await p.waitForTimeout(300); await p.click('.qe .tiles [data-a=rank]');
  await p.evaluate(() => { document.querySelector('.qe video').currentTime = 7; }); await p.waitForTimeout(300); await p.click('.qe .tiles [data-a=term]');
  await p.click('.qe .tiles [data-a=question]');
  s = await saved(); console.log('titres :', JSON.stringify(s.titles.map((x) => [x.kind, x.text, x.sub, +x.start.toFixed(2), +x.end.toFixed(2)])));
  const k = (kind) => s.titles.find((x) => x.kind === kind);
  assert.ok(k('hook') && k('rank').sub && k('term').text === 'Force Phénix' && /pensez quoi/.test(k('question').text));
  // 3. sous-titres avec emojis
  await p.click('.qe [data-tab=cc]'); await p.check('.qe [data-a=emoji]'); s = await saved(); assert.equal(s.style.emoji, true);
  // 4. export : barre de progression + look comics
  await p.click('.qe [data-a=export]'); await p.click('.qe .modal [data-lk=comics]'); assert.ok(await p.isChecked('.qe .modal [data-x=prog]'));
  await p.click('.qe .modal [data-x=run]'); await p.waitForSelector('.qe .modal a[download]', { timeout: 150000 });
  const quizOut = await p.evaluate(() => null);
  const r = await p.evaluate(async () => {
    const a = document.querySelector('.qe .modal a[download]'), bl = await (await fetch(a.href)).blob(), mb = await import('/node_modules/.vite/deps/mediabunny.js');
    const i = new mb.Input({ source: new mb.BlobSource(bl), formats: mb.ALL_FORMATS }), tr = await i.getPrimaryVideoTrack(), dur = await tr.computeDuration(), sink = new mb.VideoSampleSink(tr);
    const shot = async (t) => { const s = await sink.getSample(t), c = new OffscreenCanvas(s.displayWidth, s.displayHeight), g = c.getContext('2d'); s.draw(g, 0, 0); s.close(); return { c, g }; };
    const count = (o, fx0, fx1, fy0, fy1, f) => { const d = o.g.getImageData(Math.round(o.c.width * fx0), Math.round(o.c.height * fy0), Math.max(1, Math.round(o.c.width * (fx1 - fx0))), Math.max(1, Math.round(o.c.height * (fy1 - fy0)))).data; let n = 0; for (let q = 0; q < d.length; q += 4) if (f(d[q], d[q + 1], d[q + 2])) n++; return n; };
    const green = (r, g, b) => g > 150 && r < 120 && b < 140, white = (r, g, b) => r > 220 && g > 220 && b > 220;
    const mid = await shot(dur * 0.5);
    return { dur, barGauche: count(mid, 0.03, 0.4, 0.008, 0.012, green), barDroite: count(mid, 0.6, 0.97, 0.008, 0.012, green), accroche: count(await shot(0.5), 0.1, 0.9, 0.22, 0.38, white) };
  });
  console.log('export :', JSON.stringify(r));
  assert.ok(r.barGauche > 20 && r.barDroite === 0, 'barre de progression à mi-parcours'); assert.ok(r.accroche > 300, 'texte d’accroche géant au début');
  void quizOut; console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
