// Test navigateur du direct : node tests/browser/live.e2e.cjs (serveur `npx vite --port 5173` lancé). Caméra et micro simulés.
const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 400, height: 800 } }); const errs = [];
  // LANDSCAPE=1 : caméra qui ne sait fournir que du 4:3 paysage (cas observé sur téléphone)
  if (process.env.LANDSCAPE) await p.addInitScript(() => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => g(c.video ? { ...c, video: { width: { exact: 1440 }, height: { exact: 1080 } } } : c); });
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:5173/');
  await p.evaluate(() => { window.__seen = new Set(); setInterval(() => window.gsDebug && window.__seen.add(window.gsDebug.model), 100); }); // modèles vus dès le départ
  await p.click('#go'); await p.waitForSelector('#rec:not([hidden])');
  // Déclencheur : toujours centré en bas, à la même place, quel que soit l'état de l'écran
  const recPos = () => p.evaluate(() => { const r = document.getElementById('rec').getBoundingClientRect(); return [Math.round(r.left + r.width / 2 - innerWidth / 2), Math.round(r.bottom)]; });
  const pos0 = await recPos(); const positions = [pos0];
  await p.locator('#strip .th').nth(2).click(); await p.waitForTimeout(300); positions.push(await recPos());
  await p.click('#bDecor'); await p.waitForTimeout(300); await p.click('#bClose'); positions.push(await recPos());
  await p.evaluate(() => localStorage.setItem('gs.cd', '0'));
  await p.click('#rec'); await p.waitForSelector('#recChip:not([hidden])', { timeout: 20000 }); positions.push(await recPos());
  await p.click('#rec'); await p.waitForSelector('#pv:not([hidden])'); await p.click('#pvClose'); await p.waitForTimeout(300); positions.push(await recPos());
  console.log('déclencheur (écart au centre, bas) :', JSON.stringify(positions));
  assert.ok(positions.every((q) => Math.abs(q[0]) <= 1 && Math.abs(q[1] - pos0[1]) <= 1), 'le déclencheur reste centré en bas');
  // Micro : puce visible avec le nom du micro
  await p.waitForSelector('#micChip:not([hidden])'); console.log('micro :', await p.textContent('#micChip'));
  // Plein écran : la caméra (simulée, en paysage 4:3) remplit le cadre 9:16 ; l'IA n'analyse que la zone visible
  const cam = await p.evaluate(() => window.gsDebug.cam); console.log('caméra :', cam);
  if (process.env.LANDSCAPE) { // caméra 4:3 : objectifs 0,4 / 0,7 / 1× proposés ; en 1× (plein cadre), seule la zone visible va à l'IA
    assert.ok(await p.isVisible('#lens')); console.log('objectifs :', await p.locator('#lens button').allTextContents());
    await p.click('[data-lens=fill]'); await p.waitForTimeout(500);
  }
  await p.evaluate(() => { const i = document.getElementById('inv'); i.checked = true; i.dispatchEvent(new Event('change')); }); // masque inversé : caméra visible partout
  await p.waitForTimeout(2500); await p.screenshot({ path: process.argv[2] || require('os').tmpdir() + '/live.png' });
  const rect = await p.evaluate(() => window.gsDebug.maskRect); console.log('zone analysée :', rect.map((x) => +x.toFixed(2)));
  const [cw, ch] = cam.split(' ')[0].split('×').map(Number);
  if (cw > ch) assert.ok(rect[2] < 0.8, "caméra paysage : seule la zone visible est envoyée à l'IA"); else assert.deepEqual(rect, [0, 0, 1, 1]);
  await p.evaluate(() => { const i = document.getElementById('inv'); i.checked = false; i.dispatchEvent(new Event('change')); });
  // Décors : changement instantané (préchargés sur le GPU), y compris par toucher sur une vignette lointaine
  await p.waitForTimeout(1500);
  const times = [];
  for (const k of [2, 3, 4, 1]) {
    const th = p.locator('#strip .th').nth(k); await th.dispatchEvent('pointerdown'); await p.waitForTimeout(120); // le doigt se pose…
    const t = await p.evaluate(async (k) => { const el = document.querySelectorAll('#strip .th')[k]; const t0 = performance.now(); el.click();
      while (window.gsDebug.bg !== ['g0', 'g1', 'g2', 'g3'][k - 1]) await new Promise((r) => setTimeout(r, 1)); return performance.now() - t0; }, k);
    times.push(Math.round(t)); await p.waitForTimeout(300);
  }
  console.log('changement de décor (ms) :', times); assert.ok(Math.max(...times) < 30, 'instantané');
  // IA : modèle Précis chargé en arrière-plan (puis éventuellement Rapide si l'appareil est lent : ici GPU logiciel)
  await p.waitForTimeout(8000); const seen = new Set(await p.evaluate(() => [...window.__seen]));
  console.log('modèles utilisés :', [...seen], '· inférence', Math.round(await p.evaluate(() => window.gsDebug.inferMs)), 'ms · synchro', await p.evaluate(() => window.gsDebug.sync));
  assert.ok(seen.has('hq'), 'le modèle Précis se charge et tourne');
  if (process.env.LANDSCAPE) { console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); return b.close(); }
  // Prompteur « suit ma voix » : avance quand on parle (bips du micro simulé), s'arrête micro coupé
  await p.click('#bScript'); await p.fill('#tpIn', Array.from({ length: 80 }, (_, i) => `Ligne ${i} du script de test.`).join('\n'));
  await p.selectOption('#tpMode', 'voice'); await p.evaluate(() => { const e = document.getElementById('tpSpd'); e.value = 120; e.dispatchEvent(new Event('input')); });
  await p.click('#tpPlay'); // l'émulation GPU peut bloquer l'affichage quelques secondes : on attend jusqu'à 10 s que le texte avance
  const y1 = await p.evaluate(async () => { const t0 = performance.now(); let y = 0; while (performance.now() - t0 < 10000 && (y = document.getElementById('tp').scrollTop) <= 30) await new Promise((r) => setTimeout(r, 200)); return y; });
  console.log('prompteur, voix présente : défilé de', y1, 'px');
  if (y1 <= 30) console.log('diagnostic :', await p.evaluate(() => ({ vad: window.gsDebug.vad, mic: window.gsDebug.mic, play: document.getElementById('tpPlay').textContent, shown: !document.getElementById('tp').hidden, mode: document.getElementById('tpMode').value, h: document.getElementById('tp').scrollHeight, ch: document.getElementById('tp').clientHeight }))); assert.ok(y1 > 30);
  await p.evaluate(() => { const g = document.getElementById('gain'); g.value = 0; g.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(800); const y2 = await p.evaluate(() => document.getElementById('tp').scrollTop); await p.waitForTimeout(2000);
  const y3 = await p.evaluate(() => document.getElementById('tp').scrollTop); console.log('silence : défilé de', y3 - y2, 'px'); assert.ok(y3 - y2 < 3, "s'arrête au silence");
  console.log('erreurs :', errs); assert.equal(errs.length, 0); console.log('OK'); await b.close();
})().catch((e) => { console.error('ÉCHEC', e); process.exit(1); });
