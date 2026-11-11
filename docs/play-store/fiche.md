# Fiche Google Play – Green Studio

## Nom
Un concurrent s'appelle déjà **« Green Screen Studio »** (incrustation sur fond vert, App Store, et peut-être aussi Google Play). Pour éviter la confusion et faire ressortir l'app dans la recherche, on garde la marque en tête de titre et on ajoute ce qu'elle fait :

- **Titre (30 car. max)** : `Green Studio : Fond sans vert` (29 car.)
- Autres titres possibles : `Green Studio – Décor & Prompteur`, `Green Studio AI Backdrop`
- Avant de publier : rechercher « Green Studio » dans la Play Console et sur l'INPI/EUIPO (marques), puis vérifier que le domaine/pseudo est libre.

## Description courte (80 car. max)
FR : `Décor virtuel sans fond vert, prompteur vocal et montage auto, tout hors ligne.` (79 car.)
EN : `Virtual background without green screen, voice teleprompter & auto-editing.` (76 car.)

## Description longue (FR)
Filmez-vous devant n'importe quel décor, **sans fond vert**. Green Studio détoure votre silhouette en direct, cheveux compris, et ajuste la lumière de votre visage au décor choisi. Les vidéos sont au format vertical 9:16, prêtes pour TikTok, Reels et Shorts.

**Tournage**
• Détourage en direct accéléré par le processeur graphique, contours fins pour les cheveux
• Décors photo, vidéo ou dégradés, ou votre vrai fond flouté (effet portrait)
• Lumière du visage accordée au décor, retouche peau, objectifs grand-angle/serré
• Prompteur qui suit votre voix, hors ligne
• Choix du micro (filaire, Bluetooth, USB) et vumètre

**Montage par le texte**
• Transcription automatique sur l'appareil
• Bégaiements, « euh », silences et reprises supprimés en un geste
• Meilleure prise choisie d'après votre script
• Voix studio : bruit de fond réduit, voix compressée et égalisée
• Sous-titres animés, zooms dynamiques, images et extraits incrustés, bandeaux titres
• Modèles d'émission pour réappliquer votre style en un geste
• Export 1080p, volume optimisé pour les réseaux (−14 LUFS)

**Confidentialité** : aucun compte, aucune publicité, aucune vidéo envoyée. Tout est traité sur votre téléphone.

## Long description (EN)
Film yourself in front of any backdrop, **no green screen needed**. Green Studio cuts out your silhouette live, hair included, and matches your face lighting to the backdrop you pick. Videos are vertical 9:16, ready for TikTok, Reels and Shorts.

• GPU-accelerated live cutout with fine hair edges
• Photo, video or gradient backdrops, or your real background blurred (portrait effect)
• Offline teleprompter that follows your voice
• Text-based editing: stutters, filler words, silences and retakes removed in one tap
• Best take picked from your script, studio voice, animated captions, dynamic zooms, B-roll and lower thirds
• Show templates, 1080p export, social-ready loudness
• No account, no ads, nothing uploaded. Everything stays on your phone.

## Catégorie et classification
- Catégorie : **Vidéo et montage** (Video Players & Editors)
- Questionnaire de classification : aucun contenu sensible, donc classification « Tout public » (PEGI 3)
- Public cible : 13 ans et plus (évite les obligations « Familles »)

## Sécurité des données (formulaire Data safety)
- ⚠ Google ML Kit (détourage, Gemini Nano) envoie des diagnostics anonymes à Google. Selon la documentation ML Kit, déclarer « Infos et performances de l'app : journaux de plantage, diagnostics » et « Appareil ou autres identifiants », collectés (non partagés), à des fins d'analyse, sans lien avec l'identité. À revérifier avec la page « ML Kit data disclosure » au moment de publier.
- Données personnelles collectées par l'app elle-même : **aucune**
- Données partagées : **aucune**
- Chiffrement en transit : sans objet (aucune donnée envoyée). Les modèles sont téléchargés en HTTPS.
- Suppression des données : sans objet. Tout est local et supprimé à la désinstallation.

## Politique de confidentialité
Fichier : `public/privacy.html` (aussi intégré dans l'app : Réglages › Confidentialité).
Il faut une **URL publique** : activer GitHub Pages sur le dépôt (ou héberger le fichier n'importe où) et coller l'URL dans la Play Console.

## Éléments graphiques à fournir
- Icône 512×512 PNG (`public/icons/icon-512.png`)
- Image de présentation 1024×500
- 2 à 8 captures téléphone (9:16, de 1080×1920 environ) : tournage avec décor, flou, montage texte, sous-titres, habillage, export
- Vidéo YouTube facultative (30 s de démonstration)

## Checklist de publication
1. Compte développeur Google Play (25 $, une seule fois) et vérification d'identité
2. Pour un compte personnel créé après nov. 2023 : **test fermé avec au moins 12 testeurs pendant 14 jours** avant la production
3. Envoyer `green-studio-release.aab` (signé avec la clé d'envoi). Activer la signature d'application par Google Play.
4. **Garder précieusement la clé de signature** (`.jks` + mots de passe), sauvegardée hors du téléphone
5. Remplir la fiche, le formulaire Data safety, la classification, le public cible et l'URL de confidentialité
6. Déclaration des autorisations : caméra et micro sont au cœur de l'app, rien de spécial à déclarer
