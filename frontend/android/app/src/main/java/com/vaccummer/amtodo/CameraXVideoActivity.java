package com.vaccummer.amtodo;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
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
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.video.FallbackStrategy;
import androidx.camera.video.FileOutputOptions;
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

import java.io.File;
import java.util.ArrayList;
import java.util.List;

public class CameraXVideoActivity extends AppCompatActivity {
    public static final String EXTRA_OUTPUT_PATH = "outputPath";
    public static final String EXTRA_QUALITY = "quality";

    private static final int PERMISSION_REQUEST = 7241;

    private PreviewView previewView;
    private TextView statusText;
    private Button recordButton;
    private LinearLayout qualityBar;
    private ProcessCameraProvider cameraProvider;
    private VideoCapture<Recorder> videoCapture;
    private Recording recording;
    private File outputFile;
    private Quality selectedQuality = Quality.FHD;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        String outputPath = getIntent().getStringExtra(EXTRA_OUTPUT_PATH);
        if (outputPath == null || outputPath.isEmpty()) {
            finishWithError("Missing output path");
            return;
        }
        outputFile = new File(outputPath);
        selectedQuality = qualityFromName(getIntent().getStringExtra(EXTRA_QUALITY));

        buildLayout();
        if (hasPermissions()) {
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
        if (hasPermissions()) {
            startCamera();
        } else {
            finishWithError("Camera and microphone permissions are required");
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

        Button closeButton = new Button(this);
        closeButton.setText("X");
        closeButton.setTextColor(Color.WHITE);
        closeButton.setTextSize(18);
        closeButton.setBackgroundColor(0xAA9F1D1D);
        closeButton.setOnClickListener(v -> finishCancelled());
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(dp(52), dp(44));
        closeParams.gravity = Gravity.TOP | Gravity.LEFT;
        closeParams.setMargins(dp(16), dp(24), 0, 0);
        root.addView(closeButton, closeParams);

        qualityBar = new LinearLayout(this);
        qualityBar.setOrientation(LinearLayout.HORIZONTAL);
        qualityBar.setGravity(Gravity.CENTER);
        qualityBar.setBackgroundColor(0x66000000);
        FrameLayout.LayoutParams qualityParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(44)
        );
        qualityParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        qualityParams.setMargins(0, dp(24), 0, 0);
        root.addView(qualityBar, qualityParams);
        rebuildQualityButtons();

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setGravity(Gravity.CENTER);
        bottom.setPadding(dp(16), dp(12), dp(16), dp(24));
        bottom.setBackgroundColor(0x66000000);

        statusText = new TextView(this);
        statusText.setTextColor(Color.WHITE);
        statusText.setTextSize(14);
        statusText.setGravity(Gravity.CENTER);
        statusText.setText("Ready");
        bottom.addView(statusText, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        recordButton = new Button(this);
        recordButton.setText("REC");
        recordButton.setTextColor(Color.WHITE);
        recordButton.setTextSize(18);
        recordButton.setBackgroundColor(0xFFD92626);
        recordButton.setOnClickListener(v -> toggleRecording());
        LinearLayout.LayoutParams recordParams = new LinearLayout.LayoutParams(dp(96), dp(56));
        recordParams.setMargins(0, dp(10), 0, 0);
        bottom.addView(recordButton, recordParams);

        FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        bottomParams.gravity = Gravity.BOTTOM;
        root.addView(bottom, bottomParams);

        setContentView(root);
    }

    private void rebuildQualityButtons() {
        qualityBar.removeAllViews();
        addQualityButton("SD", Quality.SD);
        addQualityButton("HD", Quality.HD);
        addQualityButton("FHD", Quality.FHD);
        addQualityButton("UHD", Quality.UHD);
    }

    private void addQualityButton(String label, Quality quality) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(12);
        button.setTextColor(Color.WHITE);
        button.setEnabled(recording == null);
        button.setBackgroundColor(quality == selectedQuality ? 0xAA1E8E5A : 0x66000000);
        button.setOnClickListener(v -> {
            if (recording != null) return;
            selectedQuality = quality;
            rebuildQualityButtons();
            bindCamera();
        });
        qualityBar.addView(button, new LinearLayout.LayoutParams(dp(66), dp(44)));
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

            QualitySelector selector = QualitySelector.from(
                selectedQuality,
                FallbackStrategy.higherQualityOrLowerThan(selectedQuality)
            );
            Recorder recorder = new Recorder.Builder()
                .setQualitySelector(selector)
                .build();
            videoCapture = VideoCapture.withOutput(recorder);

            cameraProvider.unbindAll();
            cameraProvider.bindToLifecycle(
                this,
                CameraSelector.DEFAULT_BACK_CAMERA,
                preview,
                videoCapture
            );
            statusText.setText("Quality: " + qualityName(selectedQuality));
        } catch (Exception ex) {
            finishWithError("Failed to bind camera: " + messageOf(ex));
        }
    }

    private void toggleRecording() {
        if (recording != null) {
            recording.stop();
            recordButton.setEnabled(false);
            statusText.setText("Saving...");
            return;
        }
        if (videoCapture == null) return;
        if (outputFile.exists()) outputFile.delete();

        FileOutputOptions outputOptions = new FileOutputOptions.Builder(outputFile).build();
        PendingRecording pending = videoCapture.getOutput().prepareRecording(this, outputOptions);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            pending = pending.withAudioEnabled();
        }

        recordButton.setText("STOP");
        recordButton.setBackgroundColor(0xFFB01010);
        statusText.setText("Recording...");
        rebuildQualityButtons();

        recording = pending.start(ContextCompat.getMainExecutor(this), event -> {
            if (event instanceof VideoRecordEvent.Finalize) {
                VideoRecordEvent.Finalize finalizeEvent = (VideoRecordEvent.Finalize) event;
                Recording finishedRecording = recording;
                recording = null;
                if (finishedRecording != null) finishedRecording.close();
                if (finalizeEvent.hasError()) {
                    outputFile.delete();
                    finishWithError("Recording failed: " + finalizeEvent.getError());
                } else {
                    finishOk();
                }
            }
        });
    }

    private boolean hasPermissions() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private void finishOk() {
        Intent data = new Intent();
        data.putExtra(EXTRA_OUTPUT_PATH, outputFile.getAbsolutePath());
        data.putExtra(EXTRA_QUALITY, qualityName(selectedQuality));
        setResult(Activity.RESULT_OK, data);
        finish();
    }

    private void finishCancelled() {
        if (recording != null) {
            recording.close();
            recording = null;
        }
        if (outputFile != null) outputFile.delete();
        setResult(Activity.RESULT_CANCELED);
        finish();
    }

    private void finishWithError(String message) {
        Intent data = new Intent();
        data.putExtra("error", message);
        setResult(Activity.RESULT_CANCELED, data);
        finish();
    }

    private Quality qualityFromName(String name) {
        if ("SD".equalsIgnoreCase(name)) return Quality.SD;
        if ("HD".equalsIgnoreCase(name)) return Quality.HD;
        if ("UHD".equalsIgnoreCase(name)) return Quality.UHD;
        return Quality.FHD;
    }

    private String qualityName(Quality quality) {
        if (quality == Quality.SD) return "SD";
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
