// Test navigateur : node tests/browser/media.e2e.cjs (serveur `npx vite --port 5173` lancé)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5173/tests/browser/blank.html');
  const r = await p.evaluate(async () => {
    // 1. Fabrique une vraie prise de 4 s (MediaRecorder, comme l'app) : image animée + bip 440 Hz
    const c = document.createElement('canvas'); c.width = 360; c.height = 640; const x = c.getContext('2d');
    const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start();
    const st = c.captureStream(30); d.stream.getAudioTracks().forEach((t) => st.addTrack(t));
    const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(st, { mimeType: mime }); const parts = []; rec.ondataavailable = (e) => parts.push(e.data);
    let f = 0; const draw = () => { x.fillStyle = `hsl(${f++ * 5},80%,50%)`; x.fillRect(0, 0, 360, 640); if (rec.state === 'recording') requestAnimationFrame(draw); };
    rec.start(500); draw(); await new Promise((r) => setTimeout(r, 4000)); const stopped = new Promise((r) => (rec.onstop = r)); rec.stop(); await stopped;
    const src = new Blob(parts, { type: mime.split(';')[0] });
    const m = await import('/src/core/media.ts');
    const info = await m.probe(src);
    const a = await m.extractAudio(src);
    let rms = 0; for (let i = 0; i < a.pcm.length; i++) rms += a.pcm[i] ** 2; rms = Math.sqrt(rms / a.pcm.length);
    const t0 = performance.now(); let last = 0;
    const out = await m.exportEdited(src, [{ start: 1, end: 2 }], { onProgress: (q) => (last = q) });
    const ms = performance.now() - t0; const info2 = await m.probe(out.blob);
    // annulation
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 30);
    const cancelled = await m.exportEdited(src, [], { signal: ctl.signal }).then(() => 'non', (e) => e.name);
    // source saccadée (4 i/s, comme une prise qui rame) + coupe jusqu'à la fin : la durée exportée doit rester exacte
    const c2 = document.createElement('canvas'); c2.width = 180; c2.height = 320; const x2 = c2.getContext('2d'); const st2 = c2.captureStream(4);
    d.stream.getAudioTracks().forEach((t) => st2.addTrack(t.clone()));
    const rec2 = new MediaRecorder(st2, { mimeType: 'video/webm;codecs=vp9,opus' }); const p2 = []; rec2.ondataavailable = (e) => p2.push(e.data);
    let g = 0; const draw2 = () => { x2.fillStyle = `hsl(${g++ * 9},80%,50%)`; x2.fillRect(0, 0, 180, 320); if (rec2.state === 'recording') requestAnimationFrame(draw2); };
    rec2.start(500); draw2(); await new Promise((r) => setTimeout(r, 4000)); const s2 = new Promise((r) => (rec2.onstop = r)); rec2.stop(); await s2;
    const slow = new Blob(p2, { type: 'video/webm' }), sd = (await m.probe(slow)).duration, sc = [{ start: 0.5, end: 1 }, { start: 2, end: sd }];
    const so = await m.exportEdited(slow, sc), slowGot = (await m.probe(so.blob)).duration, slowWant = sd - 0.5 - (sd - 2);
    return { slow: { got: +slowGot.toFixed(3), want: +slowWant.toFixed(3) }, srcMime: src.type, src: info, audioSec: a.pcm.length / 16000, rms: +rms.toFixed(3), out: { ext: out.ext, v: out.video, a: out.audio, size: out.blob.size, ...info2 }, progress: last, ms: Math.round(ms), cancelled };
  });
  console.log(JSON.stringify(r, null, 1)); console.log('erreurs:', errs);
  if (Math.abs(r.slow.got - r.slow.want) > 0.1) { console.log('ÉCHEC durée source saccadée'); process.exitCode = 1; }
  await b.close();
})();
