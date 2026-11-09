#!/usr/bin/env bash
# Construit l'APK Android signé : npm run apk  (prérequis : JDK 21, SDK Android dans $ANDROID_HOME, android/keystore.properties)
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
npx cap sync android
[ -f android/local.properties ] || echo "sdk.dir=${ANDROID_HOME:?ANDROID_HOME manquant}" > android/local.properties
[ -f android/keystore.properties ] || { echo "android/keystore.properties manquant (clé de signature)"; exit 1; }
cd android && ./gradlew assembleRelease
echo "APK : android/app/build/outputs/apk/release/app-release.apk"
