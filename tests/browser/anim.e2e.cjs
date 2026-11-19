// Test navigateur « Animations, Avant / Après, frise, zones TikTok, effets de coupe » : node tests/browser/anim.e2e.cjs (serveur `npx vite --port 5173` lancé).
const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 412, height: 915 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => { const m = d.message(); d.accept(/Étiquettes/.test(m) ? 'Comic / Film' : /Frise/.test(m) ? 'Histoire' : /séparé/.test(m) ? d.defaultValue() : 'x'); });
  await ctx.addInitScript(() => { localStorage.setItem('gs.autoClean', '0'); localStorage.setItem('gs.onb', '1'); });
  await p.goto('http://localhost:5173/');
  const [vid, mag, cyan] = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 360; c.height = 640; const x = c.getContext('2d'); const st = c.captureStream(30);
    const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); d.stream.getAudioTracks().forEach((t) => st.addTrack(t));
    const rec = new MediaRecorder(st, { mimeType: 'video/webm;codecs=vp9,opus' }), parts = []; rec.ondataavailable = (e) => parts.push(e.data);
    const draw = () => { x.fillStyle = '#1a8a3a'; x.fillRect(0, 0, 360, 640); if (rec.state === 'recording') requestAnimationFrame(draw); }; rec.start(); draw();
    await new Promise((r) => setTimeout(r, 9000)); const s = new Promise((r) => (rec.onstop = r)); rec.stop(); await s;
    const img = async (col) => { const i = document.createElement('canvas'); i.width = 300; i.height = 400; const g = i.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 300, 400); return new Promise((r) => i.toBlob(r, 'image/png')); };
    const b64 = async (bl) => { const u = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000)); return btoa(s); };
    return [await b64(new Blob(parts)), await b64(await img('#ff00ff')), await b64(await img('#00e5ff'))];
  });
  await p.setInputFiles('#editFile', { name: 'anim.webm', mimeType: 'video/webm', buffer: Buffer.from(vid, 'base64') });
  await p.waitForSelector('.qe'); await p.waitForFunction(() => /Montage \d/.test(document.querySelector('.qe [data-r=status]').textContent));
  const at = async (t) => { await p.evaluate((t) => { document.querySelectorAll('.qe video').forEach((v) => { v.pause(); v.currentTime = t; }); }, t); await p.waitForTimeout(300); };
  // 1. image magenta à 1 s, glisse depuis la gauche
  await at(1); await p.setInputFiles('.qe [data-r=ovFile]', { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(mag, 'base64') });
  await p.waitForSelector('.qe [data-o]'); await p.click('.qe [data-o] [data-a=oanim][data-v=slideL]');
  // 2. avant / après à 5 s : magenta (avant) / cyan (après)
  await at(5); await p.setInputFiles('.qe [data-r=ovFile]', { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(mag, 'base64') });
  await p.waitForFunction(() => document.querySelectorAll('.qe [data-o]').length === 2);
  const second = (await p.$$('.qe [data-o]'))[1], oid = await second.getAttribute('data-o');
  await p.click(`.qe [data-o="${oid}"] [data-a=omode][data-v=compare]`);
  await p.setInputFiles('.qe [data-r=withFile]', { name: 'c.png', mimeType: 'image/png', buffer: Buffer.from(cyan, 'base64') });
  await p.waitForSelector(`.qe [data-o="${oid}"] [data-a=olabels]`); await p.click(`.qe [data-o="${oid}"] [data-a=olabels]`);
  // 3. frise à 7,4 s ; bulle et fiche retirées de l'appli
  assert.equal(await p.$('.qe [data-a=bubble]'), null); assert.equal(await p.$('.qe [data-a=card]'), null);
  await at(7.4); await p.click('.qe [data-a=timeline]'); await p.waitForSelector('.qe [data-ti]');
  await p.click('.qe [data-a=safe]'); assert.ok(await p.$('.qe .tile.on[data-a=safe]'), 'zones TikTok affichées');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('gs.qe.')))));
  console.log('habillage :', JSON.stringify(saved.overlays.map((o) => [o.mode, o.anim, !!o.with, o.labels])), JSON.stringify(saved.titles.map((t) => [t.kind, t.text, t.sub])));
  assert.equal(saved.overlays[0].anim, 'slideL'); assert.ok(saved.overlays[1].with && saved.overlays[1].labels[1] === 'Film');
  assert.equal(saved.titles.length, 1); assert.equal(saved.titles[0].kind, 'timeline'); assert.match(saved.titles[0].sub, /1988/);
  // 4. export TikTok (9:16) avec flash blanc aux coupes
  await p.click('.qe [data-a=export]'); assert.equal(await p.$('.qe .modal [data-ar]'), null); await p.click('.qe .modal [data-tr=flash]'); await p.click('.qe .modal [data-x=run]');
  await p.waitForSelector('.qe .modal a[download]', { timeout: 120000 });
  const r = await p.evaluate(async () => {
    const a = document.querySelector('.qe .modal a[download]'), bl = await (await fetch(a.href)).blob(), mb = await import('/node_modules/.vite/deps/mediabunny.js');
    const i = new mb.Input({ source: new mb.BlobSource(bl), formats: mb.ALL_FORMATS }), sink = new mb.VideoSampleSink(await i.getPrimaryVideoTrack());
    const shot = async (t) => { const s = await sink.getSample(t), c = new OffscreenCanvas(s.displayWidth, s.displayHeight), g = c.getContext('2d'); s.draw(g, 0, 0); s.close(); return { c, g }; };
    const px = (o, fx, fy) => [...o.g.getImageData(Math.round(o.c.width * fx), Math.round(o.c.height * fy), 1, 1).data.slice(0, 3)];
    const s0 = await shot(1.05), s1 = await shot(2.2), s2 = await shot(5.9);
    return { w: s0.c.width, h: s0.c.height, entreeGauche: px(s0, 0.36, 0.5), entreeDroite: px(s0, 0.6, 0.5), pose: px(s1, 0.5, 0.5), bord: px(s1, 0.08, 0.5),
      avant: px(s2, 0.42, 0.6), apres: px(s2, 0.58, 0.6) };
  });
  console.log('export :', JSON.stringify(r));
  const isMag = (c) => c[0] > 170 && c[1] < 100 && c[2] > 170, isCyan = (c) => c[0] < 90 && c[1] > 160 && c[2] > 160;
  assert.ok(Math.abs(r.w / r.h - 9 / 16) < 0.02, 'format 9:16');
  assert.ok(isMag(r.pose), 'image posée au centre'); assert.ok(!isMag(r.entreeDroite), "pendant l'entrée, la droite n'est pas encore couverte");
  assert.ok(isMag(r.avant) && isCyan(r.apres), 'avant / après côte à côte');
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
