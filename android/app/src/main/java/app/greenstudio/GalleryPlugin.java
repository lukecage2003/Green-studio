package app.greenstudio;

import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import androidx.core.content.FileProvider;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/** Range une vidéo du cache de l'app dans la Galerie (Movies/Green Studio) via MediaStore, sans autorisation sur Android 10+. */
@CapacitorPlugin(name = "Gallery")
public class GalleryPlugin extends Plugin {

    /** Ouvre directement une app (TikTok) avec la vidéo du cache, sans passer par la feuille de partage. */
    @PluginMethod
    public void shareToApp(PluginCall call) {
        String path = call.getString("path"), pkg = call.getString("pkg"), text = call.getString("text");
        if (path == null || pkg == null) { call.reject("Paramètres manquants"); return; }
        File f = new File(Uri.parse(path).getPath());
        if (!f.exists()) { call.reject("Fichier introuvable"); return; }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("video/*"); i.putExtra(Intent.EXTRA_STREAM, uri);
        if (text != null) i.putExtra(Intent.EXTRA_TEXT, text);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        i.setPackage(pkg);
        try { getContext().startActivity(i); call.resolve(); }
        catch (ActivityNotFoundException e) { call.reject("absent"); }
    }

    @PluginMethod
    public void saveVideo(PluginCall call) {
        String path = call.getString("path");
        String name = call.getString("name", "green-studio.mp4");
        String mime = call.getString("mime", "video/mp4");
        if (path == null) { call.reject("Chemin manquant"); return; }
        File src = new File(Uri.parse(path).getPath());
        if (!src.exists()) { call.reject("Fichier introuvable"); return; }

        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Video.Media.DISPLAY_NAME, name);
        values.put(MediaStore.Video.Media.MIME_TYPE, mime);
        Uri collection;
        boolean img = mime.startsWith("image/"); // miniatures : rangées dans Images/Green Studio
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(MediaStore.Video.Media.RELATIVE_PATH, (img ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_MOVIES) + "/Green Studio");
            values.put(MediaStore.Video.Media.IS_PENDING, 1);
            collection = img ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) : MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        } else {
            File dir = new File(Environment.getExternalStoragePublicDirectory(img ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_MOVIES), "Green Studio");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            values.put(MediaStore.Video.Media.DATA, new File(dir, name).getAbsolutePath());
            collection = img ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI : MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
        }

        Uri item = null;
        try {
            item = resolver.insert(collection, values);
            if (item == null) throw new Exception("La Galerie a refusé le fichier");
            try (InputStream in = new FileInputStream(src); OutputStream out = resolver.openOutputStream(item)) {
                if (out == null) throw new Exception("Écriture impossible");
                byte[] buf = new byte[1 << 20];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues done = new ContentValues();
                done.put(MediaStore.Video.Media.IS_PENDING, 0);
                resolver.update(item, done, null, null);
            }
            //noinspection ResultOfMethodCallIgnored
            src.delete();
            JSObject ret = new JSObject();
            ret.put("uri", item.toString());
            call.resolve(ret);
        } catch (Exception e) {
            if (item != null) resolver.delete(item, null, null);
            call.reject(e.getMessage() != null ? e.getMessage() : "Erreur d'enregistrement", e);
        }
    }
}
