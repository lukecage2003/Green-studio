# Green Studio 3.0 — état réel (alpha.4)

Décor en direct sans fond vert, téléprompteur, profils, et **montage par le texte**. Tout reste sur le téléphone.

## Lancer
`npm install && npm run dev` (HTTPS requis pour la caméra sur Android : `vite --host` + tunnel HTTPS, ou déploiement statique de `npm run build`).
`npm install` copie MediaPipe dans `public/mediapipe/` (plus de dépendance au CDN).

## Tests
- `npm test` : tests unitaires (Node 22) — 17/17.
- `npm run test:browser` (avec `npx vite --port 5173` lancé) : tests dans Chromium, caméra simulée.
  - `media.e2e` : vraie vidéo MediaRecorder → extraction audio, export avec coupe (durée exacte), annulation.
  - `app.e2e` : compte à rebours → enregistrement → aperçu → ✂ Monter → transcription (Whisper simulé) → suggestions → annuler/rétablir → coupe par sélection de mots → sous-titres → export (durée vérifiée, sous-titres gravés vérifiés dans l'image) → réouverture (montage conservé) → Mes prises (liste, montage, suppression). `MP4=1` teste le repli temps réel.

## Fait ET testé
- `core/timeline.ts`, `core/speech-analysis.ts` : coupes non destructives, conversions de temps, suggestions (répétitions, bégaiements, faux départs, hésitations, silences).
- `core/storage.ts` + `recovery.ts` : écriture progressive OPFS en « parts » de ~5 s (crash : ≤ 5 s perdues, aucune recopie), repli IndexedDB, récupération ; prises non téléchargées reproposées, supprimées après téléchargement.
- `core/media.ts` : **export WebCodecs** (mediabunny) bien plus rapide que le temps réel, MP4/H.264 en priorité, image clé à chaque raccord, **fondus audio de 12 ms** aux raccords, écriture sur disque (OPFS) ; extraction audio en flux (jamais toute la vidéo en mémoire).
- `core/audio.ts` : rééchantillonnage, forme d'onde, fondus, découpe aux silences pour la transcription.
- `ui/quick-edit.ts` : écran Montage — lecteur qui saute les coupes, forme d'onde + timeline tactile, transcription cliquable (toucher = se placer, 2ᵉ toucher = étendre la sélection, ✂ Couper / ↺ Garder / ▶ Écouter), suggestions (Couper / Garder / Ignorer, « Appliquer les sûres », « Couper les silences »), coupe manuelle ⟦ Début / Couper ⟧, annuler/rétablir, raccourcis clavier, sauvegarde automatique, export + Télécharger / Partager.
- Détourage MediaPipe **dans un worker** (`public/seg.worker.js`) : l'IA ne bloque plus le rendu ; repli sur le thread principal.
- Icônes PWA (dont maskable) + manifest complet ; service worker (app en réseau d'abord, MediaPipe/modèles en cache).

## Nouveautés alpha.4 (testées)
- **Sous-titres animés gravés** (`core/captions.ts`) : Karaoké, Mot par mot, Encadré, Simple ; position, MAJUSCULES, couleur ; aperçu en direct sur le lecteur, même rendu qu'à l'export ; lignes courtes coupées aux pauses et fins de phrase, mots coupés exclus. Correction d'un mot mal transcrit (✎).
- **Volume optimisé** (≈ −14 LUFS, mesure à double seuil sur les seules parties conservées, plafond +12 dB, limiteur doux) — option d'export.
- **Export 720p** (fichier ~2× plus léger) — option d'export ; options mémorisées par projet.
- **✂ Bords muets** : coupe le silence avant la première et après la dernière parole (mots, ou énergie audio sans transcription).
- **Mes prises** (`ui/library.ts`) : vignettes, date, durée, taille, espace libre ; Voir / Monter / Télécharger / Supprimer ; nettoyage des prises déjà téléchargées. Les prises ne sont plus effacées à la fermeture de l'aperçu.
- **Stockage persistant** demandé au navigateur (les prises ne sont pas effacées pour faire de la place) ; si l'espace manque, la bibliothèque s'ouvre.
- **Compte à rebours 3-2-1** (toucher pour annuler) puis lancement du prompteur depuis le début, synchronisé avec l'enregistrement.

## Fait mais NON testé ici (pas de réseau vers huggingface.co, pas de téléphone)
- Transcription Whisper réelle (`workers/transcribe.worker.ts`, modèle `onnx-community/whisper-base_timestamped`, WebGPU → WASM). Le worker se charge et gère l'échec réseau proprement ; le résultat réel reste à vérifier sur l'appareil.
- Note : Whisper omet souvent les « euh » ; les silences, répétitions et faux départs restent détectés.
- Export rapide d'un MP4 H.264 : le Chromium de test ne décode pas le H.264 (Chrome Android, si) ; testé avec WebM, le repli temps réel prend le relais sinon.

## Reste à faire
- Test complet sur Galaxy S25 (procédure des 17 points).
- Le repli export temps réel (navigateurs sans WebCodecs) n'inclut ni sous-titres ni volume optimisé (signalé à l'écran).
