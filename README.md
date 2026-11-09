# Green Studio 3.0 — état réel (alpha.7)

Décor en direct sans fond vert, téléprompteur, profils, et **montage par le texte**. Tout reste sur le téléphone.

## Lancer
`npm install && npm run dev` (HTTPS requis pour la caméra sur Android : `vite --host` + tunnel HTTPS, ou déploiement statique de `npm run build`).
`npm install` copie MediaPipe dans `public/mediapipe/` (plus de dépendance au CDN).

## App Android (APK)
- Installer : copier `GreenStudio-<version>.apk` sur le téléphone, l'ouvrir, autoriser « installer des applis inconnues » pour l'appli utilisée (Fichiers, Chrome…).
- Construire : `npm run apk` (JDK 21, SDK Android dans `$ANDROID_HOME`, clé dans `android/keystore.properties`, non versionnée).
- **Clé de signature** : toutes les mises à jour doivent être signées avec la même clé, sinon Android refuse la mise à jour (il faudrait désinstaller et les prises seraient perdues). La conserver précieusement.
- Différences avec la version web : vidéos enregistrées dans la **Galerie** (Movies › Green Studio) et **partage Android** (TikTok, Instagram, WhatsApp…) ; modèles de détourage et MediaPipe inclus (hors ligne) ; écran maintenu allumé ; portrait. « Suit mes mots » n'existe pas dans l'app (pas de reconnaissance vocale dans la WebView) : repli sur « Suit ma voix ». La transcription Whisper télécharge son modèle au premier usage.
- Projet natif : `android/` (Capacitor 8) ; plugin `GalleryPlugin.java` (MediaStore).

## Tests
- `npm test` : tests unitaires (Node 22) — 20/20.
- `npm run test:browser` (avec `npx vite --port 5173` lancé) : tests dans Chromium, caméra simulée.
  - `media.e2e` : vraie vidéo MediaRecorder → extraction audio, export avec coupe (durée exacte), annulation.
  - `live.e2e` (et `LANDSCAPE=1` : caméra limitée au 4:3 paysage) : caméra plein écran ; zone analysée par l'IA limitée au visible ; micro affiché ; changement de décor mesuré (≈ 0–1 ms) ; modèle Précis chargé en arrière-plan ; prompteur qui avance avec la voix et s'arrête au silence.
  - `app.e2e` : compte à rebours → enregistrement → aperçu → ✂ Monter → transcription (Whisper simulé) → suggestions → annuler/rétablir → coupe par sélection de mots → lecture du montage (aucune image coupée affichée, relais entre lecteurs) → sous-titres → export (durée vérifiée, sous-titres gravés vérifiés dans l'image) → réouverture (montage conservé) → Mes prises (liste, montage, suppression). `MP4=1` teste le repli temps réel.

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

## Nouveautés alpha.5 (testées)
- **Prompteur qui suit la voix** (`core/prompter.ts`) : « Suit ma voix » (hors ligne : avance quand vous parlez, s'arrête au silence, seuil adaptatif au bruit) ; « Suit mes mots » (reconnaissance Chrome : se cale sur le mot prononcé même après un saut ou une reprise, mots lus estompés ; repli automatique) ; vitesse fixe. Liseré vert quand votre voix est détectée.
- **Détourage amélioré** : modèle **Précis** (selfie multiclasse : cheveux, visage, corps, vêtements) chargé en arrière-plan après le modèle Rapide ; réglage Auto / Précis / Rapide ; en Auto, retour en Rapide si l'appareil peine. **Masque synchronisé** : chaque image est affichée avec son propre masque (plus de « traînée » en bougeant) dès que l'IA tient 30 i/s.
- **Décors instantanés** : textures gardées sur le GPU, voisins et vignette touchée préchargés ; **fondu enchaîné** de 0,2 s.
- **Démarrage rapide** : IA préparée dès l'ouverture de la page, caméra affichée sans attendre l'IA, montage et bibliothèque préchargés.
- **Micro** : choix mémorisé, puce « 🎙 » en haut (toucher = choisir), micro branché utilisé automatiquement, retour au micro du téléphone s'il est débranché — sans couper l'enregistrement.
- **Lecture du montage sans pause** : deux lecteurs, l'un déjà calé sur la suite ; vérification image par image (`requestVideoFrameCallback`).

## Nouveautés alpha.7 — interface inspirée d'iOS
- **Viseur toujours exactement 9:16** (avant : étiré sur les écrans allongés comme le S25) ; la vidéo enregistrée est toujours en 9:16, quelle que soit la caméra.
- Écran caméra façon Appareil photo : barre du haut (Réglages, statut, Prompteur, micro), carrousel de décors, déclencheur, Mes prises, retournement de caméra.
- Réglages en feuilles iOS (poignée, OK, groupes, interrupteurs, sélecteurs segmentés) ; réglages techniques rangés dans « Réglages avancés ».
- Accueil, aperçu, montage et Mes prises dans le même style (barres de navigation, listes groupées) ; police Inter incluse (hors ligne).
- Correctif : icônes de l'app (générateur cassé à l'alpha.6).

## Nouveautés alpha.6 (d'après l'échantillon 720p/15 i/s fourni)
- **Plein écran** : l'image caméra remplit toujours le cadre 9:16 (avant : réduite pour tenir entière → silhouette dans une bande, coupée net). Bords adoucis si l'on dézoome.
- **Caméra négociée** : plusieurs formats essayés (portrait 1080p, sens capteur/écran, 1440p), ≥ 24 i/s demandés même dans la pénombre ; format retenu mémorisé ; affiché dans la pastille IA.
- **Détourage plus fin** : seule la zone visible de la caméra est envoyée à l'IA (≈ 1,8× plus de détails avec une caméra 4:3 recadrée).
- **Qualité** : 1080p par défaut, option 1440p ; débits fixes (enregistrement 14 Mbit/s en 1080p, 20 en 1440p ; export 12 Mbit/s en 1080p au lieu de ~1,6).
- **Transcription** : modèle Whisper **small** (bien plus fidèle en français) automatiquement avec WebGPU, base sinon ; choix manuel small/base/tiny ; replis automatiques.
- **Bégaiements que Whisper efface** (`analyzeAudio`) : voix sans mot transcrit entre deux mots (« je-je », « euh ») ; mot anormalement long avec coupure interne (« p… présenter ») → seul le début répété est proposé à la coupe.

## Fait mais NON testé ici (pas de réseau vers huggingface.co, pas de téléphone)
- Transcription Whisper réelle (`workers/transcribe.worker.ts`, modèle `onnx-community/whisper-base_timestamped`, WebGPU → WASM). Le worker se charge et gère l'échec réseau proprement ; le résultat réel reste à vérifier sur l'appareil.
- Note : Whisper omet souvent les « euh » ; les silences, répétitions et faux départs restent détectés.
- Export rapide d'un MP4 H.264 : le Chromium de test ne décode pas le H.264 (Chrome Android, si) ; testé avec WebM, le repli temps réel prend le relais sinon.

## Reste à faire
- Test complet sur Galaxy S25 (procédure des 17 points).
- « Suit mes mots » : la reconnaissance vocale de Chrome partage le micro avec l'enregistrement ; sur certains Android elle peut être refusée → repli automatique sur « Suit ma voix » (à vérifier sur le S25).
- Le repli export temps réel (navigateurs sans WebCodecs) n'inclut ni sous-titres ni volume optimisé (signalé à l'écran).
