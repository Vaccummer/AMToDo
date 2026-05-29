package com.vaccummer.amtodo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundWs")
public class BackgroundWsPlugin extends Plugin {
    private BroadcastReceiver receiver;

    @Override
    public void load() {
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null || intent.getAction() == null) return;
                if (BackgroundWsService.ACTION_STATUS.equals(intent.getAction())) {
                    JSObject data = new JSObject();
                    data.put("status", intent.getStringExtra(BackgroundWsService.EXTRA_STATUS));
                    String message = intent.getStringExtra(BackgroundWsService.EXTRA_MESSAGE);
                    if (message != null) data.put("message", message);
                    notifyListeners("status", data, true);
                } else if (BackgroundWsService.ACTION_EVENT.equals(intent.getAction())) {
                    JSObject data = new JSObject();
                    data.put("type", intent.getStringExtra("type"));
                    data.put("data", intent.getStringExtra("data"));
                    notifyListeners("event", data, true);
                }
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(BackgroundWsService.ACTION_STATUS);
        filter.addAction(BackgroundWsService.ACTION_EVENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(receiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (Exception ignored) {
            }
            receiver = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void start(PluginCall call) {
        String serverUrl = call.getString("serverUrl", "");
        String accessToken = call.getString("accessToken", "");
        Long reconnectIntervalMs = call.getLong("reconnectIntervalMs");

        if (serverUrl == null || serverUrl.isEmpty()) {
            call.reject("serverUrl is required");
            return;
        }
        if (accessToken == null || accessToken.isEmpty()) {
            call.reject("accessToken is required");
            return;
        }

        Intent intent = new Intent(getContext(), BackgroundWsService.class);
        intent.setAction(BackgroundWsService.ACTION_START);
        intent.putExtra(BackgroundWsService.EXTRA_SERVER_URL, serverUrl);
        intent.putExtra(BackgroundWsService.EXTRA_ACCESS_TOKEN, accessToken);
        intent.putExtra(BackgroundWsService.EXTRA_RECONNECT_INTERVAL_MS, reconnectIntervalMs == null ? 0L : reconnectIntervalMs);
        ContextCompat.startForegroundService(getContext(), intent);

        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), BackgroundWsService.class);
        intent.setAction(BackgroundWsService.ACTION_STOP);
        getContext().startService(intent);

        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(BackgroundWsService.PREFS_NAME, Context.MODE_PRIVATE);
        JSObject ret = new JSObject();
        ret.put("status", prefs.getString(BackgroundWsService.PREF_STATUS, "disconnected"));
        call.resolve(ret);
    }

    @PluginMethod
    public void consumeLaunchNotification(PluginCall call) {
        JSObject ret = new JSObject();
        Intent intent = getActivity() == null ? null : getActivity().getIntent();
        JSObject notification = notificationFromIntent(intent);
        if (notification != null) {
            ret.put("notification", notification);
            clearNotificationExtras(intent);
        }
        call.resolve(ret);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        JSObject notification = notificationFromIntent(intent);
        if (notification != null) {
            notifyListeners("notificationClicked", notification, true);
            clearNotificationExtras(intent);
        }
    }

    private JSObject notificationFromIntent(Intent intent) {
        if (intent == null || !intent.hasExtra(BackgroundWsService.EXTRA_NOTIFICATION_ID)) {
            return null;
        }
        JSObject data = new JSObject();
        data.put("id", intent.getIntExtra(BackgroundWsService.EXTRA_NOTIFICATION_ID, 0));
        data.put("trigger_at", intent.getLongExtra(BackgroundWsService.EXTRA_TRIGGER_AT, 0L));
        return data;
    }

    private void clearNotificationExtras(Intent intent) {
        if (intent == null) return;
        intent.removeExtra(BackgroundWsService.EXTRA_NOTIFICATION_ID);
        intent.removeExtra(BackgroundWsService.EXTRA_TRIGGER_AT);
    }
}
