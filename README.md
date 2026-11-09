# Green Studio 3.0 — état réel (alpha)

## Lancer
`npm install && npm run dev` (HTTPS requis pour la caméra sur Android : `vite --host` + tunnel HTTPS, ou déploiement statique). `npm test` pour les tests unitaires.

## Fait ET testé (Node 22, `npm test` : 13/13 ; `tsc` sans erreur sur src/core)
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
- OPFS : les données ne sont durables qu'à `close()` (flush tous les 30 chunks ≈ 30 s) ; un crash peut perdre jusqu'à ~30 s.
