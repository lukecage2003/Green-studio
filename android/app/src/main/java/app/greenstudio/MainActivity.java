package app.greenstudio;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GalleryPlugin.class); // avant super.onCreate : le plugin doit être connu du pont au démarrage
        super.onCreate(savedInstanceState);
        // Appli de tournage : l'écran ne s'éteint pas pendant qu'elle est ouverte.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
