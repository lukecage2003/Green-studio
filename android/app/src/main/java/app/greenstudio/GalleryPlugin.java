package app.greenstudio;

import android.content.ContentResolver;
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Green Studio");
            values.put(MediaStore.Video.Media.IS_PENDING, 1);
            collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        } else {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "Green Studio");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            values.put(MediaStore.Video.Media.DATA, new File(dir, name).getAbsolutePath());
            collection = MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
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
