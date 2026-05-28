package com.vaccummer.amtodo;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

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
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NativeAttachment")
public class NativeAttachmentPlugin extends Plugin {
    private static final int BUFFER_SIZE = 64 * 1024;

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> activeUploads = new ConcurrentHashMap<>();

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
        try {
            Uri uri = Uri.parse(uriText);
            URL url = new URL(urlText);
            connection = (HttpURLConnection) url.openConnection();
            activeUploads.put(uploadId, connection);

            connection.setRequestMethod("PUT");
            connection.setDoOutput(true);
            connection.setConnectTimeout(30_000);
            connection.setReadTimeout(600_000);
            connection.setRequestProperty("Content-Type", contentType == null || contentType.isEmpty() ? "application/octet-stream" : contentType);
            applyHeaders(connection, headers);

            long knownSize = totalSize == null ? querySize(uri) : totalSize;
            if (knownSize >= 0) {
                connection.setFixedLengthStreamingMode(knownSize);
            } else {
                connection.setChunkedStreamingMode(BUFFER_SIZE);
            }

            streamUriToConnection(uploadId, uri, connection, knownSize);

            int status = connection.getResponseCode();
            String responseText = readResponseText(connection, status);
            if (status < 200 || status >= 300) {
                call.reject(responseText == null || responseText.isEmpty() ? ("Upload failed: " + status) : responseText);
                return;
            }

            JSObject ret = parseResponse(responseText);
            call.resolve(ret);
        } catch (IOException | JSONException ex) {
            call.reject(ex.getMessage() == null ? "Upload failed" : ex.getMessage(), ex);
        } finally {
            activeUploads.remove(uploadId);
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void streamUriToConnection(String uploadId, Uri uri, HttpURLConnection connection, long totalSize) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        try (
            InputStream rawInput = resolver.openInputStream(uri);
            InputStream input = new BufferedInputStream(rawInput);
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

    private void addPickedFile(JSArray files, Uri uri, int flags) {
        try {
            int takeFlags = flags & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if ((takeFlags & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0) {
                getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
        } catch (SecurityException ignored) {
            // Some providers grant temporary access only; immediate upload still works.
        }

        JSObject file = new JSObject();
        file.put("uri", uri.toString());
        file.put("name", queryName(uri));
        file.put("mimeType", queryMimeType(uri));
        file.put("size", querySize(uri));
        files.put(file);
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
