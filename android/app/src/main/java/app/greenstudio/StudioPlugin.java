package app.greenstudio;

import android.Manifest;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioDeviceInfo;
import android.util.Base64;
import android.view.SurfaceView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;

/** Pont entre l'interface (page web) et le moteur vidéo natif. */
@CapacitorPlugin(name = "Studio", permissions = {
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class StudioPlugin extends Plugin {
    static SurfaceView surfaceView; // créée par MainActivity, sous la page
    private StudioEngine engine;

    private StudioEngine engine() {
        if (engine == null) engine = new StudioEngine(getActivity(), surfaceView, new StudioEngine.Listener() {
            @Override public void onStats(int fps, double inferMs, int w, int h, double lightG, Double expo) {
                JSObject o = new JSObject(); o.put("fps", fps); o.put("inferMs", inferMs); o.put("width", w); o.put("height", h); o.put("lightG", lightG);
                if (expo != null) o.put("expo", expo); notifyListeners("stats", o);
            }
            @Override public void onLevel(double rms) { JSObject o = new JSObject(); o.put("rms", rms); notifyListeners("level", o); }
            @Override public void onError(String m) { JSObject o = new JSObject(); o.put("message", m); notifyListeners("error", o); }
        });
        return engine;
    }

    @PluginMethod public void isAvailable(PluginCall call) { JSObject o = new JSObject(); o.put("available", surfaceView != null); call.resolve(o); }

    @PluginMethod public void start(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED || getPermissionState("microphone") != PermissionState.GRANTED) {
            requestAllPermissions(call, "permsDone"); return;
        }
        doStart(call);
    }
    @PermissionCallback private void permsDone(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) { call.reject("Accès caméra refusé", "NotAllowedError"); return; }
        doStart(call);
    }
    private void doStart(PluginCall call) {
        if (surfaceView == null) { call.reject("Moteur natif indisponible"); return; }
        String facing = call.getString("facing", "user");
        getActivity().runOnUiThread(() -> engine().start(facing, (w, h, err) -> {
            if (err != null) { call.reject(err); return; }
            JSObject o = new JSObject(); o.put("width", w); o.put("height", h); call.resolve(o);
        }));
    }

    @PluginMethod public void stop(PluginCall call) { if (engine != null) engine.stop(); call.resolve(); }

    @PluginMethod public void setParams(PluginCall call) {
        StudioEngine.Params p = engine().p; JSObject d = call.getData();
        if (d.has("mirror")) p.mirror = d.optBoolean("mirror", true);
        if (d.has("autoLight")) p.autoLight = d.optBoolean("autoLight", true);
        p.cz = f(d, "cz", p.cz); p.sx = f(d, "sx", p.sx); p.sy = f(d, "sy", p.sy); p.zoom = f(d, "zoom", p.zoom); p.px = f(d, "px", p.px); p.py = f(d, "py", p.py);
        p.br = f(d, "br", p.br); p.ct = f(d, "ct", p.ct); p.sa = f(d, "sa", p.sa); p.lo = f(d, "lo", p.lo); p.hi = f(d, "hi", p.hi);
        p.dsp = f(d, "dsp", p.dsp); p.wrap = f(d, "wrap", p.wrap); p.shd = f(d, "shd", p.shd); p.skin = f(d, "skin", p.skin); p.warm = f(d, "warm", p.warm); p.lgt = f(d, "lgt", p.lgt);
        call.resolve();
    }
    private static float f(JSObject d, String k, float def) { return d.has(k) ? (float) d.optDouble(k, def) : def; }

    /** Zone du viseur dans l'écran, en pixels CSS × densité. */
    @PluginMethod public void setViewport(PluginCall call) {
        StudioEngine.Params p = engine().p; double dpr = call.getDouble("dpr", 1.0);
        int[] loc = new int[2]; if (surfaceView != null) surfaceView.getLocationOnScreen(loc);
        int[] wl = new int[2]; bridge.getWebView().getLocationOnScreen(wl);
        p.vx = (int) Math.round(call.getDouble("x", 0.0) * dpr) + wl[0] - loc[0];
        p.vy = (int) Math.round(call.getDouble("y", 0.0) * dpr) + wl[1] - loc[1];
        p.vw = (int) Math.round(call.getDouble("w", 0.0) * dpr); p.vh = (int) Math.round(call.getDouble("h", 0.0) * dpr);
        call.resolve();
    }

    /** Décor : image JPEG/PNG en base64. */
    @PluginMethod public void setBackground(PluginCall call) {
        String data = call.getString("data"); if (data == null) { call.reject("Image manquante"); return; }
        int comma = data.indexOf(','); byte[] b = Base64.decode(comma >= 0 ? data.substring(comma + 1) : data, Base64.DEFAULT);
        Bitmap bmp = BitmapFactory.decodeByteArray(b, 0, b.length);
        if (bmp == null) { call.reject("Image illisible"); return; }
        engine().setBackground(bmp); call.resolve();
    }

    @PluginMethod public void startRecording(PluginCall call) {
        try {
            String path = engine().startRecording(getContext().getCacheDir(), call.getInt("width", 1080), call.getInt("height", 1920), call.getInt("bitrate", 14000000));
            JSObject o = new JSObject(); o.put("path", path); call.resolve(o);
        } catch (Exception e) { call.reject("Enregistrement impossible : " + e.getMessage()); }
    }

    @PluginMethod public void stopRecording(PluginCall call) {
        new Thread(() -> {
            try { File f = engine().stopRecording(); JSObject o = new JSObject(); o.put("path", f.getAbsolutePath()); o.put("size", f.length()); call.resolve(o); }
            catch (Exception e) { call.reject("Arrêt impossible : " + e.getMessage()); }
        }).start();
    }

    /** Supprime le fichier natif une fois la prise copiée dans la bibliothèque de l'app. */
    @PluginMethod public void discard(PluginCall call) {
        String p = call.getString("path"); if (p != null && p.startsWith(getContext().getCacheDir().getAbsolutePath())) new File(p).delete();
        call.resolve();
    }

    @PluginMethod public void listMics(PluginCall call) {
        JSArray a = new JSArray();
        for (AudioDeviceInfo d : engine().mics()) { JSObject o = new JSObject(); o.put("id", String.valueOf(d.getId())); o.put("label", label(d)); a.put(o); }
        JSObject o = new JSObject(); o.put("mics", a); call.resolve(o);
    }
    @PluginMethod public void setMic(PluginCall call) {
        String id = call.getString("id", ""); AudioDeviceInfo pick = null;
        for (AudioDeviceInfo d : engine().mics()) if (String.valueOf(d.getId()).equals(id)) pick = d;
        engine().setMic(pick); call.resolve();
    }
    private static String label(AudioDeviceInfo d) {
        switch (d.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_MIC: return "Micro du téléphone";
            case AudioDeviceInfo.TYPE_USB_DEVICE: case AudioDeviceInfo.TYPE_USB_HEADSET: return "USB · " + d.getProductName();
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO: case 26 /* TYPE_BLE_HEADSET */: return "Bluetooth · " + d.getProductName();
            case AudioDeviceInfo.TYPE_WIRED_HEADSET: return "Micro filaire";
            default: return String.valueOf(d.getProductName());
        }
    }

    @Override protected void handleOnDestroy() { if (engine != null) engine.release(); engine = null; }
}
