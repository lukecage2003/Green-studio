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
    return { srcMime: src.type, src: info, audioSec: a.pcm.length / 16000, rms: +rms.toFixed(3), out: { ext: out.ext, v: out.video, a: out.audio, size: out.blob.size, ...info2 }, progress: last, ms: Math.round(ms), cancelled };
  });
  console.log(JSON.stringify(r, null, 1)); console.log('erreurs:', errs); await b.close();
})();
