package app.greenstudio;

import android.Manifest;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.content.Context;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import java.util.ArrayList;
import android.os.Looper;
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

    /** Cause du dernier plantage natif (puis effacée). */
    @PluginMethod public void lastCrash(PluginCall call) {
        File f = new File(getContext().getFilesDir(), "last-crash.txt"); JSObject o = new JSObject();
        if (f.exists()) { try (java.io.FileInputStream in = new java.io.FileInputStream(f)) { byte[] b = new byte[(int) Math.min(f.length(), 64000)]; int n = in.read(b); String s = new String(b, 0, Math.max(0, n), java.nio.charset.StandardCharsets.UTF_8); o.put("text", s.length() > 4000 ? s.substring(0, 4000) : s); } catch (Exception ignored) { } f.delete(); }
        call.resolve(o);
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
        p.dsp = f(d, "dsp", p.dsp); p.wrap = f(d, "wrap", p.wrap); p.shd = f(d, "shd", p.shd); p.skin = f(d, "skin", p.skin); p.warm = f(d, "warm", p.warm); p.lgt = f(d, "lgt", p.lgt); p.harm = f(d, "harm", p.harm);
        if (d.has("fine")) p.fine = d.optBoolean("fine", true);
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

    /** Décor vidéo : fichier local (copié par la page dans le cache de l'app). */
    @PluginMethod public void setBackgroundVideo(PluginCall call) {
        String p = call.getString("path"); if (p == null) { call.reject("Fichier manquant"); return; }
        engine().setBackgroundVideo(p); call.resolve();
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

    @PluginMethod public void setAudio(PluginCall call) { engine().setNoiseSuppression(call.getBoolean("noiseSuppression", false)); call.resolve(); }

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

    /** Micro branché / débranché : la page en est informée (elle bascule automatiquement, comme en version web). */
    @Override public void load() {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        am.registerAudioDeviceCallback(new AudioDeviceCallback() {
            @Override public void onAudioDevicesAdded(AudioDeviceInfo[] ds) { report("added", ds); }
            @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] ds) { report("removed", ds); }
        }, new Handler(Looper.getMainLooper()));
    }
    private void report(String kind, AudioDeviceInfo[] ds) {
        JSArray a = new JSArray();
        for (AudioDeviceInfo d : ds) if (d.isSource() && d.getType() != AudioDeviceInfo.TYPE_BUILTIN_MIC && d.getType() != AudioDeviceInfo.TYPE_TELEPHONY && d.getType() != AudioDeviceInfo.TYPE_REMOTE_SUBMIX) {
            JSObject o = new JSObject(); o.put("id", String.valueOf(d.getId())); o.put("label", label(d)); a.put(o);
        }
        if (a.length() == 0) return;
        JSObject o = new JSObject(); o.put("kind", kind); o.put("mics", a); notifyListeners("mics", o);
    }

    /* ---------- Prompteur « suit mes mots » : reconnaissance vocale SUR L'APPAREIL (Android 12+), sans internet ---------- */
    private SpeechRecognizer words; private boolean wordsOn; private final Handler ui = new Handler(Looper.getMainLooper());
    @PluginMethod public void startWords(PluginCall call) {
        String lang = call.getString("lang", "fr-FR");
        ui.post(() -> {
            Context c = getContext();
            boolean onDevice = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(c);
            if (!onDevice && !SpeechRecognizer.isRecognitionAvailable(c)) { call.reject("Reconnaissance vocale indisponible"); return; }
            stopWordsNow();
            words = onDevice ? SpeechRecognizer.createOnDeviceSpeechRecognizer(c) : SpeechRecognizer.createSpeechRecognizer(c);
            wordsOn = true;
            final Intent it = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang).putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                    .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L);
            words.setRecognitionListener(new RecognitionListener() {
                private void send(Bundle b, boolean fin) {
                    ArrayList<String> r = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (r == null || r.isEmpty()) return;
                    JSObject o = new JSObject(); o.put("text", r.get(0)); o.put("final", fin); notifyListeners("words", o);
                }
                private void again() { if (wordsOn && words != null) ui.postDelayed(() -> { if (wordsOn && words != null) try { words.startListening(it); } catch (Exception ignored) { } }, 120); }
                @Override public void onPartialResults(Bundle b) { send(b, false); }
                @Override public void onResults(Bundle b) { send(b, true); again(); }
                @Override public void onError(int e) {
                    boolean fatal = e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS || e == 12 /* LANGUAGE_NOT_SUPPORTED */ || e == 13 /* LANGUAGE_UNAVAILABLE */ || e == SpeechRecognizer.ERROR_AUDIO;
                    if (fatal) { JSObject o = new JSObject(); o.put("code", e); notifyListeners("wordsError", o); stopWordsNow(); } else again();
                }
                @Override public void onReadyForSpeech(Bundle b) { }
                @Override public void onBeginningOfSpeech() { }
                @Override public void onRmsChanged(float v) { }
                @Override public void onBufferReceived(byte[] b) { }
                @Override public void onEndOfSpeech() { }
                @Override public void onEvent(int t, Bundle b) { }
            });
            words.startListening(it);
            JSObject o = new JSObject(); o.put("onDevice", onDevice); call.resolve(o);
        });
    }
    @PluginMethod public void stopWords(PluginCall call) { ui.post(this::stopWordsNow); call.resolve(); }
    private void stopWordsNow() { wordsOn = false; if (words != null) { try { words.cancel(); words.destroy(); } catch (Exception ignored) { } words = null; } }

    @Override protected void handleOnDestroy() {
        stopWordsNow(); if (engine != null) engine.release(); engine = null; }
}
