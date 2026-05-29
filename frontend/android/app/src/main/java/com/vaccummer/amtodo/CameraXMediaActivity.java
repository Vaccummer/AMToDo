package com.vaccummer.amtodo;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.video.FallbackStrategy;
import androidx.camera.video.MediaStoreOutputOptions;
import androidx.camera.video.PendingRecording;
import androidx.camera.video.Quality;
import androidx.camera.video.QualitySelector;
import androidx.camera.video.Recorder;
import androidx.camera.video.Recording;
import androidx.camera.video.VideoCapture;
import androidx.camera.video.VideoRecordEvent;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class CameraXMediaActivity extends AppCompatActivity {
    public static final String EXTRA_INITIAL_MODE = "initialMode";
    public static final String EXTRA_URI = "uri";
    public static final String EXTRA_NAME = "name";
    public static final String EXTRA_MIME_TYPE = "mimeType";
    public static final String EXTRA_SIZE = "size";
    public static final String EXTRA_KIND = "kind";
    public static final String EXTRA_ERROR = "error";
    public static final String MODE_PHOTO = "photo";
    public static final String MODE_VIDEO = "video";

    private static final int PERMISSION_REQUEST = 7342;
    private static final String ALBUM_DIR = Environment.DIRECTORY_DCIM + "/AMTODO";

    private final Handler timerHandler = new Handler(Looper.getMainLooper());
    private final Runnable timerTick = new Runnable() {
        @Override
        public void run() {
            updateRecordTimer();
            timerHandler.postDelayed(this, 500);
        }
    };

    private PreviewView previewView;
    private TextView statusText;
    private TextView timerText;
    private LinearLayout qualityBar;
    private Button photoModeButton;
    private Button videoModeButton;
    private Button captureButton;
    private Button flashButton;
    private ProcessCameraProvider cameraProvider;
    private ImageCapture imageCapture;
    private VideoCapture<Recorder> videoCapture;
    private Recording recording;
    private String mode = MODE_PHOTO;
    private Quality selectedQuality = Quality.FHD;
    private int lensFacing = CameraSelector.LENS_FACING_BACK;
    private int flashMode = ImageCapture.FLASH_MODE_OFF;
    private long recordStartedAt = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        mode = MODE_VIDEO.equals(getIntent().getStringExtra(EXTRA_INITIAL_MODE)) ? MODE_VIDEO : MODE_PHOTO;
        buildLayout();
        if (hasCameraPermission()) {
            startCamera();
        } else {
            ActivityCompat.requestPermissions(
                this,
                new String[] { Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO },
                PERMISSION_REQUEST
            );
        }
    }

    @Override
    protected void onDestroy() {
        stopTimer();
        if (recording != null) {
            recording.close();
            recording = null;
        }
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != PERMISSION_REQUEST) return;
        if (hasCameraPermission()) {
            startCamera();
        } else {
            finishWithError("Camera permission is required");
        }
    }

    private void buildLayout() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        previewView = new PreviewView(this);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        root.addView(previewView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        LinearLayout topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setPadding(dp(14), dp(18), dp(14), dp(8));
        topBar.setBackgroundColor(0x33000000);

        Button closeButton = iconButton("×");
        closeButton.setTextSize(24);
        closeButton.setTextColor(0xFFFFE3E3);
        closeButton.setBackground(roundBg(0x883A1111, dp(24), 0x66FF6B6B));
        closeButton.setOnClickListener(v -> finishCancelled());
        topBar.addView(closeButton, new LinearLayout.LayoutParams(dp(48), dp(48)));

        TextView title = new TextView(this);
        title.setText("AMToDo");
        title.setTextColor(Color.WHITE);
        title.setTextSize(16);
        title.setGravity(Gravity.CENTER);
        topBar.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));

        flashButton = iconButton("⚡");
        flashButton.setOnClickListener(v -> toggleFlash());
        topBar.addView(flashButton, new LinearLayout.LayoutParams(dp(48), dp(48)));

        Button switchButton = iconButton("↺");
        switchButton.setOnClickListener(v -> switchCamera());
        LinearLayout.LayoutParams switchParams = new LinearLayout.LayoutParams(dp(48), dp(48));
        switchParams.setMargins(dp(8), 0, 0, 0);
        topBar.addView(switchButton, switchParams);

        FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        topParams.gravity = Gravity.TOP;
        root.addView(topBar, topParams);

        timerText = new TextView(this);
        timerText.setText("00:00");
        timerText.setTextColor(Color.WHITE);
        timerText.setTextSize(15);
        timerText.setGravity(Gravity.CENTER);
        timerText.setVisibility(View.GONE);
        timerText.setBackground(roundBg(0xAA111111, dp(18), 0x44FFFFFF));
        FrameLayout.LayoutParams timerParams = new FrameLayout.LayoutParams(dp(88), dp(36));
        timerParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        timerParams.setMargins(0, dp(82), 0, 0);
        root.addView(timerText, timerParams);

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setGravity(Gravity.CENTER);
        bottom.setPadding(dp(18), dp(12), dp(18), dp(28));
        bottom.setBackgroundColor(0x77000000);

        qualityBar = new LinearLayout(this);
        qualityBar.setOrientation(LinearLayout.HORIZONTAL);
        qualityBar.setGravity(Gravity.CENTER);
        bottom.addView(qualityBar, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(40)
        ));
        rebuildQualityButtons();

        LinearLayout modeBar = new LinearLayout(this);
        modeBar.setOrientation(LinearLayout.HORIZONTAL);
        modeBar.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams modeParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(42)
        );
        modeParams.setMargins(0, dp(10), 0, dp(12));
        bottom.addView(modeBar, modeParams);

        photoModeButton = pillButton("照片");
        photoModeButton.setOnClickListener(v -> switchMode(MODE_PHOTO));
        modeBar.addView(photoModeButton, new LinearLayout.LayoutParams(dp(78), dp(38)));

        videoModeButton = pillButton("视频");
        videoModeButton.setOnClickListener(v -> switchMode(MODE_VIDEO));
        LinearLayout.LayoutParams videoModeParams = new LinearLayout.LayoutParams(dp(78), dp(38));
        videoModeParams.setMargins(dp(8), 0, 0, 0);
        modeBar.addView(videoModeButton, videoModeParams);

        captureButton = new Button(this);
        captureButton.setText("");
        captureButton.setBackground(captureBg(false));
        captureButton.setOnClickListener(v -> handleCapture());
        bottom.addView(captureButton, new LinearLayout.LayoutParams(dp(78), dp(78)));

        statusText = new TextView(this);
        statusText.setTextColor(0xFFEDEDED);
        statusText.setTextSize(13);
        statusText.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        statusParams.setMargins(0, dp(10), 0, 0);
        bottom.addView(statusText, statusParams);

        FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        bottomParams.gravity = Gravity.BOTTOM;
        root.addView(bottom, bottomParams);

        setContentView(root);
        updateModeUi();
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> providerFuture = ProcessCameraProvider.getInstance(this);
        providerFuture.addListener(() -> {
            try {
                cameraProvider = providerFuture.get();
                bindCamera();
            } catch (Exception ex) {
                finishWithError("Failed to start camera: " + messageOf(ex));
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void bindCamera() {
        if (cameraProvider == null) return;
        try {
            Preview preview = new Preview.Builder().build();
            preview.setSurfaceProvider(previewView.getSurfaceProvider());

            imageCapture = new ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .setFlashMode(flashMode)
                .build();

            QualitySelector selector = QualitySelector.from(
                selectedQuality,
                FallbackStrategy.higherQualityOrLowerThan(selectedQuality)
            );
            Recorder recorder = new Recorder.Builder()
                .setQualitySelector(selector)
                .build();
            videoCapture = VideoCapture.withOutput(recorder);

            CameraSelector selectorCamera = new CameraSelector.Builder()
                .requireLensFacing(lensFacing)
                .build();

            cameraProvider.unbindAll();
            cameraProvider.bindToLifecycle(this, selectorCamera, preview, imageCapture, videoCapture);
            updateModeUi();
        } catch (Exception ex) {
            finishWithError("Failed to bind camera: " + messageOf(ex));
        }
    }

    private void handleCapture() {
        if (MODE_VIDEO.equals(mode)) {
            toggleRecording();
        } else {
            takePhoto();
        }
    }

    private void takePhoto() {
        if (imageCapture == null || recording != null) return;
        captureButton.setEnabled(false);
        statusText.setText("正在保存照片...");
        String name = mediaName("jpg");
        ContentValues values = mediaValues(name, "image/jpeg");
        ImageCapture.OutputFileOptions options = new ImageCapture.OutputFileOptions.Builder(
            getContentResolver(),
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            values
        ).build();
        imageCapture.takePicture(options, ContextCompat.getMainExecutor(this), new ImageCapture.OnImageSavedCallback() {
            @Override
            public void onImageSaved(@NonNull ImageCapture.OutputFileResults outputFileResults) {
                Uri uri = outputFileResults.getSavedUri();
                if (uri == null) {
                    captureButton.setEnabled(true);
                    finishWithError("Photo was not saved");
                    return;
                }
                finishOk(uri, name, "image/jpeg", MODE_PHOTO);
            }

            @Override
            public void onError(@NonNull ImageCaptureException exception) {
                captureButton.setEnabled(true);
                statusText.setText("照片保存失败");
                finishWithError("Photo capture failed: " + messageOf(exception));
            }
        });
    }

    private void toggleRecording() {
        if (recording != null) {
            captureButton.setEnabled(false);
            statusText.setText("正在保存视频...");
            recording.stop();
            return;
        }
        if (videoCapture == null) return;

        String name = mediaName("mp4");
        ContentValues values = mediaValues(name, "video/mp4");
        MediaStoreOutputOptions outputOptions = new MediaStoreOutputOptions.Builder(
            getContentResolver(),
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        ).setContentValues(values).build();

        PendingRecording pending = videoCapture.getOutput().prepareRecording(this, outputOptions);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            pending = pending.withAudioEnabled();
        }

        recordStartedAt = System.currentTimeMillis();
        timerText.setVisibility(View.VISIBLE);
        timerHandler.post(timerTick);
        captureButton.setBackground(captureBg(true));
        statusText.setText("正在录像");
        rebuildQualityButtons();

        recording = pending.start(ContextCompat.getMainExecutor(this), event -> {
            if (event instanceof VideoRecordEvent.Finalize) {
                VideoRecordEvent.Finalize finalizeEvent = (VideoRecordEvent.Finalize) event;
                Recording finished = recording;
                recording = null;
                if (finished != null) finished.close();
                stopTimer();
                if (finalizeEvent.hasError()) {
                    captureButton.setEnabled(true);
                    captureButton.setBackground(captureBg(false));
                    rebuildQualityButtons();
                    finishWithError("Video capture failed: " + finalizeEvent.getError());
                    return;
                }
                Uri uri = finalizeEvent.getOutputResults().getOutputUri();
                if (uri == null || Uri.EMPTY.equals(uri)) {
                    captureButton.setEnabled(true);
                    captureButton.setBackground(captureBg(false));
                    rebuildQualityButtons();
                    finishWithError("Video was not saved");
                    return;
                }
                finishOk(uri, name, "video/mp4", MODE_VIDEO);
            }
        });
    }

    private void switchMode(String nextMode) {
        if (recording != null) return;
        mode = MODE_VIDEO.equals(nextMode) ? MODE_VIDEO : MODE_PHOTO;
        updateModeUi();
    }

    private void switchCamera() {
        if (recording != null) return;
        lensFacing = lensFacing == CameraSelector.LENS_FACING_BACK
            ? CameraSelector.LENS_FACING_FRONT
            : CameraSelector.LENS_FACING_BACK;
        bindCamera();
    }

    private void toggleFlash() {
        if (recording != null) return;
        flashMode = flashMode == ImageCapture.FLASH_MODE_OFF ? ImageCapture.FLASH_MODE_ON : ImageCapture.FLASH_MODE_OFF;
        bindCamera();
    }

    private void rebuildQualityButtons() {
        if (qualityBar == null) return;
        qualityBar.removeAllViews();
        addQualityButton("HD", Quality.HD);
        addQualityButton("FHD", Quality.FHD);
        addQualityButton("UHD", Quality.UHD);
    }

    private void addQualityButton(String label, Quality quality) {
        Button button = pillButton(label);
        button.setEnabled(recording == null);
        button.setBackground(roundBg(quality == selectedQuality ? 0xCC1F8E5A : 0x66111111, dp(18), 0x44FFFFFF));
        button.setOnClickListener(v -> {
            if (recording != null) return;
            selectedQuality = quality;
            rebuildQualityButtons();
            bindCamera();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(68), dp(36));
        params.setMargins(dp(4), 0, dp(4), 0);
        qualityBar.addView(button, params);
    }

    private void updateModeUi() {
        if (photoModeButton == null || videoModeButton == null || statusText == null) return;
        photoModeButton.setBackground(roundBg(MODE_PHOTO.equals(mode) ? 0xFFFFFFFF : 0x66111111, dp(19), 0x44FFFFFF));
        photoModeButton.setTextColor(MODE_PHOTO.equals(mode) ? 0xFF111111 : Color.WHITE);
        videoModeButton.setBackground(roundBg(MODE_VIDEO.equals(mode) ? 0xFFFFFFFF : 0x66111111, dp(19), 0x44FFFFFF));
        videoModeButton.setTextColor(MODE_VIDEO.equals(mode) ? 0xFF111111 : Color.WHITE);
        captureButton.setBackground(captureBg(recording != null));
        flashButton.setTextColor(flashMode == ImageCapture.FLASH_MODE_OFF ? 0xFFEDEDED : 0xFFFFD166);
        statusText.setText(MODE_VIDEO.equals(mode) ? qualityName(selectedQuality) + " 视频" : "照片");
    }

    private ContentValues mediaValues(String name, String mimeType) {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, ALBUM_DIR);
        } else {
            java.io.File dir = new java.io.File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM), "AMTODO");
            if (!dir.exists()) dir.mkdirs();
            values.put(MediaStore.MediaColumns.DATA, new java.io.File(dir, name).getAbsolutePath());
        }
        return values;
    }

    private String mediaName(String ext) {
        String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        return "AMToDo_" + stamp + "." + ext;
    }

    private void finishOk(Uri uri, String name, String mimeType, String kind) {
        Intent data = new Intent();
        data.putExtra(EXTRA_URI, uri.toString());
        data.putExtra(EXTRA_NAME, name);
        data.putExtra(EXTRA_MIME_TYPE, mimeType);
        data.putExtra(EXTRA_SIZE, querySize(uri));
        data.putExtra(EXTRA_KIND, kind);
        setResult(Activity.RESULT_OK, data);
        finish();
    }

    private void finishCancelled() {
        if (recording != null) {
            recording.close();
            recording = null;
        }
        setResult(Activity.RESULT_CANCELED);
        finish();
    }

    private void finishWithError(String message) {
        Intent data = new Intent();
        data.putExtra(EXTRA_ERROR, message);
        setResult(Activity.RESULT_CANCELED, data);
        finish();
    }

    private boolean hasCameraPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    private void updateRecordTimer() {
        if (recordStartedAt <= 0) return;
        long seconds = Math.max(0, (System.currentTimeMillis() - recordStartedAt) / 1000);
        timerText.setText(String.format(Locale.US, "%02d:%02d", seconds / 60, seconds % 60));
    }

    private void stopTimer() {
        timerHandler.removeCallbacks(timerTick);
        recordStartedAt = 0L;
        if (timerText != null) {
            timerText.setVisibility(View.GONE);
            timerText.setText("00:00");
        }
    }

    private long querySize(Uri uri) {
        try {
            ContentResolver resolver = getContentResolver();
            android.content.res.AssetFileDescriptor afd = resolver.openAssetFileDescriptor(uri, "r");
            if (afd != null) {
                long length = afd.getLength();
                afd.close();
                return length;
            }
        } catch (Exception ignored) {
        }
        return -1;
    }

    private Button iconButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(18);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setPadding(0, 0, 0, 0);
        button.setBackground(roundBg(0x55111111, dp(24), 0x33FFFFFF));
        return button;
    }

    private Button pillButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(13);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setPadding(0, 0, 0, 0);
        button.setBackground(roundBg(0x66111111, dp(18), 0x44FFFFFF));
        return button;
    }

    private GradientDrawable captureBg(boolean active) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.OVAL);
        drawable.setColor(active ? 0xFFD92626 : 0xFFFFFFFF);
        drawable.setStroke(dp(5), active ? 0xFFFFC9C9 : 0xCCFFFFFF);
        return drawable;
    }

    private GradientDrawable roundBg(int color, int radius, int strokeColor) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.RECTANGLE);
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        drawable.setStroke(dp(1), strokeColor);
        return drawable;
    }

    private String qualityName(Quality quality) {
        if (quality == Quality.HD) return "HD";
        if (quality == Quality.UHD) return "UHD";
        return "FHD";
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private String messageOf(Exception ex) {
        return ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage();
    }
}
