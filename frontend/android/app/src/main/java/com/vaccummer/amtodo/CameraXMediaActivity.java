package com.vaccummer.amtodo;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.hardware.camera2.CaptureRequest;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Range;
import android.util.Rational;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.VideoView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.camera2.interop.Camera2Interop;
import androidx.camera.core.AspectRatio;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.core.ZoomState;
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
import java.util.concurrent.TimeUnit;

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
    private static final String RATIO_1_1 = "1:1";
    private static final String RATIO_4_3 = "4:3";
    private static final String RATIO_16_9 = "16:9";
    private static final String RATIO_FULL = "全屏";

    private final Handler timerHandler = new Handler(Looper.getMainLooper());
    private final Runnable timerTick = new Runnable() {
        @Override
        public void run() {
            updateRecordTimer();
            timerHandler.postDelayed(this, 500);
        }
    };

    private PreviewView previewView;
    private FrameLayout reviewOverlay;
    private ImageView photoReviewView;
    private VideoView videoReviewView;
    private FrameLayout rootLayout;
    private View focusRing;
    private TextView zoomText;
    private TextView statusText;
    private TextView timerText;
    private LinearLayout bottomPanel;
    private LinearLayout ratioBar;
    private LinearLayout qualityBar;
    private LinearLayout fpsBar;
    private LinearLayout zoomRail;
    private Button photoModeButton;
    private Button videoModeButton;
    private Button captureButton;
    private Button leftActionButton;
    private Button optionButton;
    private Button flashButton;
    private ImageButton switchButton;
    private ProcessCameraProvider cameraProvider;
    private Camera camera;
    private ImageCapture imageCapture;
    private VideoCapture<Recorder> videoCapture;
    private Recording recording;
    private ScaleGestureDetector scaleGestureDetector;
    private String mode = MODE_PHOTO;
    private Quality selectedQuality = Quality.FHD;
    private int selectedAspectRatio = AspectRatio.RATIO_16_9;
    private String selectedRatioMode = RATIO_FULL;
    private int selectedFps = 30;
    private int lensFacing = CameraSelector.LENS_FACING_BACK;
    private int flashMode = ImageCapture.FLASH_MODE_OFF;
    private boolean torchAlwaysOn = false;
    private boolean optionMenuOpen = false;
    private boolean reviewing = false;
    private Uri pendingUri;
    private String pendingName;
    private String pendingMimeType;
    private String pendingKind;
    private boolean reviewVideoPlaying = false;
    private float currentZoomRatio = 1f;
    private float minZoomRatio = 1f;
    private float maxZoomRatio = 1f;
    private boolean scaleInProgress = false;
    private float touchDownX = 0f;
    private float touchDownY = 0f;
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
    public void onBackPressed() {
        if (reviewing) {
            retakeCapture();
            return;
        }
        finishCancelled();
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
        rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(Color.BLACK);

        previewView = new PreviewView(this);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        rootLayout.addView(previewView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        rootLayout.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> applyPreviewFrame());
        setupPreviewGestures();

        reviewOverlay = new FrameLayout(this);
        reviewOverlay.setBackgroundColor(Color.BLACK);
        reviewOverlay.setVisibility(View.GONE);
        photoReviewView = new ImageView(this);
        photoReviewView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        photoReviewView.setVisibility(View.GONE);
        reviewOverlay.addView(photoReviewView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        videoReviewView = new VideoView(this);
        videoReviewView.setVisibility(View.GONE);
        videoReviewView.setOnCompletionListener(mp -> {
            reviewVideoPlaying = false;
            updateModeUi();
        });
        reviewOverlay.addView(videoReviewView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        rootLayout.addView(reviewOverlay, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        focusRing = new View(this);
        focusRing.setVisibility(View.GONE);
        focusRing.setBackground(focusRingBg());
        rootLayout.addView(focusRing, new FrameLayout.LayoutParams(dp(76), dp(76)));

        LinearLayout topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setPadding(dp(22), dp(30), dp(22), dp(8));
        topBar.setBackgroundColor(0x00000000);

        TextView spacer = new TextView(this);
        topBar.addView(spacer, new LinearLayout.LayoutParams(0, dp(50), 1));

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
        rootLayout.addView(timerText, timerParams);

        zoomText = new TextView(this);
        zoomText.setText("1.0x");
        zoomText.setTextColor(Color.WHITE);
        zoomText.setTextSize(14);
        zoomText.setGravity(Gravity.CENTER);
        zoomText.setVisibility(View.GONE);
        zoomText.setBackground(roundBg(0xAA111111, dp(17), 0x44FFFFFF));
        FrameLayout.LayoutParams zoomParams = new FrameLayout.LayoutParams(dp(76), dp(34));
        zoomParams.gravity = Gravity.CENTER_HORIZONTAL | Gravity.BOTTOM;
        zoomParams.setMargins(0, 0, 0, dp(212));
        rootLayout.addView(zoomText, zoomParams);

        LinearLayout bottom = new LinearLayout(this);
        bottomPanel = bottom;
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setGravity(Gravity.CENTER);
        bottom.setPadding(dp(16), dp(10), dp(16), dp(26));
        bottom.setBackgroundColor(0x00000000);

        ratioBar = new LinearLayout(this);
        ratioBar.setOrientation(LinearLayout.HORIZONTAL);
        ratioBar.setGravity(Gravity.CENTER);
        ratioBar.setPadding(dp(10), dp(2), dp(10), dp(2));
        ratioBar.setBackground(roundBg(0xDD1D1D1D, dp(14), 0x001D1D1D));
        LinearLayout.LayoutParams ratioParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(58)
        );
        ratioParams.setMargins(dp(12), 0, dp(12), dp(8));
        bottom.addView(ratioBar, ratioParams);
        rebuildRatioButtons();

        qualityBar = new LinearLayout(this);
        qualityBar.setOrientation(LinearLayout.HORIZONTAL);
        qualityBar.setGravity(Gravity.CENTER);
        qualityBar.setPadding(dp(6), dp(2), dp(6), dp(2));
        qualityBar.setBackground(roundBg(0xAA1D1D1D, dp(21), 0x001D1D1D));
        LinearLayout.LayoutParams qualityParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(40)
        );
        qualityParams.setMargins(0, dp(6), 0, 0);
        bottom.addView(qualityBar, qualityParams);
        rebuildQualityButtons();

        fpsBar = new LinearLayout(this);
        fpsBar.setOrientation(LinearLayout.HORIZONTAL);
        fpsBar.setGravity(Gravity.CENTER);
        fpsBar.setPadding(dp(6), dp(2), dp(6), dp(2));
        fpsBar.setBackground(roundBg(0xAA1D1D1D, dp(21), 0x001D1D1D));
        LinearLayout.LayoutParams fpsParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(40)
        );
        fpsParams.setMargins(0, dp(6), 0, 0);
        bottom.addView(fpsBar, fpsParams);
        rebuildFpsButtons();

        LinearLayout controlRail = new LinearLayout(this);
        controlRail.setOrientation(LinearLayout.HORIZONTAL);
        controlRail.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams controlRailParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(44)
        );
        controlRailParams.setMargins(0, dp(12), 0, dp(6));
        bottom.addView(controlRail, controlRailParams);

        LinearLayout flashSlot = new LinearLayout(this);
        flashSlot.setGravity(Gravity.CENTER);
        controlRail.addView(flashSlot, new LinearLayout.LayoutParams(0, dp(44), 1));

        flashButton = iconButton("关");
        flashButton.setTextSize(14);
        flashButton.setBackground(roundBg(0x661D1D1D, dp(20), 0x00FFFFFF));
        flashButton.setOnClickListener(v -> toggleFlash());
        flashSlot.addView(flashButton, new LinearLayout.LayoutParams(dp(64), dp(40)));

        zoomRail = new LinearLayout(this);
        zoomRail.setOrientation(LinearLayout.HORIZONTAL);
        zoomRail.setGravity(Gravity.CENTER);
        zoomRail.setPadding(dp(5), dp(3), dp(5), dp(3));
        zoomRail.setBackground(roundBg(0x661D1D1D, dp(18), 0x00FFFFFF));
        LinearLayout.LayoutParams zoomRailParams = new LinearLayout.LayoutParams(0, dp(40), 3);
        controlRail.addView(zoomRail, zoomRailParams);
        rebuildZoomRail();

        LinearLayout optionSlot = new LinearLayout(this);
        optionSlot.setGravity(Gravity.CENTER);
        controlRail.addView(optionSlot, new LinearLayout.LayoutParams(0, dp(44), 1));

        optionButton = iconButton("⋯");
        optionButton.setTextSize(24);
        optionButton.setBackground(roundBg(0x661D1D1D, dp(20), 0x00FFFFFF));
        optionButton.setOnClickListener(v -> toggleOptionMenu());
        optionSlot.addView(optionButton, new LinearLayout.LayoutParams(dp(54), dp(40)));

        LinearLayout modeBar = new LinearLayout(this);
        modeBar.setOrientation(LinearLayout.HORIZONTAL);
        modeBar.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams modeParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(54)
        );
        modeParams.setMargins(0, dp(2), 0, dp(18));
        bottom.addView(modeBar, modeParams);

        TextView leftModeSpacer = new TextView(this);
        modeBar.addView(leftModeSpacer, new LinearLayout.LayoutParams(0, dp(54), 1));

        videoModeButton = modeButton(modeLabel(MODE_VIDEO));
        videoModeButton.setOnClickListener(v -> switchMode(MODE_VIDEO));
        LinearLayout.LayoutParams videoModeParams = new LinearLayout.LayoutParams(0, dp(54), 1);
        modeBar.addView(videoModeButton, videoModeParams);

        photoModeButton = modeButton(modeLabel(MODE_PHOTO));
        photoModeButton.setOnClickListener(v -> switchMode(MODE_PHOTO));
        modeBar.addView(photoModeButton, new LinearLayout.LayoutParams(0, dp(54), 1));

        TextView rightModeSpacer = new TextView(this);
        modeBar.addView(rightModeSpacer, new LinearLayout.LayoutParams(0, dp(54), 1));

        LinearLayout captureRow = new LinearLayout(this);
        captureRow.setOrientation(LinearLayout.HORIZONTAL);
        captureRow.setGravity(Gravity.CENTER);
        bottom.addView(captureRow, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(82)
        ));

        LinearLayout leftSlot = new LinearLayout(this);
        leftSlot.setGravity(Gravity.CENTER);
        captureRow.addView(leftSlot, new LinearLayout.LayoutParams(0, dp(88), 1));

        leftActionButton = iconButton("×");
        leftActionButton.setTextSize(30);
        leftActionButton.setVisibility(View.VISIBLE);
        leftActionButton.setBackground(roundBg(0x661D1D1D, dp(30), 0x00FFFFFF));
        leftActionButton.setOnClickListener(v -> retakeCapture());
        leftSlot.addView(leftActionButton, new LinearLayout.LayoutParams(dp(60), dp(60)));

        captureButton = new Button(this);
        captureButton.setText("");
        captureButton.setMinWidth(0);
        captureButton.setMinHeight(0);
        captureButton.setPadding(0, 0, 0, 0);
        captureButton.setAllCaps(false);
        captureButton.setIncludeFontPadding(false);
        captureButton.setBackground(captureBg(false));
        captureButton.setOnClickListener(v -> handleCapture());
        captureRow.addView(captureButton, new LinearLayout.LayoutParams(dp(72), dp(72)));

        LinearLayout switchSlot = new LinearLayout(this);
        switchSlot.setGravity(Gravity.CENTER);
        captureRow.addView(switchSlot, new LinearLayout.LayoutParams(0, dp(88), 1));

        switchButton = imageButton();
        switchButton.setImageResource(R.drawable.ic_camera_switch);
        switchButton.setBackground(roundBg(0x33111111, dp(30), 0x00FFFFFF));
        switchButton.setOnClickListener(v -> switchCamera());
        switchSlot.addView(switchButton, new LinearLayout.LayoutParams(dp(60), dp(60)));

        statusText = new TextView(this);
        statusText.setTextColor(0xFFEDEDED);
        statusText.setTextSize(13);
        statusText.setGravity(Gravity.CENTER);
        statusText.setVisibility(View.GONE);
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        statusParams.setMargins(0, dp(4), 0, 0);
        bottom.addView(statusText, statusParams);

        FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        bottomParams.gravity = Gravity.BOTTOM;
        rootLayout.addView(bottom, bottomParams);

        setContentView(rootLayout);
        rootLayout.post(this::applyPreviewFrame);
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
            selectedAspectRatio = aspectRatioForMode(selectedRatioMode);
            Preview.Builder previewBuilder = new Preview.Builder();
            if (!RATIO_FULL.equals(selectedRatioMode)) {
                previewBuilder.setTargetAspectRatio(selectedAspectRatio);
            }
            applyFps(previewBuilder);
            Preview preview = previewBuilder.build();
            preview.setSurfaceProvider(previewView.getSurfaceProvider());

            ImageCapture.Builder imageBuilder = new ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .setFlashMode(flashMode);
            if (!RATIO_FULL.equals(selectedRatioMode)) {
                imageBuilder.setTargetAspectRatio(selectedAspectRatio);
            }
            applyFps(imageBuilder);
            imageCapture = imageBuilder.build();

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
            camera = cameraProvider.bindToLifecycle(this, selectorCamera, preview, imageCapture, videoCapture);
            observeZoom();
            applyTorchForMode();
            updateModeUi();
        } catch (Exception ex) {
            finishWithError("Failed to bind camera: " + messageOf(ex));
        }
    }

    private void handleCapture() {
        if (reviewing) {
            if (MODE_VIDEO.equals(pendingKind)) {
                toggleReviewPlayback();
            }
            return;
        }
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
        applyImageCropRatio();
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
                enterReview(uri, name, "image/jpeg", MODE_PHOTO);
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
        rebuildRatioButtons();
        rebuildQualityButtons();
        rebuildFpsButtons();

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
                    rebuildRatioButtons();
                    rebuildQualityButtons();
                    rebuildFpsButtons();
                    finishWithError("Video capture failed: " + finalizeEvent.getError());
                    return;
                }
                Uri uri = finalizeEvent.getOutputResults().getOutputUri();
                if (uri == null || Uri.EMPTY.equals(uri)) {
                    captureButton.setEnabled(true);
                    captureButton.setBackground(captureBg(false));
                    rebuildRatioButtons();
                    rebuildQualityButtons();
                    rebuildFpsButtons();
                    finishWithError("Video was not saved");
                    return;
                }
                enterReview(uri, name, "video/mp4", MODE_VIDEO);
            }
        });
        applyTorchForMode();
        updateModeUi();
    }

    private void switchMode(String nextMode) {
        if (recording != null || reviewing) return;
        mode = MODE_VIDEO.equals(nextMode) ? MODE_VIDEO : MODE_PHOTO;
        applyTorchForMode();
        updateModeUi();
    }

    private void switchCamera() {
        if (reviewing) {
            confirmCapture();
            return;
        }
        if (recording != null) return;
        lensFacing = lensFacing == CameraSelector.LENS_FACING_BACK
            ? CameraSelector.LENS_FACING_FRONT
            : CameraSelector.LENS_FACING_BACK;
        bindCamera();
    }

    private void toggleFlash() {
        if (recording != null || reviewing) return;
        if (flashMode == ImageCapture.FLASH_MODE_OFF) {
            flashMode = ImageCapture.FLASH_MODE_ON;
            torchAlwaysOn = false;
        } else if (!torchAlwaysOn) {
            flashMode = ImageCapture.FLASH_MODE_OFF;
            torchAlwaysOn = true;
        } else {
            flashMode = ImageCapture.FLASH_MODE_OFF;
            torchAlwaysOn = false;
        }
        bindCamera();
    }

    private void toggleOptionMenu() {
        if (reviewing) return;
        optionMenuOpen = !optionMenuOpen;
        updateModeUi();
    }

    private void rebuildRatioButtons() {
        if (ratioBar == null) return;
        ratioBar.removeAllViews();
        addRatioButton(RATIO_1_1);
        addRatioButton(RATIO_4_3);
        addRatioButton(RATIO_16_9);
        addRatioButton(RATIO_FULL);
    }

    private void addRatioButton(String label) {
        Button button = pillButton(label);
        boolean selected = label.equals(selectedRatioMode);
        button.setEnabled(recording == null);
        button.setTextSize(18);
        button.setTextColor(selected ? 0xFFFF8A33 : 0xFFEDEDED);
        button.setBackgroundColor(0x00000000);
        button.setOnClickListener(v -> {
            if (recording != null) return;
            selectedRatioMode = label;
            selectedAspectRatio = aspectRatioForMode(label);
            rebuildRatioButtons();
            applyPreviewFrame();
            bindCamera();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(50), 1);
        params.setMargins(dp(2), 0, dp(2), 0);
        ratioBar.addView(button, params);
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
        button.setTextColor(quality == selectedQuality ? 0xFF111111 : 0xFFEDEDED);
        button.setBackground(roundBg(quality == selectedQuality ? 0xE6FFD166 : 0x44111111, dp(18), 0x33FFFFFF));
        button.setOnClickListener(v -> {
            if (recording != null) return;
            selectedQuality = quality;
            rebuildQualityButtons();
            bindCamera();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(66), dp(34));
        params.setMargins(dp(4), 0, dp(4), 0);
        qualityBar.addView(button, params);
    }

    private void rebuildFpsButtons() {
        if (fpsBar == null) return;
        fpsBar.removeAllViews();
        addFpsButton(24);
        addFpsButton(30);
        addFpsButton(60);
    }

    private void addFpsButton(int fps) {
        Button button = pillButton(fps + "fps");
        button.setEnabled(recording == null);
        button.setTextColor(fps == selectedFps ? 0xFF111111 : 0xFFEDEDED);
        button.setBackground(roundBg(fps == selectedFps ? 0xE6FFD166 : 0x44111111, dp(18), 0x33FFFFFF));
        button.setOnClickListener(v -> {
            if (recording != null) return;
            selectedFps = fps;
            rebuildFpsButtons();
            bindCamera();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(72), dp(34));
        params.setMargins(dp(4), 0, dp(4), 0);
        fpsBar.addView(button, params);
    }

    private void updateModeUi() {
        if (photoModeButton == null || videoModeButton == null || statusText == null) return;
        photoModeButton.setText(modeLabel(MODE_PHOTO));
        videoModeButton.setText(modeLabel(MODE_VIDEO));
        photoModeButton.setBackgroundColor(0x00000000);
        photoModeButton.setTextColor(MODE_PHOTO.equals(mode) ? 0xFFFF8A33 : Color.WHITE);
        videoModeButton.setBackgroundColor(0x00000000);
        videoModeButton.setTextColor(MODE_VIDEO.equals(mode) ? 0xFFFF8A33 : Color.WHITE);
        captureButton.setBackground(captureBg(recording != null));
        captureButton.setText(reviewing && MODE_VIDEO.equals(pendingKind) ? (reviewVideoPlaying ? "Ⅱ" : "▶") : "");
        captureButton.setTextColor(Color.WHITE);
        captureButton.setTextSize(28);
        flashButton.setText(flashLabel());
        flashButton.setTextColor((flashMode == ImageCapture.FLASH_MODE_OFF && !torchAlwaysOn) ? 0xFFEDEDED : 0xFFFF8A33);
        boolean videoMode = MODE_VIDEO.equals(mode);
        if (ratioBar != null) ratioBar.setVisibility(optionMenuOpen && !videoMode && !reviewing ? View.VISIBLE : View.GONE);
        if (qualityBar != null) qualityBar.setVisibility(optionMenuOpen && videoMode && !reviewing ? View.VISIBLE : View.GONE);
        if (fpsBar != null) fpsBar.setVisibility(optionMenuOpen && videoMode && !reviewing ? View.VISIBLE : View.GONE);
        if (optionButton != null) {
            optionButton.setText(optionMenuOpen ? "×" : "⋯");
            optionButton.setVisibility(reviewing ? View.INVISIBLE : View.VISIBLE);
        }
        if (leftActionButton != null) leftActionButton.setVisibility(View.VISIBLE);
        if (switchButton != null) {
            switchButton.setImageResource(reviewing ? R.drawable.ic_camera_check : R.drawable.ic_camera_switch);
            switchButton.setColorFilter(reviewing ? 0xFFFF8A33 : Color.WHITE);
        }
        boolean controlsEnabled = !reviewing && recording == null;
        photoModeButton.setEnabled(controlsEnabled);
        videoModeButton.setEnabled(controlsEnabled);
        flashButton.setEnabled(controlsEnabled);
        if (optionButton != null) optionButton.setEnabled(!reviewing);
        if (zoomRail != null) zoomRail.setVisibility(reviewing ? View.GONE : View.VISIBLE);
        statusText.setText("");
        if (rootLayout != null) rootLayout.post(this::applyPreviewFrame);
    }

    private void applyPreviewFrame() {
        if (rootLayout == null || previewView == null) return;
        int rootWidth = rootLayout.getWidth();
        int rootHeight = rootLayout.getHeight();
        if (rootWidth <= 0 || rootHeight <= 0) return;

        FrameLayout.LayoutParams params;
        if (RATIO_FULL.equals(selectedRatioMode)) {
            params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            );
            params.gravity = Gravity.CENTER;
            setPreviewLayout(params);
            return;
        }

        int targetWidth = rootWidth;
        int targetHeight;

        if (RATIO_1_1.equals(selectedRatioMode)) {
            targetHeight = rootWidth;
        } else {
            float ratio = RATIO_4_3.equals(selectedRatioMode) ? (4f / 3f) : (16f / 9f);
            targetHeight = Math.round(targetWidth * ratio);
        }

        params = new FrameLayout.LayoutParams(targetWidth, targetHeight);
        params.gravity = Gravity.CENTER;
        setPreviewLayout(params);
    }

    private void setPreviewLayout(FrameLayout.LayoutParams next) {
        ViewGroup.LayoutParams current = previewView.getLayoutParams();
        if (current instanceof FrameLayout.LayoutParams) {
            FrameLayout.LayoutParams frame = (FrameLayout.LayoutParams) current;
            if (frame.width == next.width && frame.height == next.height && frame.gravity == next.gravity) {
                return;
            }
        }
        previewView.setLayoutParams(next);
    }

    private void applyImageCropRatio() {
        if (imageCapture == null) return;
        Rational ratio = captureCropRatio();
        if (ratio == null) return;
        try {
            imageCapture.setCropAspectRatio(ratio);
        } catch (Exception ignored) {
        }
    }

    private Rational captureCropRatio() {
        if (RATIO_1_1.equals(selectedRatioMode)) return new Rational(1, 1);
        if (RATIO_4_3.equals(selectedRatioMode)) return new Rational(3, 4);
        if (RATIO_16_9.equals(selectedRatioMode)) return new Rational(9, 16);
        int width = rootLayout != null ? rootLayout.getWidth() : 0;
        int height = rootLayout != null ? rootLayout.getHeight() : 0;
        if (width <= 0 || height <= 0) return null;
        return new Rational(width, height);
    }

    private void centerVideoReview(int videoWidth, int videoHeight) {
        if (reviewOverlay == null || videoReviewView == null || videoWidth <= 0 || videoHeight <= 0) return;
        int overlayWidth = reviewOverlay.getWidth();
        int overlayHeight = reviewOverlay.getHeight();
        if (overlayWidth <= 0 || overlayHeight <= 0) {
            reviewOverlay.post(() -> centerVideoReview(videoWidth, videoHeight));
            return;
        }
        float videoRatio = (float) videoWidth / (float) videoHeight;
        int targetWidth = overlayWidth;
        int targetHeight = Math.round(targetWidth / videoRatio);
        if (targetHeight > overlayHeight) {
            targetHeight = overlayHeight;
            targetWidth = Math.round(targetHeight * videoRatio);
        }
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(targetWidth, targetHeight);
        params.gravity = Gravity.CENTER;
        videoReviewView.setLayoutParams(params);
    }

    private void setupPreviewGestures() {
        scaleGestureDetector = new ScaleGestureDetector(this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override
            public boolean onScaleBegin(ScaleGestureDetector detector) {
                scaleInProgress = true;
                showZoomText();
                return true;
            }

            @Override
            public boolean onScale(ScaleGestureDetector detector) {
                if (camera == null) return false;
                float next = clamp(currentZoomRatio * detector.getScaleFactor(), minZoomRatio, maxZoomRatio);
                camera.getCameraControl().setZoomRatio(next);
                currentZoomRatio = next;
                showZoomText();
                return true;
            }

            @Override
            public void onScaleEnd(ScaleGestureDetector detector) {
                zoomText.postDelayed(() -> zoomText.setVisibility(View.GONE), 1100);
            }
        });

        previewView.setOnTouchListener((view, event) -> {
            scaleGestureDetector.onTouchEvent(event);
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                touchDownX = event.getX();
                touchDownY = event.getY();
                scaleInProgress = false;
            } else if (event.getActionMasked() == MotionEvent.ACTION_UP) {
                float dx = event.getX() - touchDownX;
                float dy = event.getY() - touchDownY;
                if (!scaleInProgress && Math.abs(dx) > dp(72) && Math.abs(dx) > Math.abs(dy) * 1.4f) {
                    switchMode(MODE_PHOTO.equals(mode) ? MODE_VIDEO : MODE_PHOTO);
                    return true;
                }
                if (!scaleInProgress && event.getPointerCount() == 1) {
                    focusAt(event.getX(), event.getY());
                }
                scaleInProgress = false;
            } else if (event.getActionMasked() == MotionEvent.ACTION_CANCEL) {
                scaleInProgress = false;
            }
            return true;
        });
    }

    private void focusAt(float x, float y) {
        if (camera == null || previewView == null) return;
        try {
            MeteringPoint point = previewView.getMeteringPointFactory().createPoint(x, y);
            FocusMeteringAction action = new FocusMeteringAction.Builder(
                point,
                FocusMeteringAction.FLAG_AF | FocusMeteringAction.FLAG_AE
            ).setAutoCancelDuration(3, TimeUnit.SECONDS).build();
            camera.getCameraControl().startFocusAndMetering(action);
            showFocusRing(x, y);
        } catch (Exception ignored) {
        }
    }

    private void showFocusRing(float x, float y) {
        if (focusRing == null) return;
        int size = dp(76);
        focusRing.setX(previewView.getX() + x - size / 2f);
        focusRing.setY(previewView.getY() + y - size / 2f);
        focusRing.setScaleX(1.35f);
        focusRing.setScaleY(1.35f);
        focusRing.setAlpha(1f);
        focusRing.setVisibility(View.VISIBLE);
        focusRing.animate().cancel();
        focusRing.animate()
            .scaleX(1f)
            .scaleY(1f)
            .setDuration(130)
            .withEndAction(() -> focusRing.animate()
                .alpha(0f)
                .setStartDelay(650)
                .setDuration(260)
                .withEndAction(() -> focusRing.setVisibility(View.GONE))
                .start())
            .start();
    }

    private void observeZoom() {
        if (camera == null) return;
        camera.getCameraInfo().getZoomState().observe(this, state -> {
            if (state == null) return;
            currentZoomRatio = state.getZoomRatio();
            minZoomRatio = state.getMinZoomRatio();
            maxZoomRatio = state.getMaxZoomRatio();
            if (zoomText != null && zoomText.getVisibility() == View.VISIBLE) {
                zoomText.setText(String.format(Locale.US, "%.1fx", currentZoomRatio));
            }
            rebuildZoomRail();
        });
    }

    private void showZoomText() {
        if (zoomText == null) return;
        zoomText.setText(String.format(Locale.US, "%.1fx", currentZoomRatio));
        zoomText.setVisibility(View.VISIBLE);
    }

    private void rebuildZoomRail() {
        if (zoomRail == null) return;
        zoomRail.removeAllViews();
        addZoomButton("0.6", 0.6f);
        addZoomButton("1×", 1f);
        addZoomButton("2", 2f);
        addZoomButton("3", 3f);
        addZoomButton("6", 6f);
    }

    private void addZoomButton(String label, float zoomRatio) {
        Button button = pillButton(label);
        button.setTextSize(15);
        boolean selected = Math.abs(currentZoomRatio - zoomRatio) < 0.15f;
        button.setTextColor(selected ? 0xFFFF8A33 : Color.WHITE);
        button.setBackground(selected ? roundBg(0xAA2C2C2C, dp(16), 0x00FFFFFF) : roundBg(0x00000000, dp(16), 0x00000000));
        button.setOnClickListener(v -> setZoomRatio(zoomRatio));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(54), dp(34));
        params.setMargins(dp(3), 0, dp(3), 0);
        zoomRail.addView(button, params);
    }

    private void setZoomRatio(float requestedRatio) {
        if (camera == null) return;
        float next = clamp(requestedRatio, minZoomRatio, maxZoomRatio);
        camera.getCameraControl().setZoomRatio(next);
        currentZoomRatio = next;
        showZoomText();
        rebuildZoomRail();
        zoomText.postDelayed(() -> zoomText.setVisibility(View.GONE), 900);
    }

    private void applyFps(Preview.Builder builder) {
        try {
            new Camera2Interop.Extender<>(builder).setCaptureRequestOption(
                CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
                new Range<>(selectedFps, selectedFps)
            );
        } catch (Exception ignored) {
        }
    }

    private void applyFps(ImageCapture.Builder builder) {
        try {
            new Camera2Interop.Extender<>(builder).setCaptureRequestOption(
                CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
                new Range<>(selectedFps, selectedFps)
            );
        } catch (Exception ignored) {
        }
    }

    private void applyTorchForMode() {
        if (camera == null) return;
        boolean torch = torchAlwaysOn || (MODE_VIDEO.equals(mode) && recording != null && flashMode == ImageCapture.FLASH_MODE_ON);
        try {
            camera.getCameraControl().enableTorch(torch);
        } catch (Exception ignored) {
        }
    }

    private String flashLabel() {
        if (torchAlwaysOn) return "灯";
        if (flashMode == ImageCapture.FLASH_MODE_ON) return "闪";
        return "关";
    }

    private String modeLabel(String modeValue) {
        boolean chinese = Locale.getDefault().getLanguage().toLowerCase(Locale.US).startsWith("zh");
        if (MODE_VIDEO.equals(modeValue)) return chinese ? "视频" : "Video";
        return chinese ? "照片" : "Photo";
    }

    private int aspectRatioForMode(String label) {
        return RATIO_4_3.equals(label) || RATIO_1_1.equals(label)
            ? AspectRatio.RATIO_4_3
            : AspectRatio.RATIO_16_9;
    }

    private float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
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

    private void enterReview(Uri uri, String name, String mimeType, String kind) {
        reviewing = true;
        pendingUri = uri;
        pendingName = name;
        pendingMimeType = mimeType;
        pendingKind = kind;
        mode = MODE_VIDEO.equals(kind) ? MODE_VIDEO : MODE_PHOTO;
        optionMenuOpen = false;
        captureButton.setEnabled(true);
        if (cameraProvider != null) {
            cameraProvider.unbindAll();
            camera = null;
        }
        previewView.setVisibility(View.GONE);
        reviewOverlay.setVisibility(View.VISIBLE);
        if (MODE_VIDEO.equals(kind)) {
            photoReviewView.setVisibility(View.GONE);
            videoReviewView.setVisibility(View.VISIBLE);
            videoReviewView.setVideoURI(uri);
            videoReviewView.setOnPreparedListener(mp -> {
                centerVideoReview(mp.getVideoWidth(), mp.getVideoHeight());
                videoReviewView.seekTo(1);
                reviewVideoPlaying = false;
                updateModeUi();
            });
        } else {
            videoReviewView.stopPlayback();
            videoReviewView.setVisibility(View.GONE);
            photoReviewView.setImageURI(uri);
            photoReviewView.setVisibility(View.VISIBLE);
        }
        updateModeUi();
    }

    private void confirmCapture() {
        if (!reviewing || pendingUri == null) return;
        finishOk(pendingUri, pendingName, pendingMimeType, pendingKind);
    }

    private void retakeCapture() {
        if (!reviewing) {
            finishCancelled();
            return;
        }
        if (videoReviewView != null) {
            videoReviewView.stopPlayback();
            videoReviewView.setVisibility(View.GONE);
        }
        if (photoReviewView != null) {
            photoReviewView.setImageDrawable(null);
            photoReviewView.setVisibility(View.GONE);
        }
        if (pendingUri != null) {
            try {
                getContentResolver().delete(pendingUri, null, null);
            } catch (Exception ignored) {
            }
        }
        pendingUri = null;
        pendingName = null;
        pendingMimeType = null;
        pendingKind = null;
        reviewing = false;
        reviewVideoPlaying = false;
        reviewOverlay.setVisibility(View.GONE);
        previewView.setVisibility(View.VISIBLE);
        captureButton.setEnabled(true);
        bindCamera();
        updateModeUi();
    }

    private void toggleReviewPlayback() {
        if (!reviewing || !MODE_VIDEO.equals(pendingKind) || videoReviewView == null) return;
        if (videoReviewView.isPlaying()) {
            videoReviewView.pause();
            reviewVideoPlaying = false;
        } else {
            videoReviewView.start();
            reviewVideoPlaying = true;
        }
        updateModeUi();
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
        if (videoReviewView != null) {
            videoReviewView.stopPlayback();
        }
        if (reviewing && pendingUri != null) {
            try {
                getContentResolver().delete(pendingUri, null, null);
            } catch (Exception ignored) {
            }
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

    private Button modeButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(18);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setPadding(0, 0, 0, 0);
        button.setMinWidth(0);
        button.setMinHeight(0);
        button.setIncludeFontPadding(false);
        button.setBackgroundColor(0x00000000);
        return button;
    }

    private Button iconButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(18);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setPadding(0, 0, 0, 0);
        button.setMinWidth(0);
        button.setMinHeight(0);
        button.setIncludeFontPadding(false);
        button.setBackground(roundBg(0x55111111, dp(24), 0x33FFFFFF));
        return button;
    }

    private ImageButton imageButton() {
        ImageButton button = new ImageButton(this);
        button.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        button.setPadding(dp(12), dp(12), dp(12), dp(12));
        button.setBackground(roundBg(0x55111111, dp(24), 0x33FFFFFF));
        button.setColorFilter(Color.WHITE);
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
        button.setMinWidth(0);
        button.setMinHeight(0);
        button.setIncludeFontPadding(false);
        button.setBackground(roundBg(0x66111111, dp(18), 0x44FFFFFF));
        return button;
    }

    private GradientDrawable captureBg(boolean active) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(active ? GradientDrawable.RECTANGLE : GradientDrawable.OVAL);
        drawable.setCornerRadius(active ? dp(18) : dp(44));
        int color = active || MODE_VIDEO.equals(mode) ? 0xFFD92626 : 0xFFFF8A33;
        drawable.setColor(color);
        drawable.setStroke(dp(6), Color.WHITE);
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

    private GradientDrawable focusRingBg() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.RECTANGLE);
        drawable.setColor(0x00000000);
        drawable.setCornerRadius(dp(10));
        drawable.setStroke(dp(2), 0xFFFFD166);
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
