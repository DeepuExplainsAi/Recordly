package com.recordly.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(
    name = "ScreenRecorder",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
    }
)
public class ScreenRecorderPlugin extends Plugin {
    private boolean audio;

    @PluginMethod
    public void start(PluginCall call) {
        audio = Boolean.TRUE.equals(call.getBoolean("audio", false));
        if (audio && getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "afterMicrophone");
            return;
        }
        requestProjection(call);
    }

    @PermissionCallback
    private void afterMicrophone(PluginCall call) {
        // Recording without a mic is better than failing outright.
        if (getPermissionState("microphone") != PermissionState.GRANTED) audio = false;
        requestProjection(call);
    }

    private void requestProjection(PluginCall call) {
        MediaProjectionManager manager =
            (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        startActivityForResult(call, manager.createScreenCaptureIntent(), "onProjectionResult");
    }

    @ActivityCallback
    private void onProjectionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Screen capture permission denied");
            return;
        }
        Intent intent = new Intent(getContext(), ScreenRecorderService.class)
            .putExtra(ScreenRecorderService.EXTRA_CODE, result.getResultCode())
            .putExtra(ScreenRecorderService.EXTRA_DATA, result.getData())
            .putExtra(ScreenRecorderService.EXTRA_AUDIO, audio);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(intent);
        else getContext().startService(intent);

        // The service starts asynchronously; poll briefly for its outcome.
        getBridge().executeOnMainThread(() -> awaitStart(call, 0));
    }

    private void awaitStart(PluginCall call, int attempt) {
        if (ScreenRecorderService.instance != null) {
            call.resolve(new JSObject().put("audio", audio));
        } else if (ScreenRecorderService.startError != null) {
            call.reject(ScreenRecorderService.startError);
        } else if (attempt > 50) {
            call.reject("Recorder did not start");
        } else {
            getBridge().getWebView().postDelayed(() -> awaitStart(call, attempt + 1), 100);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        ScreenRecorderService service = ScreenRecorderService.instance;
        if (service == null) {
            call.reject("Not recording");
            return;
        }
        String path = service.finish();
        if (path == null) {
            call.reject("Nothing was recorded");
            return;
        }
        call.resolve(new JSObject().put("path", path));
    }

    @PluginMethod
    public void isRecording(PluginCall call) {
        call.resolve(new JSObject().put("recording", ScreenRecorderService.instance != null));
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String path = call.getString("path", "");
        File file = new File(path);
        if (isScratch(file)) file.delete(); // only ever delete our own scratch files
        call.resolve();
    }

    /** Copies a scratch file from the app cache into the shared gallery (Movies/Recordly or Pictures/Recordly). */
    @PluginMethod
    public void saveToGallery(PluginCall call) {
        String path = call.getString("path", "");
        String name = call.getString("fileName", "recordly.mp4");
        String mime = call.getString("mime", "video/mp4");
        File source = new File(path);
        if (!source.isFile() || !isScratch(source)) {
            call.reject("File not found");
            return;
        }
        boolean image = mime.startsWith("image/");
        String folder = (image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_MOVIES) + "/Recordly";
        try {
            ContentResolver resolver = getContext().getContentResolver();
            Uri target;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, folder);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                target = resolver.insert(image ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                                                : MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
                copy(resolver, source, target);
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(target, done, null, null);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(
                    image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_MOVIES), "Recordly");
                dir.mkdirs();
                File dest = new File(dir, name);
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DATA, dest.getAbsolutePath());
                values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                target = resolver.insert(image ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                                                : MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
                copy(resolver, source, target);
            }
            source.delete();
            call.resolve(new JSObject().put("uri", target.toString()).put("folder", folder));
        } catch (Exception e) {
            call.reject("Could not save: " + e.getMessage());
        }
    }

    private static void copy(ContentResolver resolver, File source, Uri target) throws Exception {
        try (InputStream in = new FileInputStream(source); OutputStream out = resolver.openOutputStream(target)) {
            byte[] buffer = new byte[256 * 1024];
            int read;
            while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
        }
    }

    private boolean isScratch(File file) {
        File cache = getContext().getCacheDir();
        File parent = file.getParentFile();
        return parent != null && (parent.equals(new File(cache, "recordings")) || parent.equals(new File(cache, "exports")));
    }
}
