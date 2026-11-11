package app.greenstudio;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.SurfaceTexture;
import android.media.MediaPlayer;
import android.net.Uri;
import android.opengl.GLES11Ext;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLExt;
import android.opengl.EGLSurface;
import android.opengl.GLES30;
import android.opengl.GLUtils;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.util.Range;
import android.util.Size;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ExposureState;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.resolutionselector.AspectRatioStrategy;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.segmentation.Segmentation;
import com.google.mlkit.vision.segmentation.SegmentationMask;
import com.google.mlkit.vision.segmentation.Segmenter;
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Moteur vidéo natif : caméra (CameraX, 16:9 portrait) → détourage (ML Kit, sur l'appareil) → composition GPU (OpenGL ES 3)
 * → aperçu (SurfaceView sous l'interface web) et enregistrement MP4 matériel (MediaRecorder, entrée Surface).
 * L'image affichée et le masque proviennent de la MÊME image caméra : aucun décalage entre la personne et son contour.
 */
public class StudioEngine {
    private static final String TAG = "StudioEngine";

    public interface Listener {
        void onStats(int fps, double inferMs, int camW, int camH, double lightG, Double expo);
        void onLevel(double rms);
        void onError(String message);
    }
    public interface StartCallback { void done(int w, int h, String error); }

    /** Réglages envoyés par l'interface (mêmes noms que dans la page). */
    public static class Params {
        public volatile boolean mirror = true, autoLight = true;
        public volatile float cz = 1, sx = 0, sy = 0, zoom = 1, px = 0, py = 0, br = 0, ct = 1, sa = 1;
        public volatile float lo = .35f, hi = .65f, dsp = .6f, wrap = .3f, shd = .25f, skin = .25f, warm = 0, lgt = 0, harm = .5f;
        public volatile boolean fine = true; // contours fins (filtre guidé)
        public volatile boolean blurBg; // décor « Flou » : vrai fond de la caméra, flouté
        public volatile int vx, vy, vw, vh; // zone du viseur dans la surface (pixels physiques)
    }

    private final AppCompatActivity act;
    private final SurfaceView view;
    private final Listener listener;
    public final Params p = new Params();

    private final HandlerThread glThread = new HandlerThread("studio-gl");
    private Handler gl;
    private final ExecutorService analysis = Executors.newSingleThreadExecutor();
    private Segmenter segmenter;
    private ProcessCameraProvider provider;
    private Camera camera;

    // EGL / GL
    private EGLDisplay dpy = EGL14.EGL_NO_DISPLAY;
    private EGLContext ctx = EGL14.EGL_NO_CONTEXT;
    private EGLConfig cfg;
    private EGLSurface pbuf = EGL14.EGL_NO_SURFACE, win = EGL14.EGL_NO_SURFACE, recSurf = EGL14.EGL_NO_SURFACE;
    private int winW, winH, prog, vbo;
    private final int[] tex = new int[6]; // Y, U, V, masque, décor, décor précédent
    private int bgW = 1, bgH = 1, bg2W = 1, bg2H = 1;
    private long mixT0 = -100000;
    private final java.util.HashMap<String, Integer> U = new java.util.HashMap<>();
    private byte[] uArr, vArr;

    // État caméra / mesures
    private volatile int camW, camH; // taille de l'image remise droite (portrait)
    private volatile boolean running;
    private int frames; private double inferMs; private long statsT0 = SystemClock.uptimeMillis();
    private volatile Double subjLum, bgLum; private volatile double lightG = 1; private int lumN;
    private int expoIdx = 0; private long expoT = 0;

    // Enregistrement / audio
    private MediaRecorder recorder; private File recFile; private long recT0;
    private volatile AudioDeviceInfo mic;
    /** Réduction du bruit : source « communication » d'Android (réduction de bruit matérielle) au lieu de la source vidéo. */
    public volatile boolean noiseSuppression;
    private int audioSource() { return noiseSuppression ? MediaRecorder.AudioSource.VOICE_COMMUNICATION : MediaRecorder.AudioSource.CAMCORDER; }
    public void setNoiseSuppression(boolean on) { noiseSuppression = on; if (meter != null) { stopMeter(); startMeter(); } }
    private AudioRecord meter; private volatile boolean metering;
    private final Handler main = new Handler(Looper.getMainLooper());

    public StudioEngine(AppCompatActivity act, SurfaceView view, Listener listener) {
        this.act = act; this.view = view; this.listener = listener;
        glThread.start(); gl = new Handler(glThread.getLooper());
        gl.post(() -> { try { initGl(); } catch (Throwable t) { Log.e(TAG, "GPU", t); fail("GPU : " + t.getMessage()); } });
        view.getHolder().addCallback(new SurfaceHolder.Callback() {
            @Override public void surfaceCreated(@NonNull SurfaceHolder h) { gl.post(() -> makeWindow(h.getSurface())); }
            @Override public void surfaceChanged(@NonNull SurfaceHolder h, int f, int w, int hh) { winW = w; winH = hh; }
            @Override public void surfaceDestroyed(@NonNull SurfaceHolder h) { gl.post(() -> dropWindow()); }
        });
        if (view.getHolder().getSurface() != null && view.getHolder().getSurface().isValid()) {
            winW = view.getWidth(); winH = view.getHeight(); gl.post(() -> makeWindow(view.getHolder().getSurface()));
        }
        segmenter = Segmentation.getClient(new SelfieSegmenterOptions.Builder()
                .setDetectorMode(SelfieSegmenterOptions.STREAM_MODE).enableRawSizeMask().build());
    }

    /* ======================= Caméra ======================= */

    public void start(String facing, StartCallback cb) {
        ListenableFuture<ProcessCameraProvider> f = ProcessCameraProvider.getInstance(act);
        f.addListener(() -> {
            try {
                provider = f.get();
                provider.unbindAll();
                ResolutionSelector rs = new ResolutionSelector.Builder()
                        .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
                        .setResolutionStrategy(new ResolutionStrategy(new Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
                        .build();
                ImageAnalysis ia = new ImageAnalysis.Builder()
                        .setResolutionSelector(rs)
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
                        .build();
                ia.setAnalyzer(analysis, this::analyze);
                CameraSelector sel = "environment".equals(facing) ? CameraSelector.DEFAULT_BACK_CAMERA : CameraSelector.DEFAULT_FRONT_CAMERA;
                camera = provider.bindToLifecycle(act, sel, ia);
                p.mirror = !"environment".equals(facing);
                expoIdx = 0; subjLum = null; bgLum = null;
                running = true;
                startMeter();
                // la taille réelle n'est connue qu'à la première image : on répond dès qu'elle arrive
                waitFirstFrame(cb, 0);
            } catch (Exception e) {
                Log.e(TAG, "caméra", e);
                cb.done(0, 0, e.getMessage() != null ? e.getMessage() : "Caméra indisponible");
            }
        }, ContextCompat.getMainExecutor(act));
    }

    private void waitFirstFrame(StartCallback cb, int tries) {
        if (camW > 0) { cb.done(camW, camH, null); return; }
        if (tries > 60) { cb.done(0, 0, "La caméra ne fournit pas d'image"); return; }
        main.postDelayed(() -> waitFirstFrame(cb, tries + 1), 100);
    }

    public void stop() {
        running = false; stopMeter();
        main.post(() -> { if (provider != null) provider.unbindAll(); });
    }

    /** Une image caméra : détourage puis composition de CETTE image avec SON masque. */
    @androidx.annotation.OptIn(markerClass = androidx.camera.core.ExperimentalGetImage.class)
    private void analyze(@NonNull ImageProxy img) {
        try { analyzeUnsafe(img); } catch (Throwable t) { Log.e(TAG, "analyse", t); img.close(); fail("Analyse : " + t.getMessage()); }
    }
    @androidx.annotation.OptIn(markerClass = androidx.camera.core.ExperimentalGetImage.class)
    private void analyzeUnsafe(@NonNull ImageProxy img) {
        if (!running || img.getImage() == null) { img.close(); return; }
        int rot = img.getImageInfo().getRotationDegrees();
        int w = img.getWidth(), h = img.getHeight();
        boolean swap = rot == 90 || rot == 270;
        camW = swap ? h : w; camH = swap ? w : h;
        final long t0 = SystemClock.uptimeMillis();
        InputImage in = InputImage.fromMediaImage(img.getImage(), rot);
        segmenter.process(in).addOnSuccessListener(analysis, (SegmentationMask m) -> {
            int mw = m.getWidth(), mh = m.getHeight();
            ByteBuffer raw = m.getBuffer(); raw.rewind(); raw.order(ByteOrder.nativeOrder());
            FloatBuffer fb = raw.asFloatBuffer();
            byte[] mask = new byte[mw * mh];
            for (int i = 0; i < mask.length; i++) { float v = fb.get(i); mask[i] = (byte) (v <= 0 ? 0 : v >= 1 ? 255 : (int) (v * 255)); }
            double ms = SystemClock.uptimeMillis() - t0; inferMs += (ms - inferMs) * .15;
            if (++lumN % 6 == 0) measureLight(img, rot, mask, mw, mh);
            gl.post(() -> { try { render(img, rot, mask, mw, mh); } catch (Throwable t) { Log.e(TAG, "rendu", t); fail("Rendu : " + t.getMessage()); } finally { img.close(); } });
        }).addOnFailureListener(analysis, e -> { Log.w(TAG, "détourage", e); img.close(); });
    }

    /* ======================= Lumière auto ======================= */
    // Même règle que la version web : on corrige le CONTRE-JOUR (fond réel bien plus clair que le visage) et les scènes très
    // sombres, jamais vers une luminosité fixe (le teint est respecté). Exposition du capteur si possible, sinon courbe numérique.

    private void measureLight(ImageProxy img, int rot, byte[] mask, int mw, int mh) {
        ImageProxy.PlaneProxy yp = img.getPlanes()[0]; ByteBuffer yb = yp.getBuffer(); int rs = yp.getRowStride();
        int w = img.getWidth(), h = img.getHeight();
        double s = 0, sw = 0, b = 0; int bw = 0;
        for (int j = 0; j < 32; j++) for (int i = 0; i < 32; i++) {
            float u = (i + .5f) / 32, v = (j + .5f) / 32;
            float a = (mask[Math.min(mh - 1, (int) (v * mh)) * mw + Math.min(mw - 1, (int) (u * mw))] & 0xff) / 255f;
            float[] sv = toSensor(u, v, rot);
            int x = Math.min(w - 1, (int) (sv[0] * w)), y = Math.min(h - 1, (int) (sv[1] * h));
            double l = (yb.get(y * rs + x) & 0xff) / 255.0;
            if (a > .6f) { s += a * l; sw += a; } else if (a < .2f) { b += l; bw++; }
        }
        if (sw > 20) {
            double sl = s / sw; subjLum = subjLum == null ? sl : subjLum * .7 + sl * .3;
            if (bw > 20) { double bl = b / bw; bgLum = bgLum == null ? bl : bgLum * .7 + bl * .3; }
        }
        Double t = lightTarget(); double gt = Math.exp(p.lgt * .7);
        if (p.autoLight && t != null && subjLum != null) { double l = Math.min(.95, Math.max(.03, subjLum)); gt = Math.log(1 - t) / Math.log(1 - l); }
        gt = Math.min(2.2, Math.max(.8, gt)); lightG += (gt - lightG) * .5;
        adjustExposure(t);
    }

    private Double lightTarget() {
        if (subjLum == null) return null;
        double t = subjLum, r = bgLum != null ? bgLum / Math.max(.02, subjLum) : 1;
        if (r > 1.4) t = subjLum * Math.min(1.8, Math.sqrt(r / 1.4));
        if (subjLum < .2) t = Math.max(t, Math.min(.26, subjLum * 1.8));
        return Math.min(.8, t * Math.pow(1.35, p.lgt * 2));
    }

    private void adjustExposure(Double target) {
        if (camera == null || target == null || subjLum == null) return;
        long now = SystemClock.uptimeMillis(); if (now - expoT < 700) return; expoT = now;
        ExposureState es = camera.getCameraInfo().getExposureState();
        if (!es.isExposureCompensationSupported()) return;
        int want = expoIdx;
        if (!p.autoLight) want = 0;
        else { double err = target - subjLum; if (Math.abs(err) > .05) want += (err > 0 ? 1 : -1) * (Math.abs(err) > .15 ? 2 : 1); }
        Range<Integer> r = es.getExposureCompensationRange();
        want = Math.max(r.getLower(), Math.min(r.getUpper(), want));
        if (want != expoIdx) { expoIdx = want; camera.getCameraControl().setExposureCompensationIndex(want); }
    }

    /* ======================= GPU ======================= */

    private static final String VS = "#version 300 es\nin vec2 p; out vec2 v;\nvoid main(){ v = vec2(p.x*.5+.5, .5-p.y*.5); gl_Position = vec4(p,0.,1.); }";

    // Même composition que la version web (contours affinés, anti-halo, ombre, lumière, peau, décor), caméra lue en YUV.
    private static final String FS = "#version 300 es\nprecision highp float; in vec2 v; out vec4 o;\n"
        + "uniform sampler2D uY,uU,uV,uMask,uBg,uBg2,uGF; uniform int uRot; uniform float uUseGF; uniform vec4 uHarm; uniform float uBlurBg;\n"
        + "uniform vec2 uCS,uCO,uBS,uBO,uBS2,uBO2,uEdge,uPx,uSub,uSL; uniform float uMir,uBr,uCt,uSa,uMix,uSkin; uniform vec3 uFx;\n"
        + "vec2 sensor(vec2 c){ if(uRot==90) return vec2(c.y,1.-c.x); if(uRot==270) return vec2(1.-c.y,c.x); if(uRot==180) return 1.-c; return c; }\n"
        + "vec3 cam(vec2 c){ vec2 s=sensor(clamp(c,0.,1.)); float y=texture(uY,s).r, u=texture(uU,s).r-.5, w=texture(uV,s).r-.5;\n"
        + "  return clamp(vec3(y+1.402*w, y-.344136*u-.714136*w, y+1.772*u),0.,1.); }\n"
        + "float M(vec2 c){ return texture(uMask,c).r; }\n"
        + "float inside(vec2 c){ vec2 e=smoothstep(vec2(0.),vec2(.012),c)*smoothstep(vec2(0.),vec2(.012),1.-c); return e.x*e.y; }\n"
        + "vec3 grade(vec3 c){ c+=uBr; c=(c-.5)*uCt+.5; float l=dot(c,vec3(.2126,.7152,.0722)); return clamp(mix(vec3(l),c,uSa),0.,1.); }\n"
        + "float refined(vec2 cu){ float m0=M(cu);\n"
        + "  if(m0<.01||m0>.99){ vec2 r=uPx*14.; float s4=M(cu+vec2(r.x,0.))+M(cu-vec2(r.x,0.))+M(cu+vec2(0.,r.y))+M(cu-vec2(0.,r.y)); if(m0<.01?s4<.04:s4>3.96) return m0; }\n"
        + "  vec3 c0=cam(cu); float sw=1., sm=m0;\n"
        + "  for(int i=0;i<8;i++){ float an=.7853982*float(i); vec2 d=vec2(cos(an),sin(an)); for(int k=0;k<2;k++){ vec2 off=d*uPx*(k==0?6.:14.); vec3 df=cam(cu+off)-c0; float w=exp(-dot(df,df)*30.); sw+=w; sm+=w*M(cu+off);} }\n"
        + "  return sm/sw; }\n"
        + "vec2 camUV(vec2 sv){ return vec2(mix(sv.x,1.-sv.x,uMir),sv.y)*uCS+uCO; }\n"
        + "vec3 camBlur(vec2 s0){ vec3 acc=vec3(0.); for(int i=0;i<12;i++){ float an=.5236*float(i)+.26; vec2 d=vec2(cos(an),sin(an)*.5625); acc+=cam(camUV(s0+d*.03))+cam(camUV(s0+d*.065)); } return acc/24.; }\n"
        + "float mq(vec2 sv){ vec2 c=camUV(sv); return smoothstep(uEdge.x,uEdge.y,M(c))*inside(c); }\n"
        + "const vec2 R[6]=vec2[6](vec2(1.,0.),vec2(.5,.866),vec2(-.5,.866),vec2(-1.,0.),vec2(-.5,-.866),vec2(.5,-.866));\n"
        + "void main(){\n"
        + "  vec2 s0=v-uSub; vec2 cu=camUV(s0); vec3 c=cam(cu);\n"
        + "  vec3 bg; if(uBlurBg>.5) bg=grade(camBlur(s0)*.92); else bg=grade(texture(uBg,v*uBS+uBO).rgb); if(uBlurBg<.5&&uMix<.999) bg=mix(grade(texture(uBg2,v*uBS2+uBO2).rgb),bg,uMix);\n"
        + "  float base=refined(cu); if(uUseGF>.5){ vec2 ab=texture(uGF,cu).rg; base=clamp(ab.x*texture(uY,sensor(clamp(cu,0.,1.))).r+ab.y,0.,1.); }\n"
        + "  float a=smoothstep(uEdge.x,uEdge.y,base)*inside(cu); vec2 asp=vec2(1.,1.7778);\n"
        + "  if(uFx.z>.001&&a<.999){ float sh=mq(s0-vec2(.012,.008)*asp)*.25; for(int i=0;i<6;i++) sh+=mq(s0-vec2(.012,.008)*asp+R[i]*.02*asp)*.125; bg*=1.-uFx.z*.65*sh; }\n"
        + "  if(a>.02&&(uFx.x>.001||uFx.y>.001)){\n"
        + "    float ab=mq(s0)*.25; for(int i=0;i<6;i++) ab+=mq(s0+R[i]*.018*asp)*.125; float inner=a*(1.-ab);\n"
        + "    if(uFx.y>.001){ vec3 bl=vec3(0.); for(int i=0;i<6;i++) bl+=grade(texture(uBg,(v+R[i]*.03*asp)*uBS+uBO).rgb)/6.; c+=(bl-c)*clamp(uFx.y*inner*2.2,0.,.6); }\n"
        + "    float band=clamp(4.*a*(1.-a)+2.*inner,0.,1.);\n"
        + "    if(uFx.x>.001&&band>.02){ vec3 F=vec3(0.),B=vec3(0.); float Wf=0.,Wb=0.;\n"
        + "      for(int i=0;i<6;i++){ vec2 sv=s0+R[i]*.016*asp; float m=mq(sv); vec3 cc=cam(camUV(sv)); float wf=smoothstep(.8,.97,m), wb=1.-smoothstep(.03,.25,m); F+=wf*cc; Wf+=wf; B+=wb*cc; Wb+=wb;\n"
        + "        vec2 so=s0+R[i]*.034*asp; float wo=1.-smoothstep(.03,.25,mq(so)); B+=wo*cam(camUV(so)); Wb+=wo; }\n"
        + "      float k=clamp(uFx.x*band,0.,.9);\n"
        + "      if(Wf>.3){ F/=Wf; if(Wb>.3){ B/=Wb; vec3 d=F-B; float den=dot(d,d); if(den>.004){ float ac=clamp(dot(c-B,d)/den,0.,1.); a=mix(a,min(a,ac),clamp(k*1.2,0.,.95)); }\n"
        + "        if(a>.06) c=mix(c,clamp((c-(1.-a)*B)/a,0.,1.),k); } else c=mix(c,F,k); } }\n"
        + "  }\n"
        + "  if(a>.02){ if(uSkin>.001){ vec3 sm=c; float sw=1.; for(int i=0;i<8;i++){ float an=.7853982*float(i)+.39; vec3 cc=cam(cu+vec2(cos(an),sin(an))*uPx*4.5); vec3 df=cc-c; float w=exp(-dot(df,df)*140.); sm+=w*cc; sw+=w; } c=mix(c,sm/sw,uSkin); }\n"
        + "    c=1.-pow(1.-clamp(c,0.,1.),vec3(uSL.x)); c*=vec3(1.+uSL.y*.07,1.,1.-uSL.y*.07); c=clamp(c*uHarm.rgb*uHarm.a,0.,1.); }\n"
        + "  o=vec4(mix(bg,c,a),1.);\n"
        + "}";

    private void initGl() {
        dpy = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
        int[] ver = new int[2]; EGL14.eglInitialize(dpy, ver, 0, ver, 1);
        int[] attr = { EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
                EGL14.EGL_RENDERABLE_TYPE, EGLExt.EGL_OPENGL_ES3_BIT_KHR, 0x3142 /* EGL_RECORDABLE_ANDROID */, 1, EGL14.EGL_NONE };
        EGLConfig[] cs = new EGLConfig[1]; int[] n = new int[1];
        EGL14.eglChooseConfig(dpy, attr, 0, cs, 0, 1, n, 0);
        if (n[0] == 0 || cs[0] == null) { // repli : sans l'attribut « enregistrable »
            int[] a2 = { EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_RENDERABLE_TYPE, EGLExt.EGL_OPENGL_ES3_BIT_KHR, EGL14.EGL_NONE };
            EGL14.eglChooseConfig(dpy, a2, 0, cs, 0, 1, n, 0);
        }
        if (cs[0] == null) throw new RuntimeException("Aucune configuration OpenGL ES 3");
        cfg = cs[0];
        ctx = EGL14.eglCreateContext(dpy, cfg, EGL14.EGL_NO_CONTEXT, new int[]{ EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE }, 0);
        pbuf = EGL14.eglCreatePbufferSurface(dpy, cfg, new int[]{ EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE }, 0);
        EGL14.eglMakeCurrent(dpy, pbuf, pbuf, ctx);
        prog = program(VS, FS);
        int[] b = new int[1]; GLES30.glGenBuffers(1, b, 0); vbo = b[0];
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, vbo);
        float[] q = { -1, -1, 1, -1, -1, 1, 1, 1 };
        GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, q.length * 4, ByteBuffer.allocateDirect(q.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().put(q).position(0), GLES30.GL_STATIC_DRAW);
        GLES30.glGenTextures(tex.length, tex, 0);
        for (int t : tex) { GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, t);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE); }
        GLES30.glPixelStorei(GLES30.GL_UNPACK_ALIGNMENT, 1);
        // décor par défaut : dégradé vert de l'app
        Bitmap g = Bitmap.createBitmap(9, 16, Bitmap.Config.ARGB_8888);
        for (int y = 0; y < 16; y++) { float k = y / 15f; int r = (int) (0x0f + k * (0x1c - 0x0f)), gg = (int) (0x2a + k * (0x6b - 0x2a)), bb = (int) (0x1d + k * (0x46 - 0x1d));
            for (int x = 0; x < 9; x++) g.setPixel(x, y, 0xff000000 | (r << 16) | (gg << 8) | bb); }
        uploadBitmap(tex[4], g); bgW = 9; bgH = 16; g.recycle();
        GLES30.glUseProgram(prog);
        String[] names = { "uBlurBg", "uGF", "uUseGF", "uHarm", "uY", "uU", "uV", "uMask", "uBg", "uBg2", "uRot", "uCS", "uCO", "uBS", "uBO", "uBS2", "uBO2", "uEdge", "uPx", "uSub", "uSL", "uMir", "uBr", "uCt", "uSa", "uMix", "uSkin", "uFx" };
        for (String nm : names) U.put(nm, GLES30.glGetUniformLocation(prog, nm));
        for (int i = 0; i < 6; i++) GLES30.glUniform1i(U.get(new String[]{ "uY", "uU", "uV", "uMask", "uBg", "uBg2" }[i]), i);
        GLES30.glUniform1i(U.get("uGF"), 7);
        initGuided();
    }

    /* ---------- Décor vidéo : MediaPlayer → SurfaceTexture (texture externe) → copiée dans la texture du décor ---------- */
    private static final String FS_COPY = "#version 300 es\n#extension GL_OES_EGL_image_external_essl3 : require\nprecision mediump float;\n"
        + "uniform samplerExternalOES uTex; uniform mat4 uM; in vec2 v; out vec4 o;\n"
        + "void main(){ vec2 t = (uM * vec4(v.x, v.y, 0., 1.)).xy; o = texture(uTex, t); }";
    private int copyProg, oesTex, fbo, vidW, vidH;
    private SurfaceTexture vidST; private Surface vidSurface; private MediaPlayer player;
    private volatile boolean vidFrame; private boolean videoBg; private final float[] stM = new float[16];

    /** Décor vidéo (fichier local) : lu en boucle, sans son, avec fondu enchaîné. */
    public void setBackgroundVideo(String path) {
        gl.post(() -> {
            try {
                if (ctx == EGL14.EGL_NO_CONTEXT) return;
                EGL14.eglMakeCurrent(dpy, pbuf, pbuf, ctx);
                stopVideoBg();
                if (copyProg == 0) copyProg = program(VS, FS_COPY);
                int[] t = new int[1]; GLES30.glGenTextures(1, t, 0); oesTex = t[0];
                GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTex);
                GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR);
                GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR);
                GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE);
                GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE);
                vidST = new SurfaceTexture(oesTex); vidST.setOnFrameAvailableListener(s -> vidFrame = true);
                vidSurface = new Surface(vidST);
                MediaPlayer mp = new MediaPlayer();
                String p = path.startsWith("file:") ? Uri.parse(path).getPath() : path;
                mp.setDataSource(p); mp.setSurface(vidSurface); mp.setLooping(true); mp.setVolume(0, 0);
                mp.setOnPreparedListener(MediaPlayer::start);
                mp.setOnErrorListener((m, what, extra) -> { Log.w(TAG, "décor vidéo " + what + "/" + extra); return true; });
                mp.prepareAsync(); player = mp;
                int tt = tex[5]; tex[5] = tex[4]; tex[4] = tt; bg2W = bgW; bg2H = bgH; vidW = 0; vidH = 0;
                mixT0 = SystemClock.uptimeMillis(); videoBg = true;
            } catch (Exception e) { Log.w(TAG, "décor vidéo", e); stopVideoBg(); }
        });
    }
    private void stopVideoBg() {
        videoBg = false;
        if (player != null) { try { player.release(); } catch (Exception ignored) { } player = null; }
        if (vidSurface != null) { vidSurface.release(); vidSurface = null; }
        if (vidST != null) { vidST.release(); vidST = null; }
        if (oesTex != 0) { GLES30.glDeleteTextures(1, new int[]{ oesTex }, 0); oesTex = 0; }
    }
    /** Sur le fil GPU, contexte courant : copie la dernière image du décor vidéo dans la texture du décor. */
    private void updateVideoBg() {
        if (!videoBg || vidST == null || player == null || !vidFrame) return;
        vidFrame = false;
        vidST.updateTexImage(); vidST.getTransformMatrix(stM);
        int w = player.getVideoWidth(), h = player.getVideoHeight(); if (w <= 0 || h <= 0) return;
        float k = Math.min(1f, 1280f / Math.max(w, h)); int tw = Math.round(w * k), th = Math.round(h * k);
        if (tw != vidW || th != vidH) {
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, tex[4]);
            GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA, tw, th, 0, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, null);
            vidW = tw; vidH = th; bgW = tw; bgH = th;
        }
        if (fbo == 0) { int[] f = new int[1]; GLES30.glGenFramebuffers(1, f, 0); fbo = f[0]; }
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbo);
        GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, tex[4], 0);
        GLES30.glViewport(0, 0, tw, th);
        GLES30.glUseProgram(copyProg);
        GLES30.glActiveTexture(GLES30.GL_TEXTURE6); GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTex);
        GLES30.glUniform1i(GLES30.glGetUniformLocation(copyProg, "uTex"), 6);
        GLES30.glUniformMatrix4fv(GLES30.glGetUniformLocation(copyProg, "uM"), 1, false, stM, 0);
        draw();
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
        GLES30.glUseProgram(prog);
    }

    /* ---------- Contours fins : filtre guidé (même algorithme que la version web), guidé par la luminosité du capteur ---------- */
    private static final String GF_VS = "#version 300 es\nin vec2 p; out vec2 v; void main(){ v = p*.5+.5; gl_Position = vec4(p,0.,1.); }";
    private static final String GF_PREP = "#version 300 es\nprecision highp float; in vec2 v; out vec4 o; uniform sampler2D uY,uMask; uniform int uRot;\n"
        + "vec2 sensor(vec2 c){ if(uRot==90) return vec2(c.y,1.-c.x); if(uRot==270) return vec2(1.-c.y,c.x); if(uRot==180) return 1.-c; return c; }\n"
        + "void main(){ float I=texture(uY,sensor(v)).r; float p=texture(uMask,v).r; o=vec4(I,p,I*p,I*I); }";
    private static final String GF_BLUR = "#version 300 es\nprecision highp float; in vec2 v; out vec4 o; uniform sampler2D uT; uniform vec2 uD;\n"
        + "void main(){ vec4 s=vec4(0.); for(int i=-6;i<=6;i++) s+=texture(uT,v+uD*float(i)); o=s/13.; }";
    private static final String GF_COEF = "#version 300 es\nprecision highp float; in vec2 v; out vec4 o; uniform sampler2D uT; uniform float uEps;\n"
        + "void main(){ vec4 m=texture(uT,v); float va=m.w-m.x*m.x, cv=m.z-m.x*m.y; float a=cv/(va+uEps); o=vec4(a, m.y-a*m.x, 0., 1.); }";
    private int gfPrep, gfBlur, gfCoef, gfFbo, gfW, gfH; private final int[] gfTex = new int[3]; private boolean gfOk;
    private void initGuided() {
        try {
            String ext = GLES30.glGetString(GLES30.GL_EXTENSIONS);
            if (ext == null || !(ext.contains("GL_EXT_color_buffer_half_float") || ext.contains("GL_EXT_color_buffer_float"))) return; // repli : contours habituels
            gfPrep = program(GF_VS, GF_PREP); gfBlur = program(GF_VS, GF_BLUR); gfCoef = program(GF_VS, GF_COEF);
            int[] f = new int[1]; GLES30.glGenFramebuffers(1, f, 0); gfFbo = f[0]; GLES30.glGenTextures(3, gfTex, 0);
            GLES30.glUseProgram(gfPrep); GLES30.glUniform1i(GLES30.glGetUniformLocation(gfPrep, "uY"), 0); GLES30.glUniform1i(GLES30.glGetUniformLocation(gfPrep, "uMask"), 3);
            GLES30.glUseProgram(gfBlur); GLES30.glUniform1i(GLES30.glGetUniformLocation(gfBlur, "uT"), 8);
            GLES30.glUseProgram(gfCoef); GLES30.glUniform1i(GLES30.glGetUniformLocation(gfCoef, "uT"), 8); GLES30.glUniform1f(GLES30.glGetUniformLocation(gfCoef, "uEps"), 0.004f);
            GLES30.glUseProgram(prog); gfOk = true;
        } catch (Throwable t) { Log.w(TAG, "contours fins indisponibles", t); gfOk = false; GLES30.glUseProgram(prog); }
    }
    private void gfPass(int p, int out, int input) {
        GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, out, 0);
        GLES30.glUseProgram(p);
        if (input != 0) { GLES30.glActiveTexture(GLES30.GL_TEXTURE8); GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, input); }
    }
    /** 6 passes à ≤ 960 px ; résultat (a, b moyens) sur l'unité 7 pour le rendu principal. Textures Y (0) et masque (3) déjà chargées. */
    private boolean runGuided(int rot) {
        if (!gfOk || !p.fine || camW <= 0) return false;
        float k = Math.min(1f, 960f / Math.max(camW, camH)); int w = Math.round(camW * k), h = Math.round(camH * k);
        if (w != gfW || h != gfH) {
            for (int t : gfTex) { GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, t);
                GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA16F, w, h, 0, GLES30.GL_RGBA, GLES30.GL_HALF_FLOAT, null);
                GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR); GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR);
                GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE); GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE); }
            gfW = w; gfH = h;
        }
        int A = gfTex[0], B = gfTex[1], C = gfTex[2];
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, gfFbo); GLES30.glViewport(0, 0, w, h);
        int dB = GLES30.glGetUniformLocation(gfBlur, "uD");
        gfPass(gfPrep, A, 0); GLES30.glUniform1i(GLES30.glGetUniformLocation(gfPrep, "uRot"), rot); draw();
        gfPass(gfBlur, B, A); GLES30.glUniform2f(dB, 1f / w, 0); draw();
        gfPass(gfBlur, A, B); GLES30.glUniform2f(dB, 0, 1f / h); draw();
        gfPass(gfCoef, B, A); draw();
        gfPass(gfBlur, C, B); GLES30.glUniform2f(dB, 1f / w, 0); draw();
        gfPass(gfBlur, B, C); GLES30.glUniform2f(dB, 0, 1f / h); draw();
        int st = GLES30.glCheckFramebufferStatus(GLES30.GL_FRAMEBUFFER);
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0); GLES30.glUseProgram(prog);
        if (st != GLES30.GL_FRAMEBUFFER_COMPLETE) { gfOk = false; return false; } // GPU incompatible : on s'en passe
        GLES30.glActiveTexture(GLES30.GL_TEXTURE7); GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, B);
        return true;
    }

    /* ---------- Lumière du visage assortie au décor ---------- */
    private volatile float bgR = .5f, bgG = .5f, bgB = .5f;
    private void measureBg(Bitmap b) {
        try { Bitmap s = Bitmap.createScaledBitmap(b, 1, 1, true); int c = s.getPixel(0, 0); s.recycle();
            bgR = ((c >> 16) & 0xff) / 255f; bgG = ((c >> 8) & 0xff) / 255f; bgB = (c & 0xff) / 255f; } catch (Exception ignored) { }
    }
    /** Teinte (rgb) et luminosité (a) appliquées au sujet : vers la couleur et la clarté moyennes du décor, avec mesure. */
    private float[] harmony() {
        float k = p.harm; if (k <= 0) return new float[]{ 1, 1, 1, 1 };
        float l = Math.max(.02f, .2126f * bgR + .7152f * bgG + .0722f * bgB);
        float[] t = new float[4];
        float[] c = { bgR / l, bgG / l, bgB / l };
        for (int i = 0; i < 3; i++) t[i] = Math.max(.85f, Math.min(1.15f, 1 + (c[i] - 1) * .35f * k));
        double sl = subjLum != null ? subjLum : .4;
        t[3] = (float) Math.max(.85, Math.min(1.2, 1 + (Math.pow(l / Math.max(.05, sl), .3) - 1) * .6 * k));
        return t;
    }

    private static int shader(int type, String src) {
        int s = GLES30.glCreateShader(type); GLES30.glShaderSource(s, src); GLES30.glCompileShader(s);
        int[] ok = new int[1]; GLES30.glGetShaderiv(s, GLES30.GL_COMPILE_STATUS, ok, 0);
        if (ok[0] == 0) throw new RuntimeException("Shader : " + GLES30.glGetShaderInfoLog(s));
        return s;
    }
    private static int program(String vs, String fs) {
        int p = GLES30.glCreateProgram();
        GLES30.glAttachShader(p, shader(GLES30.GL_VERTEX_SHADER, vs)); GLES30.glAttachShader(p, shader(GLES30.GL_FRAGMENT_SHADER, fs));
        GLES30.glBindAttribLocation(p, 0, "p"); GLES30.glLinkProgram(p);
        int[] ok = new int[1]; GLES30.glGetProgramiv(p, GLES30.GL_LINK_STATUS, ok, 0);
        if (ok[0] == 0) throw new RuntimeException("Programme : " + GLES30.glGetProgramInfoLog(p));
        return p;
    }
    private static void uploadBitmap(int t, Bitmap b) {
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, t); GLUtils.texImage2D(GLES30.GL_TEXTURE_2D, 0, b, 0);
    }

    private void makeWindow(Surface s) {
        dropWindow();
        win = EGL14.eglCreateWindowSurface(dpy, cfg, s, new int[]{ EGL14.EGL_NONE }, 0);
    }
    private void dropWindow() {
        if (win != EGL14.EGL_NO_SURFACE) { EGL14.eglMakeCurrent(dpy, pbuf, pbuf, ctx); EGL14.eglDestroySurface(dpy, win); win = EGL14.EGL_NO_SURFACE; }
    }

    private static float[] cover(float sw, float sh, float zoom, float px, float py) {
        float a = sw / sh, ta = 9f / 16f, sx = 1, sy = 1;
        if (a > ta) sx = ta / a; else sy = a / ta;
        sx /= zoom; sy /= zoom;
        return new float[]{ sx, sy, (1 - sx) / 2 * (1 + px), (1 - sy) / 2 * (1 + py) };
    }
    /** Coordonnées image droite (portrait) → coordonnées capteur, selon la rotation fournie par la caméra. */
    private static float[] toSensor(float u, float v, int rot) {
        switch (rot) { case 90: return new float[]{ v, 1 - u }; case 270: return new float[]{ 1 - v, u }; case 180: return new float[]{ 1 - u, 1 - v }; default: return new float[]{ u, v }; }
    }

    private void uploadPlane(int unit, int t, ByteBuffer b, int w, int h, int rowStride) {
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0 + unit); GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, t);
        GLES30.glPixelStorei(GLES30.GL_UNPACK_ROW_LENGTH, rowStride);
        GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_R8, w, h, 0, GLES30.GL_RED, GLES30.GL_UNSIGNED_BYTE, b);
        GLES30.glPixelStorei(GLES30.GL_UNPACK_ROW_LENGTH, 0);
    }

    private void render(ImageProxy img, int rot, byte[] mask, int mw, int mh) {
        if (ctx == EGL14.EGL_NO_CONTEXT || (win == EGL14.EGL_NO_SURFACE && recSurf == EGL14.EGL_NO_SURFACE)) return;
        EGLSurface first = win != EGL14.EGL_NO_SURFACE ? win : recSurf;
        EGL14.eglMakeCurrent(dpy, first, first, ctx);
        updateVideoBg();
        GLES30.glUseProgram(prog);
        int w = img.getWidth(), h = img.getHeight(), w2 = (w + 1) / 2, h2 = (h + 1) / 2;
        ImageProxy.PlaneProxy[] pl = img.getPlanes();
        ByteBuffer yb = pl[0].getBuffer(); yb.rewind();
        uploadPlane(0, tex[0], yb, w, h, pl[0].getRowStride());
        // U et V : copiés en plans compacts (sur beaucoup de téléphones ils sont entrelacés, pas de 2 octets)
        if (uArr == null || uArr.length != w2 * h2) { uArr = new byte[w2 * h2]; vArr = new byte[w2 * h2]; }
        copyChroma(pl[1], uArr, w2, h2); copyChroma(pl[2], vArr, w2, h2);
        uploadPlane(1, tex[1], ByteBuffer.wrap(uArr), w2, h2, w2);
        uploadPlane(2, tex[2], ByteBuffer.wrap(vArr), w2, h2, w2);
        uploadPlane(3, tex[3], ByteBuffer.wrap(mask), mw, mh, mw);
        GLES30.glActiveTexture(GLES30.GL_TEXTURE4); GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, tex[4]);
        GLES30.glActiveTexture(GLES30.GL_TEXTURE5); GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, tex[5]);
        boolean gf = runGuided(rot);
        setUniforms(rot);
        GLES30.glUniform1f(U.get("uUseGF"), gf ? 1 : 0); GLES30.glUniform1f(U.get("uBlurBg"), p.blurBg ? 1 : 0);
        float[] hm = harmony(); GLES30.glUniform4f(U.get("uHarm"), hm[0], hm[1], hm[2], hm[3]);
        if (win != EGL14.EGL_NO_SURFACE) {
            GLES30.glViewport(0, 0, winW, winH); GLES30.glClearColor(0, 0, 0, 1); GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT);
            int vw = p.vw > 0 ? p.vw : winW, vh = p.vh > 0 ? p.vh : winH;
            GLES30.glViewport(p.vx, winH - p.vy - vh, vw, vh);
            draw(); EGL14.eglSwapBuffers(dpy, win);
        }
        if (recSurf != EGL14.EGL_NO_SURFACE) {
            EGL14.eglMakeCurrent(dpy, recSurf, recSurf, ctx);
            GLES30.glViewport(0, 0, outW, outH); draw();
            EGLExt.eglPresentationTimeANDROID(dpy, recSurf, System.nanoTime());
            EGL14.eglSwapBuffers(dpy, recSurf);
        }
        frames++;
        long now = SystemClock.uptimeMillis();
        if (now - statsT0 >= 500) {
            int fps = (int) Math.round(frames * 1000.0 / (now - statsT0)); frames = 0; statsT0 = now;
            Double ex = camera != null && camera.getCameraInfo().getExposureState().isExposureCompensationSupported() ? (double) expoIdx : null;
            listener.onStats(fps, inferMs, camW, camH, lightG, ex);
        }
    }

    private static void copyChroma(ImageProxy.PlaneProxy pl, byte[] dst, int w2, int h2) {
        ByteBuffer b = pl.getBuffer(); int rs = pl.getRowStride(), ps = pl.getPixelStride(), lim = b.limit();
        if (ps == 1 && rs == w2) { b.rewind(); b.get(dst, 0, Math.min(dst.length, lim)); return; }
        for (int y = 0; y < h2; y++) { int row = y * rs, o = y * w2;
            for (int x = 0; x < w2; x++) { int i = row + x * ps; dst[o + x] = i < lim ? b.get(i) : 0; } }
    }

    private void setUniforms(int rot) {
        float cw = camW > 0 ? camW : 1080, ch = camH > 0 ? camH : 1920;
        float[] c = cover(cw, ch, p.cz, 0, 0), b = cover(bgW, bgH, p.zoom, p.px, p.py), b2 = cover(bg2W, bg2H, p.zoom, p.px, p.py);
        float m = Math.min(1f, (SystemClock.uptimeMillis() - mixT0) / 220f); m = m * m * (3 - 2 * m);
        GLES30.glUniform1i(U.get("uRot"), rot);
        GLES30.glUniform2f(U.get("uCS"), c[0], c[1]); GLES30.glUniform2f(U.get("uCO"), c[2], c[3]);
        GLES30.glUniform2f(U.get("uBS"), b[0], b[1]); GLES30.glUniform2f(U.get("uBO"), b[2], b[3]);
        GLES30.glUniform2f(U.get("uBS2"), b2[0], b2[1]); GLES30.glUniform2f(U.get("uBO2"), b2[2], b2[3]);
        GLES30.glUniform1f(U.get("uMix"), m);
        GLES30.glUniform2f(U.get("uEdge"), p.lo, Math.max(p.hi, p.lo + .01f));
        GLES30.glUniform2f(U.get("uPx"), 1f / cw, 1f / ch);
        GLES30.glUniform2f(U.get("uSub"), p.sx, p.sy);
        GLES30.glUniform2f(U.get("uSL"), (float) lightG, p.warm);
        GLES30.glUniform1f(U.get("uMir"), p.mirror ? 1 : 0);
        GLES30.glUniform1f(U.get("uBr"), p.br); GLES30.glUniform1f(U.get("uCt"), p.ct); GLES30.glUniform1f(U.get("uSa"), p.sa);
        GLES30.glUniform1f(U.get("uSkin"), p.skin);
        GLES30.glUniform3f(U.get("uFx"), p.dsp, p.wrap, p.shd);
    }

    private void draw() {
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, vbo);
        GLES30.glEnableVertexAttribArray(0); GLES30.glVertexAttribPointer(0, 2, GLES30.GL_FLOAT, false, 0, 0);
        GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, 4);
    }

    /** Nouveau décor (image), avec fondu enchaîné de 0,22 s. */
    public void setBackground(Bitmap bmp) {
        gl.post(() -> {
            if (ctx == EGL14.EGL_NO_CONTEXT) { bmp.recycle(); return; }
            EGL14.eglMakeCurrent(dpy, pbuf, pbuf, ctx);
            stopVideoBg();
            int t = tex[5]; tex[5] = tex[4]; tex[4] = t; bg2W = bgW; bg2H = bgH;
            measureBg(bmp); uploadBitmap(tex[4], bmp); bgW = bmp.getWidth(); bgH = bmp.getHeight(); bmp.recycle();
            mixT0 = SystemClock.uptimeMillis();
        });
    }

    /* ======================= Enregistrement ======================= */

    private int outW = 1080, outH = 1920;

    public String startRecording(File dir, int w, int h, int bitrate) throws Exception {
        if (recorder != null) throw new IllegalStateException("Déjà en cours");
        stopMeter();
        boolean audio = ContextCompat.checkSelfPermission(act, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        outW = w; outH = h;
        recFile = new File(dir, "green-studio-" + System.currentTimeMillis() + ".mp4");
        MediaRecorder r = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(act) : new MediaRecorder();
        if (audio) r.setAudioSource(audioSource());
        r.setVideoSource(MediaRecorder.VideoSource.SURFACE);
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
        r.setOutputFile(recFile.getAbsolutePath());
        r.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
        r.setVideoEncodingBitRate(bitrate); r.setVideoFrameRate(30); r.setVideoSize(w, h);
        if (audio) { r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC); r.setAudioSamplingRate(48000); r.setAudioEncodingBitRate(192000); r.setAudioChannels(1);
            if (mic != null) r.setPreferredDevice(mic); }
        r.prepare();
        final Surface s = r.getSurface();
        final Object lock = new Object(); final boolean[] done = { false };
        gl.post(() -> { try { recSurf = EGL14.eglCreateWindowSurface(dpy, cfg, s, new int[]{ EGL14.EGL_NONE }, 0); } catch (Throwable t) { Log.e(TAG, "surface", t); }
            synchronized (lock) { done[0] = true; lock.notifyAll(); } });
        synchronized (lock) { long t = SystemClock.uptimeMillis(); while (!done[0] && SystemClock.uptimeMillis() - t < 2000) lock.wait(200); }
        r.start(); recorder = r; recT0 = SystemClock.uptimeMillis();
        pollLevel();
        return recFile.getAbsolutePath();
    }

    public File stopRecording() throws Exception {
        MediaRecorder r = recorder; recorder = null;
        if (r == null) throw new IllegalStateException("Aucun enregistrement");
        final Object lock = new Object(); final boolean[] done = { false };
        gl.post(() -> { if (recSurf != EGL14.EGL_NO_SURFACE) { EGL14.eglMakeCurrent(dpy, pbuf, pbuf, ctx); EGL14.eglDestroySurface(dpy, recSurf); recSurf = EGL14.EGL_NO_SURFACE; }
            synchronized (lock) { done[0] = true; lock.notifyAll(); } });
        synchronized (lock) { long t = SystemClock.uptimeMillis(); while (!done[0] && SystemClock.uptimeMillis() - t < 2000) lock.wait(200); }
        try { r.stop(); } finally { r.release(); }
        if (running) startMeter();
        return recFile;
    }

    public long recordingMs() { return recorder != null ? SystemClock.uptimeMillis() - recT0 : 0; }

    private void pollLevel() {
        main.postDelayed(() -> {
            MediaRecorder r = recorder; if (r == null) return;
            try { listener.onLevel(r.getMaxAmplitude() / 32767.0 * .5); } catch (Exception ignored) { }
            pollLevel();
        }, 60);
    }

    /* ======================= Micro ======================= */

    public List<AudioDeviceInfo> mics() {
        List<AudioDeviceInfo> out = new ArrayList<>();
        AudioManager am = (AudioManager) act.getSystemService(Context.AUDIO_SERVICE);
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
            int t = d.getType();
            if (t == AudioDeviceInfo.TYPE_TELEPHONY || t == AudioDeviceInfo.TYPE_REMOTE_SUBMIX || t == AudioDeviceInfo.TYPE_FM_TUNER) continue;
            out.add(d);
        }
        return out;
    }
    public void setMic(AudioDeviceInfo d) { mic = d; if (meter != null) { stopMeter(); startMeter(); } }

    /** Niveau du micro hors enregistrement (vumètre, prompteur qui suit la voix). */
    private void startMeter() {
        if (metering || recorder != null) return;
        if (ContextCompat.checkSelfPermission(act, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return;
        int sr = 48000, n = Math.max(AudioRecord.getMinBufferSize(sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT), 4096);
        try {
            AudioRecord ar = new AudioRecord(audioSource(), sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, n);
            if (mic != null) ar.setPreferredDevice(mic);
            ar.startRecording(); meter = ar; metering = true;
            new Thread(() -> {
                short[] buf = new short[1024]; long last = 0;
                while (metering) {
                    int k = ar.read(buf, 0, buf.length); if (k <= 0) continue;
                    double s = 0; for (int i = 0; i < k; i++) s += buf[i] * (double) buf[i];
                    long now = SystemClock.uptimeMillis();
                    if (now - last >= 60) { last = now; listener.onLevel(Math.sqrt(s / k) / 32768.0); }
                }
                try { ar.stop(); } catch (Exception ignored) { } ar.release();
            }, "studio-meter").start();
        } catch (Exception e) { Log.w(TAG, "micro", e); }
    }
    private void stopMeter() { metering = false; meter = null; }

    /** Erreur grave : signalée une seule fois à l'interface, qui repasse sur le moteur web (l'app ne se ferme jamais). */
    private volatile boolean failed;
    private void fail(String m) { if (failed) return; failed = true; running = false; main.post(() -> listener.onError(m)); }

    public void release() {
        stop();
        gl.post(() -> { dropWindow(); if (ctx != EGL14.EGL_NO_CONTEXT) { EGL14.eglDestroyContext(dpy, ctx); ctx = EGL14.EGL_NO_CONTEXT; } glThread.quitSafely(); });
        analysis.shutdown(); segmenter.close();
    }
}
