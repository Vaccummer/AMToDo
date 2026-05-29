package com.vaccummer.amtodo;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NativeAttachment")
public class NativeAttachmentPlugin extends Plugin {
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final String CAPTURE_TEMP_DIR = "capture-temp";

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> activeUploads = new ConcurrentHashMap<>();
    private final Map<String, PluginCall> activeDownloads = new ConcurrentHashMap<>();
    private BroadcastReceiver downloadReceiver;
    private Uri pendingCaptureUri;
    private String pendingCaptureMimeType;

    @Override
    public void load() {
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null || intent.getAction() == null) return;
                handleDownloadEvent(intent);
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(AttachmentDownloadService.ACTION_PROGRESS);
        filter.addAction(AttachmentDownloadService.ACTION_COMPLETE);
        filter.addAction(AttachmentDownloadService.ACTION_ERROR);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(downloadReceiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (downloadReceiver != null) {
            try {
                getContext().unregisterReceiver(downloadReceiver);
            } catch (Exception ignored) {
            }
            downloadReceiver = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void pickFiles(PluginCall call) {
        String accept = call.getString("accept", "*/*");
        boolean multiple = Boolean.TRUE.equals(call.getBoolean("multiple", false));

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(accept == null || accept.isEmpty() ? "*/*" : accept);
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);

        startActivityForResult(call, intent, "pickFilesResult");
    }

    @PluginMethod
    public void capturePhoto(PluginCall call) {
        startMediaCapture(call, false);
    }

    @PluginMethod
    public void captureVideo(PluginCall call) {
        startMediaCapture(call, true);
    }

    @ActivityCallback
    private void pickFilesResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject ret = new JSObject();
            ret.put("files", new JSArray());
            call.resolve(ret);
            return;
        }

        Intent data = result.getData();
        JSArray files = new JSArray();
        ClipData clipData = data.getClipData();

        if (clipData != null) {
            for (int i = 0; i < clipData.getItemCount(); i++) {
                addPickedFile(files, clipData.getItemAt(i).getUri(), data.getFlags());
            }
        } else if (data.getData() != null) {
            addPickedFile(files, data.getData(), data.getFlags());
        }

        JSObject ret = new JSObject();
        ret.put("files", files);
        call.resolve(ret);
    }

    @ActivityCallback
    private void capturePhotoResult(PluginCall call, ActivityResult result) {
        handleCaptureResult(call, result);
    }

    @ActivityCallback
    private void captureVideoResult(PluginCall call, ActivityResult result) {
        handleCaptureResult(call, result);
    }

    @PluginMethod
    public void upload(PluginCall call) {
        String uploadId = call.getString("uploadId");
        String uriText = call.getString("uri");
        String urlText = call.getString("url");
        String contentType = call.getString("contentType", "application/octet-stream");
        Long totalSize = call.getLong("size");
        JSObject headers = call.getObject("headers", new JSObject());

        if (uploadId == null || uploadId.isEmpty()) {
            call.reject("uploadId is required");
            return;
        }
        if (uriText == null || uriText.isEmpty()) {
            call.reject("uri is required");
            return;
        }
        if (urlText == null || urlText.isEmpty()) {
            call.reject("url is required");
            return;
        }

        executor.execute(() -> uploadInBackground(call, uploadId, uriText, urlText, contentType, totalSize, headers));
    }

    @PluginMethod
    public void cancelUpload(PluginCall call) {
        String uploadId = call.getString("uploadId");
        if (uploadId != null) {
            HttpURLConnection connection = activeUploads.remove(uploadId);
            if (connection != null) {
                connection.disconnect();
            }
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void download(PluginCall call) {
        String downloadId = call.getString("downloadId");
        String url = call.getString("url");
        String cachePath = call.getString("cachePath");
        String title = call.getString("title", "AMToDo 下载附件");
        Long totalSize = call.getLong("totalSize");
        JSObject headers = call.getObject("headers", new JSObject());

        if (downloadId == null || downloadId.isEmpty()) {
            call.reject("downloadId is required");
            return;
        }
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        if (cachePath == null || cachePath.isEmpty()) {
            call.reject("cachePath is required");
            return;
        }

        activeDownloads.put(downloadId, call);
        Intent intent = new Intent(getContext(), AttachmentDownloadService.class);
        intent.setAction(AttachmentDownloadService.ACTION_START);
        intent.putExtra(AttachmentDownloadService.EXTRA_DOWNLOAD_ID, downloadId);
        intent.putExtra(AttachmentDownloadService.EXTRA_URL, url);
        intent.putExtra(AttachmentDownloadService.EXTRA_CACHE_PATH, cachePath);
        intent.putExtra(AttachmentDownloadService.EXTRA_TITLE, title);
        intent.putExtra(AttachmentDownloadService.EXTRA_TOTAL_SIZE, totalSize == null ? 0L : totalSize);
        try {
            putHeadersExtra(intent, headers);
        } catch (JSONException ex) {
            activeDownloads.remove(downloadId);
            call.reject("Invalid download headers", ex);
            return;
        }
        ContextCompat.startForegroundService(getContext(), intent);
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        String downloadId = call.getString("downloadId");
        if (downloadId != null) {
            activeDownloads.remove(downloadId);
            Intent intent = new Intent(getContext(), AttachmentDownloadService.class);
            intent.setAction(AttachmentDownloadService.ACTION_CANCEL);
            intent.putExtra(AttachmentDownloadService.EXTRA_DOWNLOAD_ID, downloadId);
            getContext().startService(intent);
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getCaptureTempMediaStats(PluginCall call) {
        executor.execute(() -> {
            TempMediaStats stats = collectCaptureTempMediaStats(false);
            JSObject ret = new JSObject();
            ret.put("count", stats.count);
            ret.put("bytes", stats.bytes);
            ret.put("photoCount", stats.photoCount);
            ret.put("videoCount", stats.videoCount);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void clearCaptureTempMedia(PluginCall call) {
        executor.execute(() -> {
            TempMediaStats stats = collectCaptureTempMediaStats(true);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("count", stats.count);
            ret.put("bytes", stats.bytes);
            ret.put("photoCount", stats.photoCount);
            ret.put("videoCount", stats.videoCount);
            call.resolve(ret);
        });
    }

    private void handleDownloadEvent(Intent intent) {
        String downloadId = intent.getStringExtra(AttachmentDownloadService.EXTRA_DOWNLOAD_ID);
        if (downloadId == null || downloadId.isEmpty()) return;
        String action = intent.getAction();
        if (AttachmentDownloadService.ACTION_PROGRESS.equals(action)) {
            JSObject data = new JSObject();
            data.put("downloadId", downloadId);
            data.put("loaded", intent.getLongExtra(AttachmentDownloadService.EXTRA_LOADED, 0L));
            data.put("total", intent.getLongExtra(AttachmentDownloadService.EXTRA_TOTAL, 0L));
            data.put("percent", intent.getIntExtra(AttachmentDownloadService.EXTRA_PERCENT, 0));
            notifyListeners("downloadProgress", data);
            return;
        }

        PluginCall call = activeDownloads.remove(downloadId);
        if (call == null) return;
        if (AttachmentDownloadService.ACTION_COMPLETE.equals(action)) {
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("uri", intent.getStringExtra(AttachmentDownloadService.EXTRA_URI));
            call.resolve(ret);
        } else if (AttachmentDownloadService.ACTION_ERROR.equals(action)) {
            String message = intent.getStringExtra(AttachmentDownloadService.EXTRA_MESSAGE);
            call.reject(message == null || message.isEmpty() ? "Download failed" : message);
        }
    }

    private void startMediaCapture(PluginCall call, boolean video) {
        if (pendingCaptureUri != null) {
            call.reject("Another capture is already in progress");
            return;
        }

        try {
            String mimeType = video ? "video/mp4" : "image/jpeg";
            Uri outputUri = createCaptureMediaUri(video, mimeType);
            if (outputUri == null) {
                call.reject(video ? "Unable to create video media item" : "Unable to create photo media item");
                return;
            }

            Intent intent;
            if (video) {
                intent = new Intent(MediaStore.ACTION_VIDEO_CAPTURE);
                intent.putExtra(MediaStore.EXTRA_OUTPUT, outputUri);
                intent.putExtra(MediaStore.EXTRA_VIDEO_QUALITY, 1);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } else {
                intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                intent.putExtra(MediaStore.EXTRA_OUTPUT, outputUri);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            }

            pendingCaptureUri = outputUri;
            pendingCaptureMimeType = mimeType;

            startActivityForResult(call, intent, video ? "captureVideoResult" : "capturePhotoResult");
        } catch (ActivityNotFoundException ex) {
            cleanupPendingCapture(true);
            call.reject(video ? "No camera app can record video" : "No camera app can take photos", ex);
        } catch (Exception ex) {
            cleanupPendingCapture(true);
            call.reject(video ? "Failed to start video capture" : "Failed to start photo capture", ex);
        }
    }

    private void handleCaptureResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            cleanupPendingCapture(true);
            return;
        }

        Uri outputUri = pendingCaptureUri;
        String mimeType = pendingCaptureMimeType;
        cleanupPendingCapture(false);

        if (result.getResultCode() != Activity.RESULT_OK) {
            deleteCaptureUri(outputUri);
            JSObject ret = new JSObject();
            ret.put("file", null);
            call.resolve(ret);
            return;
        }

        Intent data = result.getData();
        Uri fallbackUri = data == null ? null : data.getData();
        if (fallbackUri != null) {
            finalizeCaptureUri(fallbackUri);
            if (outputUri != null && !fallbackUri.equals(outputUri)) {
                deleteCaptureUri(outputUri);
            }
            JSObject ret = new JSObject();
            ret.put("file", fileObject(
                fallbackUri,
                queryName(fallbackUri),
                queryMimeType(fallbackUri),
                querySize(fallbackUri)
            ));
            call.resolve(ret);
            return;
        }

        if (outputUri != null) {
            finalizeCaptureUri(outputUri);
            JSObject ret = new JSObject();
            ret.put("file", fileObject(
                outputUri,
                queryName(outputUri),
                mimeType,
                querySize(outputUri)
            ));
            call.resolve(ret);
            return;
        }

        call.reject("Captured media was not returned by the camera app");
    }

    private void cleanupPendingCapture(boolean deleteFile) {
        Uri uri = pendingCaptureUri;
        pendingCaptureUri = null;
        pendingCaptureMimeType = null;
        if (deleteFile) {
            deleteCaptureUri(uri);
        }
    }

    private Uri createCaptureMediaUri(boolean video, String mimeType) {
        ContentValues values = new ContentValues();
        long now = System.currentTimeMillis();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, video ? "AMToDo_" + now + ".mp4" : "AMToDo_" + now + ".jpg");
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(
                MediaStore.MediaColumns.RELATIVE_PATH,
                video ? Environment.DIRECTORY_DCIM + "/Camera" : Environment.DIRECTORY_PICTURES + "/AMToDo"
            );
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        }
        Uri collection = video
            ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
            : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        return getContext().getContentResolver().insert(collection, values);
    }

    private void finalizeCaptureUri(Uri uri) {
        if (uri == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContext().getContentResolver().update(uri, values, null, null);
        } catch (Exception ignored) {
        }
    }

    private void deleteCaptureUri(Uri uri) {
        if (uri == null) return;
        try {
            getContext().getContentResolver().delete(uri, null, null);
        } catch (Exception ignored) {
        }
    }

    private void uploadInBackground(
        PluginCall call,
        String uploadId,
        String uriText,
        String urlText,
        String contentType,
        Long totalSize,
        JSObject headers
    ) {
        HttpURLConnection connection = null;
        File tempFile = null;
        String phase = "staging";
        try {
            Uri uri = Uri.parse(uriText);
            tempFile = copyUriToTempFile(uri);
            long actualSize = tempFile.length();

            phase = "connecting";
            URL url = new URL(urlText);
            connection = (HttpURLConnection) url.openConnection();
            activeUploads.put(uploadId, connection);

            connection.setRequestMethod("PUT");
            connection.setDoOutput(true);
            connection.setConnectTimeout(30_000);
            connection.setReadTimeout(600_000);
            connection.setRequestProperty("Content-Type", contentType == null || contentType.isEmpty() ? "application/octet-stream" : contentType);
            applyHeaders(connection, headers);

            connection.setFixedLengthStreamingMode(actualSize);

            phase = "uploading";
            streamFileToConnection(uploadId, tempFile, connection, actualSize);

            phase = "reading response";
            int status = connection.getResponseCode();
            String responseText = readResponseText(connection, status);
            if (status < 200 || status >= 300) {
                call.reject(responseText == null || responseText.isEmpty() ? ("Upload failed: " + status) : responseText);
                return;
            }

            JSObject ret = parseResponse(responseText);
            call.resolve(ret);
        } catch (IOException | JSONException ex) {
            String detail = ex.getMessage() == null ? "unknown error" : ex.getMessage();
            call.reject("Upload failed while " + phase + ": " + detail, ex);
        } finally {
            activeUploads.remove(uploadId);
            if (connection != null) {
                connection.disconnect();
            }
            if (tempFile != null) {
                tempFile.delete();
            }
        }
    }

    private File copyUriToTempFile(Uri uri) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        File tempFile = File.createTempFile("amtodo-upload-", ".bin", getContext().getCacheDir());
        InputStream rawInput = resolver.openInputStream(uri);
        if (rawInput == null) {
            throw new IOException("Unable to open selected file");
        }
        try (
            InputStream input = new BufferedInputStream(rawInput);
            OutputStream output = new BufferedOutputStream(new FileOutputStream(tempFile))
        ) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            output.flush();
        }
        return tempFile;
    }

    private void streamFileToConnection(String uploadId, File file, HttpURLConnection connection, long totalSize) throws IOException {
        try (
            InputStream input = new BufferedInputStream(new FileInputStream(file));
            OutputStream output = new BufferedOutputStream(connection.getOutputStream())
        ) {
            byte[] buffer = new byte[BUFFER_SIZE];
            long loaded = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                loaded += read;
                notifyUploadProgress(uploadId, loaded, totalSize);
            }
            output.flush();
        }
    }

    private void applyHeaders(HttpURLConnection connection, JSObject headers) throws JSONException {
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            String value = headers.getString(key);
            if (value != null) {
                connection.setRequestProperty(key, value);
            }
        }
    }

    private void putHeadersExtra(Intent intent, JSObject headers) throws JSONException {
        ArrayList<String> headerKeys = new ArrayList<>();
        ArrayList<String> headerValues = new ArrayList<>();
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            String value = headers.getString(key);
            if (key != null && !key.isEmpty() && value != null) {
                headerKeys.add(key);
                headerValues.add(value);
            }
        }
        intent.putStringArrayListExtra(AttachmentDownloadService.EXTRA_HEADER_KEYS, headerKeys);
        intent.putStringArrayListExtra(AttachmentDownloadService.EXTRA_HEADER_VALUES, headerValues);
    }

    private void addPickedFile(JSArray files, Uri uri, int flags) {
        try {
            int takeFlags = flags & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if ((takeFlags & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0) {
                getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
        } catch (SecurityException ignored) {
            // Some providers grant temporary access only; immediate upload still works.
        }

        files.put(fileObject(uri, queryName(uri), queryMimeType(uri), querySize(uri)));
    }

    private JSObject fileObject(Uri uri, String name, String mimeType, long size) {
        JSObject file = new JSObject();
        file.put("uri", uri.toString());
        file.put("name", name == null || name.isEmpty() ? "attachment" : name);
        file.put("mimeType", mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType);
        file.put("size", size);
        return file;
    }

    private String queryName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameIndex >= 0) {
                    String name = cursor.getString(nameIndex);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (Exception ignored) {
        }
        String last = uri.getLastPathSegment();
        return last == null || last.isEmpty() ? "attachment" : last;
    }

    private String queryMimeType(Uri uri) {
        String type = getContext().getContentResolver().getType(uri);
        return type == null || type.isEmpty() ? "application/octet-stream" : type;
    }

    private long querySize(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
                    return cursor.getLong(sizeIndex);
                }
            }
        } catch (Exception ignored) {
        }
        return -1;
    }

    private TempMediaStats collectCaptureTempMediaStats(boolean deleteFiles) {
        TempMediaStats stats = new TempMediaStats();
        File[] roots = new File[] {
            new File(getContext().getCacheDir(), CAPTURE_TEMP_DIR),
            getContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES),
            getContext().getExternalFilesDir(Environment.DIRECTORY_MOVIES),
            getContext().getExternalFilesDir(Environment.DIRECTORY_DCIM),
            new File(getContext().getFilesDir(), "Pictures"),
            new File(getContext().getFilesDir(), "Movies"),
        };

        for (File root : roots) {
            collectCaptureTempMedia(root, deleteFiles, stats);
        }
        return stats;
    }

    private void collectCaptureTempMedia(File file, boolean deleteFiles, TempMediaStats stats) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) return;
            for (File child : children) {
                collectCaptureTempMedia(child, deleteFiles, stats);
            }
            return;
        }

        MediaKind kind = mediaKind(file);
        if (kind == MediaKind.NONE) return;
        stats.count += 1;
        stats.bytes += Math.max(file.length(), 0L);
        if (kind == MediaKind.VIDEO) {
            stats.videoCount += 1;
        } else {
            stats.photoCount += 1;
        }
        if (deleteFiles) {
            file.delete();
        }
    }

    private MediaKind mediaKind(File file) {
        String name = file.getName().toLowerCase();
        if (name.endsWith(".mp4")
            || name.endsWith(".mov")
            || name.endsWith(".m4v")
            || name.endsWith(".webm")
            || name.endsWith(".3gp")
            || name.endsWith(".3gpp")) {
            return MediaKind.VIDEO;
        }
        if (name.endsWith(".jpg")
            || name.endsWith(".jpeg")
            || name.endsWith(".png")
            || name.endsWith(".heic")
            || name.endsWith(".heif")
            || name.endsWith(".webp")
            || name.endsWith(".gif")) {
            return MediaKind.PHOTO;
        }
        return MediaKind.NONE;
    }

    private enum MediaKind {
        NONE,
        PHOTO,
        VIDEO
    }

    private static class TempMediaStats {
        int count = 0;
        long bytes = 0L;
        int photoCount = 0;
        int videoCount = 0;
    }

    private void notifyUploadProgress(String uploadId, long loaded, long total) {
        JSObject data = new JSObject();
        data.put("uploadId", uploadId);
        data.put("loaded", loaded);
        data.put("total", total);
        data.put("percent", total > 0 ? Math.round((loaded * 100.0) / total) : 0);
        notifyListeners("uploadProgress", data);
    }

    private String readResponseText(HttpURLConnection connection, int status) throws IOException {
        InputStream response = status >= 200 && status < 400 ? connection.getInputStream() : connection.getErrorStream();
        if (response == null) return "";
        try (InputStream input = response; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private JSObject parseResponse(String responseText) throws JSONException {
        if (responseText == null || responseText.isEmpty()) {
            return new JSObject();
        }
        return new JSObject(responseText);
    }
}
