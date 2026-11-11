package app.greenstudio;

import android.graphics.Color;
import android.os.Bundle;
import android.view.SurfaceView;
import android.view.ViewGroup;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plantage natif : la cause est écrite dans un fichier, relu au démarrage suivant (journal de diagnostic)
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            try (java.io.PrintWriter w = new java.io.PrintWriter(new java.io.File(getFilesDir(), "last-crash.txt"))) { w.println("fil " + t.getName()); e.printStackTrace(w); } catch (Exception ignored) { }
            if (prev != null) prev.uncaughtException(t, e);
        });
        registerPlugin(GalleryPlugin.class); // avant super.onCreate : les plugins doivent être connus du pont au démarrage
        registerPlugin(StudioPlugin.class);
        registerPlugin(WriterPlugin.class);
        super.onCreate(savedInstanceState);
        // Appli de tournage : l'écran ne s'éteint pas pendant qu'elle est ouverte.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Image du moteur natif : une surface SOUS la page ; la page est transparente à l'endroit du viseur.
        SurfaceView sv = new SurfaceView(this);
        ViewGroup parent = (ViewGroup) bridge.getWebView().getParent();
        parent.addView(sv, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        bridge.getWebView().setBackgroundColor(Color.TRANSPARENT);
        StudioPlugin.surfaceView = sv;
    }
}
