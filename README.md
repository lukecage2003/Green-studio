# Green Studio 3.1 — état réel (beta.13)

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
- `npm test` : tests unitaires (Node 22) — 21/21.
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

## 3.1.0-beta.13
- **Vérifié avec Whisper small** (le modèle utilisé sur le téléphone) dans l'app, sur deux vraies prises, mot pour mot + « Tout supprimer » : 25 s → 19 s (10 coupes) et 14 s → 6 s (4 coupes), tous les vrais mots gardés dans le texte.
- **Mots étirés recalés** (`tightenWords`) : quand Whisper étire un mot sur l'hésitation qui le précède, son début est recalé sur sa vraie position dans le son (ancien début gardé dans `pre`). Avant, le mot gardait son son mais disparaissait du texte et des sous-titres (« Ça », « C'est », « Si »).
- **Miettes supprimées** : un morceau gardé de moins de 0,15 s entre deux coupes, sans mot, est coupé aussi (plus de « clic »).
- **Zooms dynamiques actifs par défaut**, avec au moins 1,2 s entre deux changements (pas d'effet stroboscopique quand les coupes sont serrées).
- **Sous-titres** : virgules de fin retirées, « … » ignoré.
- `tests/browser/asr-real.e2e.cjs` sert les modèles par un miroir local (`gs.asrHost`), choix du modèle par `ASR_MODEL`.

## 3.1.0-beta.12
- **Transcription mot pour mot** (par défaut, option « Mot pour mot » dans l'onglet Texte) : Whisper est amorcé avec un court texte plein d'hésitations, ce qui l'incite à ÉCRIRE les « euh », répétitions et faux départs au lieu de les effacer. transformers.js ne gérant pas l'amorce pour l'horodatage par mot, elle est retirée des séquences et de l'attention croisée avant l'alignement (`src/core/verbatim.ts`) ; si un passage décroche (écho de l'amorce, texte qui s'arrête avant la fin de la parole), il est retranscrit sans amorce.
- **Vérifié avec la vraie transcription de l'app** (worker transformers.js + Whisper ONNX, dans Chromium) sur une vraie prise : `tests/browser/asr-real.e2e.cjs` (modèles servis en local : `ASR_MODELS=… ASR_VIDEO=… npm run test:asr`). Mot pour mot : « je le tourne, bon, je n'ai pas trop de lumière, donc, excuse-moi, mais là, voilà, ici » (classique : « je ne le tourne pas trop du mien, mais là vous voyez ici ») ; « Tout supprimer » : 13 coupes / −4 s au lieu de 9 / −3 s.
- Bancs d'essai : `scripts/asr-bench.ts` (transcription, même code que l'app, en Node) et `scripts/clean-bench.ts` (nettoyage → audio monté).
- Recalage des coupes borné par les mots gardés voisins (« bon, je n'ai » ne perd plus le « je »). « … » noté par Whisper = hésitation coupée. Phrase abandonnée suivie d'un tic (« Et si l'étoile, bon, … ») proposée.

## 3.1.0-beta.11
- **Montage au plus près, vérifié sur de vraies prises.** Banc d'essai : transcription Whisper small (mêmes poids que l'app, via faster-whisper) de deux vraies prises, détection, application des coupes, puis retranscription mot pour mot de l'audio monté.
  - Whisper « avale » les hésitations, répétitions et faux départs en étirant le mot suivant (« j'ai » de 0,9 s, « ici » de 1,1 s) : nouvelle détection de la **parole avalée** (le vrai mot est en fin de plage, coupe sur la dernière pause ou le dernier creux marqué d'énergie). Résultat : « et si l'étoil, bon » et « voilà, voilà » retirés.
  - **Bords de coupe recalés sur le silence** (trames de 10 ms) : une coupe qui finit avant un mot ne s'en approche jamais, une hésitation s'étend vers le silence qui l'entoure.
  - Élisions recollées (« j » + « 'ai »), génériques inventés par Whisper (« Sous-titres réalisés par la communauté d'Amara.org ») et boucles retirés.
  - Tics isolés ajoutés : donc, bon, alors, enfin, mais bon.
  - Moins de coupes à tort : « début de mot répété » n'est plus qu'une suggestion (coupait « je comprends », « Si »).
  - Rythme **Dynamique par défaut** : silences > 0,3 s retirés, 0,1 s de respiration gardée (comme Rescript).
  - L'amorce « verbatim » de Whisper a été évaluée puis écartée : avec transformers.js, elle fait dérailler le décodage des segments courts (mesures publiées par le projet Rescript).

## 3.1.0-beta.10
- **Vrai fond vert / bleu** (Réglages › Vrai fond vert : Auto / Toujours / Jamais, et Tolérance) : incrustation par la couleur sur le principe du filtre Chroma Key d'[OBS Studio](https://obsproject.com/kb/chroma-key-filter) (distance de chrominance moyennée 3×3, bord adouci, retrait du reflet vert sur la peau), avec le détourage IA comme garde-fou autour de la personne. Fond uni vert ou bleu détecté automatiquement (≈ 1 s), couleur suivie en continu (éclairage inégal). Moteurs web et natif. Vérifié en navigateur sur une image de test réaliste (fond vert éclairé de façon inégale + grain) ; shader natif validé (GLSL ES 3.00) ; tests unitaires de la détection.
- **⚡ Express** (après une prise) : transcription → nettoyage → modèle d'émission → export → Galerie, en un geste ; si la transcription échoue, la vidéo est exportée sans nettoyage. Testé : `tests/browser/express.e2e.cjs`.
- **Rythme** (Suggestions) : Posé / Naturel / Dynamique, inspiré d'[auto-editor](https://github.com/WyattBlue/auto-editor) (seuil de silence + marge gardée). Naturel (par défaut) : silences > 0,7 s ramenés à 0,3 s (avant : seulement > 1,5 s) ; Dynamique : > 0,35 s ramenés à 0,12 s, façon TikTok. Mémorisé dans les modèles d'émission.

## 3.1.0-beta.9
- **Timeline de dérush** (montage) : vue d'ensemble ou zoom (pincer, ＋/−, ⤢ Tout) avec tête de lecture fixe au centre ; glisser pour défiler ; forme d'onde fine et mots sous l'onde ; ✂ Scinder (calé automatiquement entre deux mots) ; toucher un clip → 🗑 Supprimer, toucher une coupe → ↺ Restaurer ; poignées pour rogner / rallonger un clip ; tout est annulable. Testé : `tests/browser/derush.e2e.cjs` + tests unitaires (clips, scission, rognage sans toucher aux voisins).
- **Mots parasites** : nouvelle détection acoustique des « euh » que Whisper efface (voyelle tenue ≥ 0,25 s) dans les blancs et collés au début ou à la fin d'un mot anormalement long ; tics de langage en plusieurs mots (« du coup », « en fait », « tu vois », « genre », « quoi » en fin de phrase…) retirés quand ils sont isolés par une pause ou une virgule, simplement proposés sinon ; liste personnelle modifiable (Suggestions › Mes tics de langage). Calibré sur de vraies prises (0 à 12 détections/min, spectrogrammes vérifiés) ; tests unitaires (dont absence de fausses alertes sur une parole normale).
- **Décors** : appui long → mode édition façon iPhone (tremblement, ✕ pour supprimer avec « Annuler » 5 s, glisser pour réordonner, OK) ; ordre et suppressions conservés ; les décors de base peuvent aussi être retirés. Testé : `tests/browser/decor.e2e.cjs`.

## 3.1.0-beta.8
- **Plateau 3D** (Réglages › Plateau 3D, 0 = coupé) : le décor glisse à l'opposé de la tête et grossit un peu quand on s'approche, comme une caméra qui suit. Amorti en ~0,25 s quel que soit le débit d'images, jamais de bord visible. Web et natif. Testé : `tests/browser/stage.e2e.cjs` (sens, amplitude ~3 %, bornes, désactivation).
- **« Je reprends »** : dite pendant la prise (suivie d'une pause), la commande retire la tentative en cours et la commande elle-même au nettoyage (« on recommence », « coupez »… aussi). Retour immédiat « Reprise notée » si la reconnaissance vocale native tourne. Tests unitaires (vraie reprise, phrase normale non touchée, « coupez » en fin).
- **Check studio** (Réglages › Vérifier, et automatique une fois par session si problème) : contre-jour, visage sombre ou surexposé, bruit de fond, tête coupée, décentrée, trop loin ou trop près. Vérifié sur une vraie photo (contre-jour et haut coupé détectés).
- **Bilan de la prise** (onglet Suggestions) : note sur 100, débit en mots/min, tics, silences, reprises, comparaison avec vos 10 dernières prises, conseils.
- **✍️ Publication** : 3 titres, description, hashtags et phrase d'accroche. Gemini Nano sur le téléphone (ML Kit GenAI Prompt API) quand l'appareil le permet, sinon version locale par mots-clés. Copier / Partager. La version locale est testée ; Gemini Nano n'a pas pu être essayé ici (S25 non listé explicitement par Google, à vérifier sur l'appareil).
- Android 8.0 minimum (exigé par ML Kit GenAI).

## 3.1.0-beta.7
- **Sous-titres en anglais** (onglet Sous-titres › 🇬🇧) : Whisper traduit l'audio sur l'appareil, phrase par phrase, puis les mots sont répartis dans le temps (animation karaoké approximative). Les coupes s'appliquent aussi. Enchaînement testé avec un Whisper simulé (takes.e2e) et répartition testée en unitaire. Le vrai modèle n'a pas pu être essayé ici (Hugging Face inaccessible depuis l'environnement de test).
- **Assembler des prises** (Mes prises › ＋ sur chaque prise, dans l'ordre voulu › Assembler) : une seule vidéo, raccords sans clic, chaque image tenue jusqu'à la suivante, puis ouverture du montage. Testé : `tests/browser/assemble.e2e.cjs` (durée = somme exacte, son synchronisé).
- Les modèles d'émission retiennent aussi la langue des sous-titres.

## 3.1.0-beta.6
- **Habillage** (onglet du montage) : images et extraits vidéo insérés en plein écran, en incrustation ou « moi en petit » (Ken Burns, fondus), bandeaux titres en verre sombre. Aperçu identique à l'export. Testé : `tests/browser/dress.e2e.cjs`.
- **Flou d'arrière-plan** : nouveau décor « Flou » = votre vrai fond flouté (effet portrait), moteurs web et natif. Vérifié en navigateur sur une vraie image ; shader natif compilé (GLSL ES 3.00), pas encore essayé sur S25.
- **Modèles d'émission** : style des sous-titres, zooms, voix studio, volume et bandeau d'ouverture enregistrés et réappliqués, avec application automatique aux nouvelles vidéos. Testé (dress.e2e).
- **Préparation Play Store** : écran d'accueil en 3 pages (autorisations expliquées), politique de confidentialité (`public/privacy.html`, aussi dans Réglages), fiche boutique FR/EN et checklist (`docs/play-store/fiche.md`), bundle AAB signé (`gradle bundleRelease`).
- Remarque : le test `live.e2e` (prompteur avec micro simulé) échoue de temps en temps, déjà avant ces changements : le micro simulé est instable sous émulation GPU.

## 3.1.0-beta.5
- **Contours fins (cheveux)** : filtre guidé (He et al.) sur le GPU, dans les deux moteurs — le masque de l'IA (256×256) est affiné en suivant la luminosité de l'image en pleine résolution (6 passes ≤ 960 px, textures demi-flottantes ; repli automatique). Vérifié sur la vraie scène (train, contre-jour) : bord des cheveux naturel au lieu d'un escalier de blocs. Réglage « Contours fins ».
- **Teinte du décor** : le visage prend légèrement la couleur et la clarté moyennes du décor (teinte bornée ±15 %, luminosité −15/+20 %) ; décors vidéo suivis ; réglage dans Visage. Vérifié sur la vraie scène.
- **Prompteur « suit mes mots » hors ligne en natif** : reconnaissance vocale d'Android sur l'appareil (Android 12+), relance continue, repli sur « suit ma voix » si le micro est occupé.
- **Interface « verre sombre »** (esprit iOS actuel) : capsules et feuilles flottantes translucides avec liseré lumineux, partout (caméra, réglages, aperçu, montage, bibliothèque).
- Shaders natifs (rendu + filtre guidé) vérifiés par compilation GLSL ES 3.00.

## 3.1.0-beta.4
- **Voix studio** (`core/voice.ts`) : coupe-bas 80 Hz → débruitage RNNoise (réseau de neurones, WASM, hors ligne, 48 kHz) → égaliseur de voix (−2 dB à 300 Hz, +2,5 dB à 3,2 kHz) → compresseur 3:1 avec expandeur sous −50 dBFS → gain automatique (même niveau de voix qu'en entrée, mesuré pendant la parole). En flux, synchrone avec l'image. Mesuré sur deux vraies prises : bruit de fond −12 et −9 dB, écart voix/bruit +11 et +5 dB, voix au même niveau (−1,5 / −3,9 dB). Option d'export (activée par défaut) ; écoute avant/après (« 🎙 Voix studio » dans le montage).
- **Zooms dynamiques** : 1× / 1,12× (centré sur le visage) à chaque coupe et fin de phrase ; aperçu dans le lecteur, appliqués à l'export.
- **Déclencheur toujours centré en bas** : chaque bouton du bas a sa colonne (le bouton pouvait glisser) ; vérifié dans 5 états de l'écran.

## 3.1.0-beta.3
- **Meilleure prise** (`core/takes.ts`) : la transcription est alignée sur le script du prompteur (programmation dynamique tolérant les reprises, les mots sautés et les erreurs de transcription) ; pour chaque phrase, la prise la plus complète est gardée (la plus récente à égalité), les essais ratés, reprises et hors-script sont retirés, les phrases non dites sont signalées. Intégrée à « ✨ Nettoyer » si la prise suit le script (≥ 40 % des mots reconnus) ; bouton « 🎬 Meilleure prise » et bilan dans Suggestions. Testé : unitaire + `takes.e2e` (prise réelle, Whisper simulé).
- **Export exact avec une source saccadée** : durée de chaque image bornée au segment conservé (la dernière image débordait au-delà de la coupe ; +0,5 s observé). Testé à 4 et 30 i/s.
- **Journal de diagnostic** : erreurs, alertes et événements clés gardés sur le téléphone (200 dernières entrées) ; plantages natifs enregistrés et relus au démarrage suivant ; Réglages › Assistance › Partager (fichier .txt) ; version affichée.

## 3.1.0-beta.2
- **Nettoyage automatique** : « ✨ Nettoyer automatiquement » (aperçu) = transcription + suppression de tous les défauts détectés (bégaiements, y compris ceux effacés par Whisper ; « euh » ; répétitions ; faux départs ; silences longs ; bords muets). Option « Supprimer automatiquement les défauts » (activée par défaut) à la fin de chaque transcription ; « ✨ Tout supprimer » dans Suggestions. Une seule action : ↶ annule tout. Seuil de confiance 0,5 (les suggestions plus incertaines restent proposées). Testé (app.e2e).
- **Moteur natif** (compilé, non testé sur appareil) : décors vidéo animés (MediaPlayer → texture externe → décor, avec fondu) ; réduction du bruit (source micro « communication » d'Android) ; micro branché/débranché détecté et utilisé automatiquement.

## 3.1.0-beta.1 — moteur vidéo natif Android (compilé, NON testé sur appareil : pas d'émulateur ici)
- `android/…/StudioEngine.java` : caméra **CameraX** (16:9, 1080×1920 portrait) → détourage **ML Kit Selfie Segmentation** (sur l'appareil, mode flux) → composition **OpenGL ES 3** (même rendu que la version web : contours affinés, anti-halo, ombre, lumière, peau, chaleur, décor avec fondu) → aperçu sur une `SurfaceView` sous la page (transparente sur le viseur) et enregistrement **MP4 matériel** (MediaRecorder, entrée Surface, H.264 + AAC, micro choisi).
- Image et masque issus de la MÊME image caméra (aucun décalage) ; lumière auto (contre-jour) avec exposition CameraX ; vumètre et prompteur « suit ma voix » alimentés par le micro natif.
- `StudioPlugin.java` : pont avec la page (démarrage, réglages, zone du viseur, décor, micros, enregistrement). La prise MP4 est copiée par morceaux dans « Mes prises » ; montage et export inchangés.
- Sécurité : erreurs natives interceptées (l'app ne se ferme pas) → bascule automatique sur le moteur web pour la session ; choix « Moteur : Natif / Web » dans Réglages.
- Shader natif vérifié par compilation GLSL ES 3.00 (WebGL2) ; APK limité à ARM 64 bits (56 Mo).
- Limites : volume du micro non appliqué en natif (« Volume optimisé » à l'export).

## Correctif alpha.10 (d'après la vidéo alpha.9 : plus aucun gel, 27,9 i/s — mais masque corrompu sur le S25)
- **Masque corrompu** (fond du train conservé, rayures horizontales) : préchauffage sur image factice 256×256 supprimé (ajouté en alpha.8 ; sur le GPU du téléphone, le modèle restait calé sur ce format).
- **Garde-fou** : sortie du modèle anormale pendant ≈ 1,5 s (masque « tout personne » ou rayures : sauts entre lignes > 3× les sauts entre pixels voisins) → détourage relancé automatiquement, même pendant une prise. Seuils vérifiés : masques réels ≈ 0,7–1 (aucune fausse alerte), masques corrompus simulés ≈ 27–31.

## Nouveautés alpha.9 (testées sur une vraie scène : enregistrement de la caméra du S25, contre-jour dans un train)
- **Lumière auto** : corrige le contre-jour (fond réel plus clair que le visage) et les scènes très sombres, sans jamais viser une luminosité fixe (le teint est respecté) ; exposition du capteur si la caméra le permet (`exposureCompensation`), sinon courbe numérique douce ; curseur Lumière ±.
- **Peau** (lissage qui préserve contours, yeux et lunettes) et **Chaleur** ; appliqués au sujet seulement ; enregistrés dans les profils.
- Miniature de la dernière prise sur le bouton « Mes prises » ; vibrations (déclencheur, compte à rebours, objectifs, décors).
- Vérifié sur image fixe de la scène réelle : main dans les cheveux, lunettes, écouteur et cheveux bien détourés (Rapide et Précis).

## Nouveautés alpha.8 (d'après la 2e vidéo : gels de 0,8 s et 0,5 s, disparition du sujet, cadrage trop serré, liseré clair)
- **Plus de gel ni de disparition au changement de modèle** : chaque modèle est préparé et préchauffé dans un worker séparé, puis échangé d'un coup ; jamais de préparation pendant une prise (reportée à la fin, annulée si elle avait commencé) ; mesures ignorées le temps de se stabiliser (plus d'aller-retour Précis ↔ Rapide).
- **L'image n'attend plus l'IA** : si le masque tarde (> 45 ms), l'image est affichée avec le dernier masque.
- **Masque vide ponctuel ignoré** (quelques images) quand une personne était là.
- **Cadrage façon objectifs iPhone** pour les caméras 4:3 : 0,4 (tout le champ), 0,7 (par défaut), 1× (plein cadre) ; image calée en bas du cadre, décor au-dessus ; choix mémorisé.
- **Bords sans liseré** : estimation de la couleur du vrai fond (fenêtre, mur clair) autour du sujet ; les pixels de bord de cette couleur sont retirés et les autres « dé-mélangés ».

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
