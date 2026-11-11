// Test navigateur « Habillage » : node tests/browser/dress.e2e.cjs (serveur `npx vite --port 5173` lancé).
// Vidéo importée → image insérée (plein écran puis « moi en petit ») + bandeau → export → pixels vérifiés.
const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 384, height: 832 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept(/Sous-titre/.test(d.message()) ? 'Le nouveau Spider-Man' : 'Comics News'));
  await p.goto('http://localhost:5173/');
  // vidéo source verte de 4 s, et image magenta à insérer
  const [vid, png] = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 360; c.height = 640; const x = c.getContext('2d'); const st = c.captureStream(30);
    const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); d.stream.getAudioTracks().forEach((t) => st.addTrack(t));
    const rec = new MediaRecorder(st, { mimeType: 'video/webm;codecs=vp9,opus' }), parts = []; rec.ondataavailable = (e) => parts.push(e.data);
    const draw = () => { x.fillStyle = '#1a8a3a'; x.fillRect(0, 0, 360, 640); if (rec.state === 'recording') requestAnimationFrame(draw); }; rec.start(); draw();
    await new Promise((r) => setTimeout(r, 4000)); const s = new Promise((r) => (rec.onstop = r)); rec.stop(); await s;
    const i = document.createElement('canvas'); i.width = 300; i.height = 400; const g = i.getContext('2d'); g.fillStyle = '#ff00ff'; g.fillRect(0, 0, 300, 400);
    const b64 = async (bl) => { const u = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000)); return btoa(s); };
    return [await b64(new Blob(parts)), await b64(await new Promise((r) => i.toBlob(r, 'image/png')))];
  });
  await p.setInputFiles('#editFile', { name: 'prise.webm', mimeType: 'video/webm', buffer: Buffer.from(vid, 'base64') });
  await p.waitForSelector('.qe'); await p.waitForFunction(() => /Montage \d/.test(document.querySelector('.qe [data-r=status]').textContent));
  await p.evaluate(() => { document.querySelectorAll('.qe video').forEach((v) => (v.currentTime = 0.5)); });
  await p.setInputFiles('.qe [data-r=ovFile]', { name: 'case.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await p.waitForSelector('.qe [data-o]'); await p.click('.qe [data-a=title]'); await p.waitForSelector('.qe [data-ti]');
  console.log('habillage :', (await p.textContent('.qe .body')).replace(/\s+/g, ' ').slice(0, 160));
  // aperçu : l'image est dessinée par-dessus la vidéo dans le lecteur
  await p.evaluate(() => { document.querySelectorAll('.qe video').forEach((v) => (v.currentTime = 1.5)); }); await p.waitForTimeout(400);
  const prev = await p.evaluate(() => { const c = document.querySelector('.qe canvas.cc'), d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; return [...d.slice(0, 3)]; });
  console.log('aperçu (centre) :', prev); assert.ok(prev[0] > 200 && prev[1] < 60 && prev[2] > 200, "l'image est visible dans l'aperçu");
  const exportPx = async (label) => {
    await p.click('.qe [data-a=export]'); await p.click('.qe .modal [data-x=run]'); await p.waitForSelector('.qe .modal a[download]', { timeout: 60000 });
    const r = await p.evaluate(async () => {
      const a = document.querySelector('.qe .modal a[download]'), bl = await (await fetch(a.href)).blob(), mb = await import('/node_modules/.vite/deps/mediabunny.js');
      const i = new mb.Input({ source: new mb.BlobSource(bl), formats: mb.ALL_FORMATS }), s = await new mb.VideoSampleSink(await i.getPrimaryVideoTrack()).getSample(1.5);
      const c = new OffscreenCanvas(s.displayWidth, s.displayHeight), g = c.getContext('2d'); s.draw(g, 0, 0); s.close();
      const at = (fx, fy) => [...g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data.slice(0, 3)];
      return { centre: at(0.4, 0.35), coin: at(0.8, 0.62), bandeau: at(0.1, 0.75) };
    });
    console.log(label, JSON.stringify(r)); await p.click('.qe .modal [data-x=ok]'); return r;
  };
  const isMag = (c) => c[0] > 180 && c[1] < 90 && c[2] > 180, isGreen = (c) => c[1] > c[0] + 40 && c[1] > c[2] + 20;
  const full = await exportPx('export plein écran :'); assert.ok(isMag(full.centre) && isMag(full.coin), 'image en plein écran');
  assert.ok(!isMag(full.bandeau) && full.bandeau[0] < 90, 'bandeau sombre en bas à gauche');
  await p.click('.qe [data-a=omode][data-v=me]');
  const me = await exportPx('export moi en petit :'); assert.ok(isMag(me.centre), 'image en fond'); assert.ok(isGreen(me.coin), 'la personne en petit dans le coin');
  // Modèle d'émission : enregistré ici, appliqué automatiquement à la vidéo suivante (bandeau d'ouverture compris)
  await p.click('.qe [data-tab=cc]'); await p.click('.qe [data-a=tplSave]'); await p.waitForSelector('.qe [data-a=tplUse]');
  await p.click('.qe [data-a=close]'); await p.waitForSelector('.qe', { state: 'detached' });
  await p.setInputFiles('#editFile', { name: 'prise2.webm', mimeType: 'video/webm', buffer: Buffer.from(vid, 'base64') });
  await p.waitForSelector('.qe'); await p.waitForFunction(() => /Montage \d/.test(document.querySelector('.qe [data-r=status]').textContent));
  await p.click('.qe [data-tab=dress]'); const intro = await p.textContent('.qe .body');
  console.log('vidéo suivante :', intro.replace(/\s+/g, ' ').slice(0, 120)); assert.ok(await p.$('.qe [data-ti]'), "le bandeau d'ouverture du modèle est appliqué");
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
