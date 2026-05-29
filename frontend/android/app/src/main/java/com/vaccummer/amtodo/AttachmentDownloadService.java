package com.vaccummer.amtodo;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public class AttachmentDownloadService extends Service {
    public static final String ACTION_START = "com.vaccummer.amtodo.attachment_download.START";
    public static final String ACTION_CANCEL = "com.vaccummer.amtodo.attachment_download.CANCEL";
    public static final String ACTION_PROGRESS = "com.vaccummer.amtodo.attachment_download.PROGRESS";
    public static final String ACTION_COMPLETE = "com.vaccummer.amtodo.attachment_download.COMPLETE";
    public static final String ACTION_ERROR = "com.vaccummer.amtodo.attachment_download.ERROR";
    public static final String EXTRA_DOWNLOAD_ID = "downloadId";
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_CACHE_PATH = "cachePath";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TOTAL_SIZE = "totalSize";
    public static final String EXTRA_HEADER_KEYS = "headerKeys";
    public static final String EXTRA_HEADER_VALUES = "headerValues";
    public static final String EXTRA_LOADED = "loaded";
    public static final String EXTRA_TOTAL = "total";
    public static final String EXTRA_PERCENT = "percent";
    public static final String EXTRA_URI = "uri";
    public static final String EXTRA_MESSAGE = "message";

    private static final String CHANNEL_ID = "amtodo_attachment_downloads";
    private static final String TAG = "AMToDoDownload";
    private static final int DOWNLOAD_NOTIFICATION_BASE_ID = 2001;
    private static final int BUFFER_SIZE = 128 * 1024;
    private static final int MAX_RESUME_ATTEMPTS = 5;
    private static final long RANGE_CHUNK_SIZE = 64L * 1024L;

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> activeConnections = new ConcurrentHashMap<>();
    private final Map<String, Boolean> cancelled = new ConcurrentHashMap<>();
    private final Map<String, Integer> notificationIds = new ConcurrentHashMap<>();
    private final Map<String, DownloadNotificationState> notificationStates = new ConcurrentHashMap<>();
    private final AtomicInteger nextNotificationId = new AtomicInteger(DOWNLOAD_NOTIFICATION_BASE_ID);
    private final Object notificationLock = new Object();
    @Nullable
    private String foregroundDownloadId = null;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_CANCEL.equals(action)) {
            String downloadId = intent.getStringExtra(EXTRA_DOWNLOAD_ID);
            cancel(downloadId);
            return START_NOT_STICKY;
        }
        if (ACTION_START.equals(action)) {
            String downloadId = intent.getStringExtra(EXTRA_DOWNLOAD_ID);
            String url = intent.getStringExtra(EXTRA_URL);
            String cachePath = intent.getStringExtra(EXTRA_CACHE_PATH);
            String title = intent.getStringExtra(EXTRA_TITLE);
            long totalSize = intent.getLongExtra(EXTRA_TOTAL_SIZE, 0L);
            ArrayList<String> headerKeys = intent.getStringArrayListExtra(EXTRA_HEADER_KEYS);
            ArrayList<String> headerValues = intent.getStringArrayListExtra(EXTRA_HEADER_VALUES);
            if (downloadId == null || downloadId.isEmpty()) {
                return START_NOT_STICKY;
            }
            registerDownloadNotification(downloadId, title, totalSize);
            executor.execute(() -> runDownload(downloadId, url, cachePath, title, totalSize, headerKeys, headerValues));
            return START_REDELIVER_INTENT;
        }
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void cancel(@Nullable String downloadId) {
        if (downloadId == null) return;
        cancelled.put(downloadId, true);
        HttpURLConnection connection = activeConnections.remove(downloadId);
        if (connection != null) {
            connection.disconnect();
        }
    }

    private void runDownload(
        String downloadId,
        String urlText,
        String cachePath,
        String title,
        long expectedTotal,
        ArrayList<String> headerKeys,
        ArrayList<String> headerValues
    ) {
        HttpURLConnection connection = null;
        try {
            if (downloadId == null || downloadId.isEmpty()) throw new IOException("downloadId is required");
            if (urlText == null || urlText.isEmpty()) throw new IOException("url is required");
            File outFile = resolveCacheFile(cachePath);
            File partFile = new File(outFile.getAbsolutePath() + ".part");
            File parent = partFile.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                throw new IOException("Unable to create cache directory");
            }

            long total = Math.max(expectedTotal, 0L);
            int attempt = 0;
            while (true) {
                if (isCancelled(downloadId)) throw new IOException("Download cancelled");
                long existing = partFile.exists() ? Math.max(partFile.length(), 0L) : 0L;
                if (total > 0 && existing >= total) break;
                connection = openDownloadConnection(downloadId, urlText, existing, total, headerKeys, headerValues);
                try {
                    int status = connection.getResponseCode();
                    boolean partial = status == HttpURLConnection.HTTP_PARTIAL;
                    Log.i(TAG, "download=" + downloadId
                        + " status=" + status
                        + " existing=" + existing
                        + " expectedTotal=" + total
                        + " contentLength=" + connection.getContentLengthLong()
                        + " contentRange=" + connection.getHeaderField("Content-Range")
                        + " encoding=" + connection.getHeaderField("Content-Encoding"));
                    if (status != HttpURLConnection.HTTP_OK && !partial) {
                        throw new IOException("Download failed: HTTP " + status);
                    }
                    if (!partial && existing > 0) {
                        if (!partFile.delete()) throw new IOException("Unable to reset partial download");
                        existing = 0;
                    }

                    total = Math.max(resolveTotal(connection, existing, total), total);
                    streamResponse(downloadId, connection, partFile, existing, total, title);
                    attempt = 0;
                    long received = partFile.exists() ? partFile.length() : 0L;
                    if (total <= 0 || received >= total) break;
                } catch (IOException ex) {
                    long received = partFile.exists() ? partFile.length() : 0L;
                    boolean madeProgress = received > existing;
                    Log.w(TAG, "download=" + downloadId
                        + " resumeAttempt=" + attempt
                        + " received=" + received
                        + " total=" + total
                        + " error=" + ex.getMessage());
                    if (!canResume(ex, received, total, attempt)) throw ex;
                    attempt = madeProgress ? 0 : attempt + 1;
                    broadcastProgress(downloadId, received, total);
                } finally {
                    activeConnections.remove(downloadId);
                    connection.disconnect();
                    connection = null;
                }
            }

            if (isCancelled(downloadId)) throw new IOException("Download cancelled");
            if (total > 0 && partFile.length() < total) {
                throw new IOException("Download incomplete: received " + partFile.length() + " of " + total + " bytes");
            }
            if (outFile.exists() && !outFile.delete()) {
                throw new IOException("Unable to replace cached file");
            }
            if (!partFile.renameTo(outFile)) {
                throw new IOException("Unable to finalize cached file");
            }
            broadcastComplete(downloadId, outFile);
        } catch (Exception ex) {
            if (downloadId != null) {
                broadcastError(downloadId, ex.getMessage() == null ? "Download failed" : ex.getMessage());
            }
        } finally {
            if (downloadId != null) {
                activeConnections.remove(downloadId);
                cancelled.remove(downloadId);
                unregisterDownloadNotification(downloadId);
            }
            if (connection != null) {
                connection.disconnect();
            }
            if (!hasActiveDownloads()) {
                stopSelf();
            }
        }
    }

    private HttpURLConnection openDownloadConnection(
        String downloadId,
        String urlText,
        long existing,
        long total,
        ArrayList<String> headerKeys,
        ArrayList<String> headerValues
    ) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlText).openConnection();
        activeConnections.put(downloadId, connection);
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(600_000);
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept-Encoding", "identity");
        applyHeaders(connection, headerKeys, headerValues);
        long start = Math.max(existing, 0L);
        if (total > 0) {
            long end = Math.min(start + RANGE_CHUNK_SIZE - 1, total - 1);
            connection.setRequestProperty("Range", "bytes=" + start + "-" + end);
        } else {
            connection.setRequestProperty("Range", "bytes=" + start + "-");
        }
        return connection;
    }

    private void applyHeaders(
        HttpURLConnection connection,
        @Nullable ArrayList<String> headerKeys,
        @Nullable ArrayList<String> headerValues
    ) {
        if (headerKeys == null || headerValues == null) return;
        int count = Math.min(headerKeys.size(), headerValues.size());
        for (int i = 0; i < count; i++) {
            String key = headerKeys.get(i);
            String value = headerValues.get(i);
            if (key != null && !key.isEmpty() && value != null) {
                connection.setRequestProperty(key, value);
            }
        }
    }

    private boolean canResume(IOException ex, long received, long total, int attempt) {
        if (attempt >= MAX_RESUME_ATTEMPTS) return false;
        if (total <= 0) return true;
        if (received <= 0 || received >= total) return false;
        String message = ex.getMessage();
        if (message == null) return true;
        String normalized = message.toLowerCase();
        return normalized.contains("unexpected end")
            || normalized.contains("connection")
            || normalized.contains("stream")
            || normalized.contains("reset")
            || normalized.contains("timeout")
            || normalized.contains("closed");
    }

    private void streamResponse(
        String downloadId,
        HttpURLConnection connection,
        File partFile,
        long startOffset,
        long total,
        String title
    ) throws IOException {
        long loaded = startOffset;
        boolean append = startOffset > 0;
        broadcastProgress(downloadId, loaded, total);
        updateNotification(downloadId, title, loaded, total);
        try (
            InputStream input = new BufferedInputStream(connection.getInputStream());
            FileOutputStream fos = new FileOutputStream(partFile, append);
            BufferedOutputStream output = new BufferedOutputStream(fos)
        ) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            long lastNotifyAt = 0;
            while ((read = input.read(buffer)) != -1) {
                if (isCancelled(downloadId)) throw new IOException("Download cancelled");
                output.write(buffer, 0, read);
                loaded += read;
                long now = System.currentTimeMillis();
                if (now - lastNotifyAt > 250 || (total > 0 && loaded >= total)) {
                    lastNotifyAt = now;
                    broadcastProgress(downloadId, loaded, total);
                    updateNotification(downloadId, title, loaded, total);
                }
            }
            output.flush();
        }
    }

    private long resolveTotal(HttpURLConnection connection, long existing, long expectedTotal) {
        String contentRange = connection.getHeaderField("Content-Range");
        if (contentRange != null) {
            int slash = contentRange.lastIndexOf('/');
            if (slash >= 0 && slash + 1 < contentRange.length()) {
                try {
                    return Long.parseLong(contentRange.substring(slash + 1).trim());
                } catch (NumberFormatException ignored) {
                }
            }
        }
        long contentLength = connection.getContentLengthLong();
        if (contentLength > 0) return existing + contentLength;
        return Math.max(expectedTotal, 0L);
    }

    private boolean isCancelled(String downloadId) {
        return Boolean.TRUE.equals(cancelled.get(downloadId));
    }

    private File resolveCacheFile(String cachePath) throws IOException {
        if (cachePath == null || cachePath.isEmpty()) throw new IOException("cachePath is required");
        if (cachePath.startsWith("/") || cachePath.contains("..")) throw new IOException("Invalid cache path");
        File root = getCacheDir().getCanonicalFile();
        File target = new File(root, cachePath).getCanonicalFile();
        if (!target.getPath().startsWith(root.getPath() + File.separator)) {
            throw new IOException("Invalid cache path");
        }
        return target;
    }

    private void broadcastProgress(String downloadId, long loaded, long total) {
        Intent intent = new Intent(ACTION_PROGRESS);
        intent.setPackage(getPackageName());
        intent.putExtra(EXTRA_DOWNLOAD_ID, downloadId);
        intent.putExtra(EXTRA_LOADED, loaded);
        intent.putExtra(EXTRA_TOTAL, total);
        intent.putExtra(EXTRA_PERCENT, total > 0 ? Math.min(100, Math.round((loaded * 100.0f) / total)) : 0);
        sendBroadcast(intent);
    }

    private void broadcastComplete(String downloadId, File file) {
        Intent intent = new Intent(ACTION_COMPLETE);
        intent.setPackage(getPackageName());
        intent.putExtra(EXTRA_DOWNLOAD_ID, downloadId);
        intent.putExtra(EXTRA_URI, "file://" + file.getAbsolutePath());
        sendBroadcast(intent);
    }

    private void broadcastError(String downloadId, String message) {
        Intent intent = new Intent(ACTION_ERROR);
        intent.setPackage(getPackageName());
        intent.putExtra(EXTRA_DOWNLOAD_ID, downloadId);
        intent.putExtra(EXTRA_MESSAGE, message);
        sendBroadcast(intent);
    }

    private boolean hasActiveDownloads() {
        return !notificationStates.isEmpty();
    }

    private void registerDownloadNotification(String downloadId, String title, long total) {
        synchronized (notificationLock) {
            int notificationId = nextNotificationId.getAndIncrement();
            notificationIds.put(downloadId, notificationId);
            DownloadNotificationState state = new DownloadNotificationState(title, 0L, Math.max(total, 0L));
            notificationStates.put(downloadId, state);
            Notification notification = buildNotification(state.title, state.loaded, state.total, 0);
            if (foregroundDownloadId == null) {
                foregroundDownloadId = downloadId;
                startForeground(notificationId, notification);
            } else {
                notifyDownload(notificationId, notification);
            }
        }
    }

    private void unregisterDownloadNotification(String downloadId) {
        synchronized (notificationLock) {
            Integer oldNotificationId = notificationIds.remove(downloadId);
            notificationStates.remove(downloadId);
            boolean wasForeground = downloadId.equals(foregroundDownloadId);
            if (wasForeground) {
                promoteNextForegroundDownload(oldNotificationId);
            } else if (oldNotificationId != null) {
                cancelNotification(oldNotificationId);
            }
        }
    }

    private void promoteNextForegroundDownload(@Nullable Integer oldNotificationId) {
        Iterator<Map.Entry<String, DownloadNotificationState>> iterator = notificationStates.entrySet().iterator();
        if (iterator.hasNext()) {
            Map.Entry<String, DownloadNotificationState> next = iterator.next();
            String nextDownloadId = next.getKey();
            Integer nextNotificationId = notificationIds.get(nextDownloadId);
            if (nextNotificationId != null) {
                DownloadNotificationState state = next.getValue();
                foregroundDownloadId = nextDownloadId;
                startForeground(
                    nextNotificationId,
                    buildNotification(state.title, state.loaded, state.total, percent(state.loaded, state.total))
                );
                if (oldNotificationId != null && !oldNotificationId.equals(nextNotificationId)) {
                    cancelNotification(oldNotificationId);
                }
                return;
            }
        }
        foregroundDownloadId = null;
        stopForeground(true);
    }

    private void updateNotification(String downloadId, String title, long loaded, long total) {
        Integer notificationId = notificationIds.get(downloadId);
        if (notificationId == null) return;
        notificationStates.put(downloadId, new DownloadNotificationState(title, loaded, total));
        Notification notification = buildNotification(title, loaded, total, percent(loaded, total));
        if (downloadId.equals(foregroundDownloadId)) {
            startForeground(notificationId, notification);
        } else {
            notifyDownload(notificationId, notification);
        }
    }

    private void notifyDownload(int notificationId, Notification notification) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(notificationId, notification);
        }
    }

    private void cancelNotification(int notificationId) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(notificationId);
        }
    }

    private int percent(long loaded, long total) {
        return total > 0 ? Math.round((loaded * 100.0f) / total) : 0;
    }

    private Notification buildNotification(String title, long loaded, long total, int percent) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title == null || title.isEmpty() ? "AMToDo 下载附件" : title)
            .setContentText(total > 0 ? percent + "%" : "正在下载")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW);
        if (total > 0) {
            builder.setProgress(100, Math.max(0, Math.min(100, percent)), false);
        } else {
            builder.setProgress(100, 0, true);
        }
        return builder.build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "附件下载",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("显示 AMToDo 附件后台下载进度");
        nm.createNotificationChannel(channel);
    }

    private static final class DownloadNotificationState {
        final String title;
        final long loaded;
        final long total;

        DownloadNotificationState(String title, long loaded, long total) {
            this.title = title;
            this.loaded = loaded;
            this.total = total;
        }
    }
}
