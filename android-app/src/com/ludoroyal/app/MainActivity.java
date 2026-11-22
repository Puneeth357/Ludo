package com.ludoroyal.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final String LIVE_URL = "https://ludo-a9xw.onrender.com";
    private static final String OFFLINE_URL = "file:///android_asset/index.html";

    private WebView webView;
    private LinearLayout splashOverlay;
    private TextView splashStatus;
    private boolean pageLoaded = false;
    private boolean usingOffline = false;
    private long lastBackPress = 0L;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        applyImmersiveMode();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0A245E"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0A245E"));
        configureWebView(webView);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        splashOverlay = buildSplashOverlay();
        root.addView(splashOverlay, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);
        loadInitialUrl(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && data.toString().startsWith(LIVE_URL)) {
            usingOffline = false;
            webView.loadUrl(data.toString());
        }
    }

    private void loadInitialUrl(Intent intent) {
        String targetUrl = LIVE_URL;
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && data.toString().startsWith(LIVE_URL)) {
            targetUrl = data.toString();
        }

        if (isNetworkAvailable()) {
            usingOffline = false;
            splashStatus.setText("Connecting to LudoWars...");
            webView.loadUrl(targetUrl);
        } else {
            switchToOffline();
        }
    }

    private void switchToOffline() {
        if (usingOffline) return;
        usingOffline = true;
        splashStatus.setText("Loading Offline Mode...");
        webView.stopLoading();
        webView.loadUrl(OFFLINE_URL);
    }

    private LinearLayout buildSplashOverlay() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.parseColor("#0A245E"));
        int pad = dp(28);
        box.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("LUDO WARS");
        title.setTextColor(Color.parseColor("#FFD84D"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 34);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        box.addView(title);

        ProgressBar spinner = new ProgressBar(this);
        LinearLayout.LayoutParams spLp = new LinearLayout.LayoutParams(dp(44), dp(44));
        spLp.topMargin = dp(22);
        spLp.bottomMargin = dp(14);
        box.addView(spinner, spLp);

        splashStatus = new TextView(this);
        splashStatus.setText("Loading...");
        splashStatus.setTextColor(Color.parseColor("#CFE2FF"));
        splashStatus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        splashStatus.setGravity(Gravity.CENTER);
        box.addView(splashStatus);

        Button offlineBtn = new Button(this);
        offlineBtn.setText("Play Offline Now");
        offlineBtn.setAllCaps(false);
        offlineBtn.setTextColor(Color.parseColor("#17254D"));
        offlineBtn.setTypeface(Typeface.DEFAULT_BOLD);
        offlineBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#FFD84D"));
        bg.setCornerRadius(dp(24));
        offlineBtn.setBackground(bg);
        offlineBtn.setPadding(dp(22), dp(10), dp(22), dp(10));
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        btnLp.topMargin = dp(28);
        offlineBtn.setOnClickListener(v -> switchToOffline());
        box.addView(offlineBtn, btnLp);

        return box;
    }

    private void configureWebView(WebView wv) {
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        wv.setWebChromeClient(new WebChromeClient());
        wv.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageLoaded = true;
                handler.postDelayed(() -> {
                    if (splashOverlay != null) {
                        splashOverlay.setVisibility(View.GONE);
                    }
                }, 180);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request != null && request.isForMainFrame() && !usingOffline) {
                    handler.post(() -> switchToOffline());
                }
            }
        });
    }

    private boolean isNetworkAvailable() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            NetworkInfo active = cm.getActiveNetworkInfo();
            return active != null && active.isConnected();
        } catch (Exception e) {
            return false;
        }
    }

    private int dp(int val) {
        return (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, val, getResources().getDisplayMetrics()
        );
    }

    private void applyImmersiveMode() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                getWindow().getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                );
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersiveMode();
    }

    @Override
    public void onBackPressed() {
        long now = System.currentTimeMillis();
        if (now - lastBackPress < 1800L) {
            super.onBackPressed();
        } else {
            lastBackPress = now;
            Toast.makeText(this, "Press back again to exit", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        applyImmersiveMode();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
