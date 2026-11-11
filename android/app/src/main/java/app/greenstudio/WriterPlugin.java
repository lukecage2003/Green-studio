package app.greenstudio;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.GenAiException;
import com.google.mlkit.genai.prompt.GenerateContentRequest;
import com.google.mlkit.genai.prompt.GenerateContentResponse;
import com.google.mlkit.genai.prompt.Generation;
import com.google.mlkit.genai.prompt.TextPart;
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Rédaction sur l'appareil avec Gemini Nano (ML Kit GenAI, API Prompt) : titres, description, hashtags, accroche.
 * Rien ne quitte le téléphone. Si l'appareil ne le permet pas, status() renvoie 0 et l'app utilise sa version locale simple.
 */
@CapacitorPlugin(name = "Writer")
public class WriterPlugin extends Plugin {
    private static final String TAG = "GS-Writer";
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private GenerativeModelFutures model;

    private GenerativeModelFutures model() {
        if (model == null) model = GenerativeModelFutures.from(Generation.INSTANCE.getClient());
        return model;
    }

    private <T> void then(ListenableFuture<T> f, PluginCall call, java.util.function.Consumer<T> ok) {
        f.addListener(() -> {
            try { ok.accept(f.get()); }
            catch (Throwable t) { Throwable c = t.getCause() != null ? t.getCause() : t; Log.w(TAG, "échec", c); call.reject(String.valueOf(c.getMessage()), c instanceof GenAiException ? String.valueOf(((GenAiException) c).getErrorCode()) : null); }
        }, exec);
    }

    /** 0 indisponible, 1 téléchargeable, 2 téléchargement en cours, 3 prêt. */
    @PluginMethod
    public void status(PluginCall call) {
        try { then(model().checkStatus(), call, (s) -> { JSObject o = new JSObject(); o.put("status", s); call.resolve(o); }); }
        catch (Throwable t) { JSObject o = new JSObject(); o.put("status", 0); o.put("reason", String.valueOf(t.getMessage())); call.resolve(o); }
    }

    @PluginMethod
    public void download(PluginCall call) {
        try {
            then(model().download(new DownloadCallback() {
                long total = 0;
                @Override public void onDownloadStarted(long bytes) { total = bytes; }
                @Override public void onDownloadProgress(long done) { JSObject o = new JSObject(); o.put("p", total > 0 ? (double) done / total : 0); notifyListeners("progress", o); }
            }), call, (v) -> call.resolve());
        } catch (Throwable t) { call.reject(String.valueOf(t.getMessage())); }
    }

    @PluginMethod
    public void generate(PluginCall call) {
        String prompt = call.getString("prompt", "");
        try {
            GenerateContentRequest.Builder b = new GenerateContentRequest.Builder(new TextPart(prompt));
            b.setTemperature(call.getFloat("temperature", .6f)); b.setMaxOutputTokens(call.getInt("maxTokens", 256)); b.setTopK(16);
            then(model().generateContent(b.build()), call, (GenerateContentResponse r) -> {
                StringBuilder sb = new StringBuilder(); if (r.getCandidates() != null && !r.getCandidates().isEmpty()) sb.append(r.getCandidates().get(0).getText());
                JSObject o = new JSObject(); o.put("text", sb.toString()); call.resolve(o);
            });
        } catch (Throwable t) { call.reject(String.valueOf(t.getMessage())); }
    }
}
