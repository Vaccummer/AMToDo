package com.vaccummer.amtodo;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public class BackgroundWsService extends Service {
    public static final String ACTION_START = "com.vaccummer.amtodo.background_ws.START";
    public static final String ACTION_STOP = "com.vaccummer.amtodo.background_ws.STOP";
    public static final String ACTION_STATUS = "com.vaccummer.amtodo.background_ws.STATUS";
    public static final String ACTION_EVENT = "com.vaccummer.amtodo.background_ws.EVENT";
    public static final String EXTRA_SERVER_URL = "serverUrl";
    public static final String EXTRA_ACCESS_TOKEN = "accessToken";
    public static final String EXTRA_RECONNECT_INTERVAL_MS = "reconnectIntervalMs";
    public static final String EXTRA_STATUS = "status";
    public static final String EXTRA_MESSAGE = "message";
    public static final String EXTRA_NOTIFICATION_ID = "notification_id";
    public static final String EXTRA_TRIGGER_AT = "trigger_at";
    public static final String PREFS_NAME = "amtodo_background_ws";
    public static final String PREF_STATUS = "status";
    private static final String PREF_ACTIVE = "active";
    private static final String PREF_SERVER_URL = "server_url";
    private static final String PREF_ACCESS_TOKEN = "access_token";
    private static final String PREF_RECONNECT_INTERVAL_MS = "reconnect_interval_ms";

    private static final String SERVICE_CHANNEL_ID = "amtodo_background_ws";
    private static final String NOTIFY_CHANNEL_ID = "amtodo_notifications";
    private static final String NOTIFICATION_CLICK_ACTION = "com.vaccummer.amtodo.background_ws.NOTIFICATION_CLICK";
    private static final String APP_NOTIFICATION_TAG = "amtodo_app_notification";
    private static final int SERVICE_NOTIFICATION_ID = 1001;
    private static final long[] DEFAULT_DELAYS = {1000, 2000, 3000, 5000, 8000, 13000, 21000, 30000};

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private OkHttpClient client;
    private WebSocket webSocket;
    private String serverUrl = "";
    private String accessToken = "";
    private long reconnectIntervalMs = 0;
    private int reconnectAttempt = 0;
    private boolean stopped = true;
    private String status = "disconnected";

    @Override
    public void onCreate() {
        super.onCreate();
        client = new OkHttpClient.Builder()
            .pingInterval(25, TimeUnit.SECONDS)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .build();
        createChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopServiceConnection();
            return START_NOT_STICKY;
        }
        if (ACTION_START.equals(action)) {
            serverUrl = safeString(intent.getStringExtra(EXTRA_SERVER_URL));
            accessToken = safeString(intent.getStringExtra(EXTRA_ACCESS_TOKEN));
            reconnectIntervalMs = intent.getLongExtra(EXTRA_RECONNECT_INTERVAL_MS, 0);
            persistConfig(true);
            stopped = false;
            startForeground(SERVICE_NOTIFICATION_ID, serviceNotification());
            connect();
            return START_STICKY;
        }
        if (restoreConfig()) {
            stopped = false;
            startForeground(SERVICE_NOTIFICATION_ID, serviceNotification());
            connect();
            return START_STICKY;
        }
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        stopped = true;
        closeSocket();
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private void connect() {
        if (stopped || serverUrl.isEmpty() || accessToken.isEmpty()) {
            setStatus("disconnected", "missing config");
            return;
        }
        closeSocket();
        setStatus(reconnectAttempt > 0 ? "reconnecting" : "connecting", null);

        String wsUrl = serverUrl.replaceFirst("^http", "ws").replaceAll("/+$", "") + "/api/v1/ws";
        Request request = new Request.Builder()
            .url(wsUrl)
            .header("Sec-WebSocket-Protocol", "amtodo.v1, bearer." + accessToken)
            .build();
        webSocket = client.newWebSocket(request, new WsListener());
    }

    private void scheduleReconnect() {
        if (stopped) return;
        long delay = reconnectDelay();
        reconnectAttempt++;
        setStatus("reconnecting", null);
        mainHandler.postDelayed(this::connect, delay);
    }

    private long reconnectDelay() {
        if (reconnectIntervalMs > 0) {
            int idx = Math.min(reconnectAttempt, DEFAULT_DELAYS.length - 1);
            long[] factors = {1, 2, 3, 5, 8, 13, 21, 30};
            return reconnectIntervalMs * factors[idx];
        }
        return DEFAULT_DELAYS[Math.min(reconnectAttempt, DEFAULT_DELAYS.length - 1)];
    }

    private void stopServiceConnection() {
        stopped = true;
        mainHandler.removeCallbacksAndMessages(null);
        closeSocket();
        persistConfig(false);
        setStatus("disconnected", "stopped");
        stopForeground(true);
        stopSelf();
    }

    private void persistConfig(boolean active) {
        SharedPreferences.Editor editor = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
            .putBoolean(PREF_ACTIVE, active);
        if (active) {
            editor
                .putString(PREF_SERVER_URL, serverUrl)
                .putString(PREF_ACCESS_TOKEN, accessToken)
                .putLong(PREF_RECONNECT_INTERVAL_MS, reconnectIntervalMs);
        }
        editor.apply();
    }

    private boolean restoreConfig() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        if (!prefs.getBoolean(PREF_ACTIVE, false)) return false;
        serverUrl = safeString(prefs.getString(PREF_SERVER_URL, ""));
        accessToken = safeString(prefs.getString(PREF_ACCESS_TOKEN, ""));
        reconnectIntervalMs = prefs.getLong(PREF_RECONNECT_INTERVAL_MS, 0);
        return !serverUrl.isEmpty() && !accessToken.isEmpty();
    }

    private void closeSocket() {
        if (webSocket != null) {
            try {
                webSocket.close(1000, "service stop");
            } catch (Exception ignored) {
            }
            webSocket = null;
        }
    }

    private void setStatus(String nextStatus, @Nullable String message) {
        status = nextStatus;
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        prefs.edit().putString(PREF_STATUS, nextStatus).apply();
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && !stopped) {
            nm.notify(SERVICE_NOTIFICATION_ID, serviceNotification());
        }
        Intent intent = new Intent(ACTION_STATUS);
        intent.setPackage(getPackageName());
        intent.putExtra(EXTRA_STATUS, nextStatus);
        if (message != null) intent.putExtra(EXTRA_MESSAGE, message);
        sendBroadcast(intent);
    }

    private Notification serviceNotification() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, SERVICE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("AMToDo")
            .setContentText("后台同步运行中")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setSilent(true)
            .setShowWhen(false)
            .setLocalOnly(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build();
    }

    private void postAppNotification(JSONObject data) {
        if (!canPostNotifications()) {
            return;
        }
        int id = data.optInt("id", (int) (System.currentTimeMillis() % Integer.MAX_VALUE));
        String title = data.optString("title", "AMToDo");
        String description = data.optString("description", "");
        long triggerAt = data.optLong("trigger_at", 0L);

        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setAction(NOTIFICATION_CLICK_ACTION);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launchIntent.putExtra(EXTRA_NOTIFICATION_ID, id);
        launchIntent.putExtra(EXTRA_TRIGGER_AT, triggerAt);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            id,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, NOTIFY_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title == null || title.isEmpty() ? "AMToDo" : title)
            .setContentText(description == null ? "" : description)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(description == null ? "" : description))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build();

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(APP_NOTIFICATION_TAG, id, notification);
        }

        Intent eventIntent = new Intent(ACTION_EVENT);
        eventIntent.setPackage(getPackageName());
        eventIntent.putExtra("type", "notification");
        eventIntent.putExtra("data", data.toString());
        sendBroadcast(eventIntent);
    }

    private boolean canPostNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel serviceChannel = new NotificationChannel(
            SERVICE_CHANNEL_ID,
            "后台同步",
            NotificationManager.IMPORTANCE_MIN
        );
        serviceChannel.setDescription("保持 AMToDo 后台同步");
        nm.createNotificationChannel(serviceChannel);

        NotificationChannel notifyChannel = new NotificationChannel(
            NOTIFY_CHANNEL_ID,
            "任务通知",
            NotificationManager.IMPORTANCE_HIGH
        );
        notifyChannel.setDescription("AMToDo 服务端推送通知");
        nm.createNotificationChannel(notifyChannel);
    }

    private String safeString(@Nullable String value) {
        return value == null ? "" : value;
    }

    private class WsListener extends WebSocketListener {
        @Override
        public void onOpen(WebSocket ws, Response response) {
            reconnectAttempt = 0;
            setStatus("connected", null);
        }

        @Override
        public void onMessage(WebSocket ws, String text) {
            try {
                JSONObject msg = new JSONObject(text);
                String type = msg.optString("type", "");
                if ("ping".equals(type)) {
                    ws.send("{\"type\":\"pong\"}");
                } else if ("notification".equals(type)) {
                    JSONObject data = msg.optJSONObject("data");
                    if (data != null) postAppNotification(data);
                }
            } catch (JSONException ignored) {
            }
        }

        @Override
        public void onClosed(WebSocket ws, int code, String reason) {
            webSocket = null;
            if (!stopped) scheduleReconnect();
        }

        @Override
        public void onFailure(WebSocket ws, Throwable t, Response response) {
            webSocket = null;
            setStatus("disconnected", t.getMessage());
            if (!stopped) scheduleReconnect();
        }
    }
}
