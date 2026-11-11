/** Pont vers Android (app installée) : enregistrer une vidéo dans la Galerie et ouvrir le partage Android.
 *  Dans le navigateur, ces fonctions ne sont pas utilisées (téléchargement classique). */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export const isNative = () => Capacitor.isNativePlatform();

/** Plugin natif de l'app (android/app/src/main/java/app/greenstudio/GalleryPlugin.java). */
const Gallery = registerPlugin<{ saveVideo(o: { path: string; name: string; mime: string }): Promise<{ uri: string }> }>("Gallery");

const CHUNK = 3 * 1024 * 1024; // multiple de 3 : chaque morceau s'encode en base64 sans remplissage
const b64 = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

/** Copie la vidéo (Blob adossé au disque) dans le cache de l'app, par morceaux : pas de chargement complet en mémoire. */
async function toCache(blob: Blob, name: string, onProgress?: (p: number) => void): Promise<string> {
  await Filesystem.rmdir({ path: "out", directory: Directory.Cache, recursive: true }).catch(() => {}); // une seule copie à la fois
  await Filesystem.mkdir({ path: "out", directory: Directory.Cache, recursive: true }).catch(() => {});
  const path = "out/" + name;
  for (let off = 0; off < blob.size || off === 0; off += CHUNK) {
    const data = await b64(blob.slice(off, off + CHUNK));
    if (off === 0) await Filesystem.writeFile({ path, directory: Directory.Cache, data });
    else await Filesystem.appendFile({ path, directory: Directory.Cache, data });
    onProgress?.(Math.min(1, (off + CHUNK) / (blob.size || 1)));
    if (blob.size === 0) break;
  }
  return (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
}

/** Enregistre dans la Galerie (Movies/Green Studio). */
export async function saveToGallery(blob: Blob, name: string, onProgress?: (p: number) => void) {
  const uri = await toCache(blob, name, onProgress);
  return Gallery.saveVideo({ path: uri, name, mime: blob.type || "video/mp4" });
}

/** Ouvre le partage Android (TikTok, Instagram, WhatsApp, Drive…). */
export async function shareVideo(blob: Blob, name: string, onProgress?: (p: number) => void) {
  const uri = await toCache(blob, name, onProgress);
  await Share.share({ title: "Green Studio", files: [uri], dialogTitle: "Partager la vidéo" });
}

/** Moteur vidéo natif (android/…/StudioPlugin.java) : caméra CameraX, détourage ML Kit, rendu GPU et enregistrement natifs. */
export const Studio = registerPlugin<any>("Studio");
