# Green Studio 3.0 — état réel (alpha)

## Lancer
`npm install && npm run dev` (HTTPS requis pour la caméra sur Android : `vite --host` + tunnel HTTPS, ou déploiement statique). `npm test` pour les tests unitaires.

## Fait ET testé (Node 22, `npm test` : 14/14 ; `tsc` sans erreur sur src/core)
- `core/timeline.ts` : coupes non destructives, segments conservés, conversions de temps, marges, raccords, annuler/rétablir/restaurer.
- `core/speech-analysis.ts` : répétitions, bégaiements, faux départs, hésitations, silences longs ; propose seulement, ne coupe jamais.
- `core/storage.ts` + `recovery.ts` : file d'écriture séquentielle, quota, erreurs disque, métadonnées, récupération après crash (testés avec un backend mémoire).

## Fait mais NON testé (aucun navigateur/réseau/appareil ici)
- Backends OPFS et IndexedDB réels, branchés dans `index.html` (remplace le tableau `chunks`). Syntaxe du script vérifiée uniquement.
- `sw.js` + manifest (cache hors ligne), `workers/transcribe.worker.ts` (Whisper via transformers.js, WebGPU→WASM), `core/export.ts` (export temps réel via MediaRecorder). Le worker ne compile pas ici faute de `npm install`.

## PAS fait
- Interfaces Quick Edit (lecteur, transcription cliquable, timeline, forme d'onde) et Library ; moteurs Waveform/Preview ; PerformanceManager.
- Export WebCodecs + muxer ; fondus audio appliqués à l'export ; amélioration du masque (stabilité temporelle) ; icônes PWA.
- Aucun test sur Galaxy S25 : la procédure des 17 points reste à exécuter par vous.

## 3.0-alpha.2
- OPFS : enregistrement découpé en « parts » fermées toutes les ~5 s. Plus de recopie de tout le fichier à chaque flush (ralentissement quadratique sur les longues prises) ; un crash perd au plus ~5 s (au lieu de ~30 s). Testé avec un faux OPFS.
- Les prises récupérées ou non téléchargées sont reproposées au démarrage ; une prise téléchargée est supprimée du stockage (avant, rien n'était jamais effacé et le quota se remplissait). Testé dans Chromium.
- Shader : sortie anticipée loin des contours (5 lectures de texture au lieu de 33 sur la plupart des pixels).
- Service worker : l'app passe en « réseau d'abord » (avant, l'ancienne version restait en cache pour toujours) ; nettoyage des anciens caches.
- Wake lock réacquis au retour dans l'app ; alerte si l'app passe en arrière-plan pendant l'enregistrement ; code mort retiré.
