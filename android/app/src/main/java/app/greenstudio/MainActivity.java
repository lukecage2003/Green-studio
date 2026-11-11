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
        registerPlugin(GalleryPlugin.class); // avant super.onCreate : les plugins doivent être connus du pont au démarrage
        registerPlugin(StudioPlugin.class);
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
