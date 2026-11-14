package com.recordly.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import java.io.File;

/** Foreground service that owns the MediaProjection + MediaRecorder for on-device screen capture. */
public class ScreenRecorderService extends Service {
    static final String EXTRA_CODE = "code";
    static final String EXTRA_DATA = "data";
    static final String EXTRA_AUDIO = "audio";
    private static final String CHANNEL = "recordly_capture";

    static volatile ScreenRecorderService instance;
    static volatile String startError;

    private MediaProjection projection;
    private MediaRecorder recorder;
    private VirtualDisplay display;
    private File output;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startError = null;
        startForegroundCompat();
        try {
            begin(intent);
            instance = this;
        } catch (Exception e) {
            startError = String.valueOf(e.getMessage() == null ? e : e.getMessage());
            release();
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void startForegroundCompat() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                new NotificationChannel(CHANNEL, "Screen recording", NotificationManager.IMPORTANCE_LOW));
        }
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL)
            : new Notification.Builder(this);
        Notification notification = builder
            .setContentTitle("Recordly")
            .setContentText("Recording your screen")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(android.app.PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                android.app.PendingIntent.FLAG_IMMUTABLE))
            .setOngoing(true)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(1, notification);
        }
    }

    private void begin(Intent intent) throws Exception {
        boolean withAudio = intent.getBooleanExtra(EXTRA_AUDIO, false);
        Intent data = intent.getParcelableExtra(EXTRA_DATA);
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        projection = manager.getMediaProjection(intent.getIntExtra(EXTRA_CODE, 0), data);
        projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                // User revoked via system UI; the JS side finds out when it calls stop().
            }
        }, null);

        DisplayMetrics metrics = new DisplayMetrics();
        ((WindowManager) getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(metrics);
        float scale = Math.min(1f, 1920f / Math.max(metrics.widthPixels, metrics.heightPixels));
        int width = (Math.round(metrics.widthPixels * scale) / 2) * 2;
        int height = (Math.round(metrics.heightPixels * scale) / 2) * 2;

        File dir = new File(getCacheDir(), "recordings");
        dir.mkdirs();
        output = new File(dir, "screen-" + System.currentTimeMillis() + ".mp4");

        recorder = new MediaRecorder();
        if (withAudio) recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
        recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
        recorder.setOutputFile(output.getAbsolutePath());
        recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
        if (withAudio) {
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioEncodingBitRate(128_000);
            recorder.setAudioSamplingRate(44_100);
        }
        recorder.setVideoSize(width, height);
        recorder.setVideoFrameRate(30);
        recorder.setVideoEncodingBitRate(Math.max(4_000_000, width * height * 5));
        recorder.prepare();

        display = projection.createVirtualDisplay(
            "recordly", width, height, metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, recorder.getSurface(), null, null);
        recorder.start();
    }

    /** Stops recording and returns the finished file, or null when nothing usable was captured. */
    synchronized String finish() {
        String path = null;
        try {
            if (recorder != null) {
                recorder.stop();
                path = output.getAbsolutePath();
            }
        } catch (RuntimeException e) {
            if (output != null) output.delete(); // stop() throws when no frames were written
        }
        release();
        stopForeground(true);
        stopSelf();
        return path;
    }

    private void release() {
        if (display != null) display.release();
        if (recorder != null) recorder.release();
        if (projection != null) projection.stop();
        display = null;
        recorder = null;
        projection = null;
        instance = null;
    }

    @Override
    public void onDestroy() {
        release();
        super.onDestroy();
    }
}
