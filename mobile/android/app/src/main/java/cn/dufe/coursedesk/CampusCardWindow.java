package cn.dufe.coursedesk;

import android.app.Activity;
import android.app.Dialog;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/** An official school page, deliberately separate from the course reader WebView. */
final class CampusCardWindow {
    static final String ENTRY = "https://sso.dufe.edu.cn/app.php/open_apps/person_card/index/index";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Activity activity;
    private final SchoolLoginMemory memory;
    private final Runnable onClose;
    private Dialog dialog;
    private WebView web;
    private TextView status;
    private boolean failed;
    private boolean suspended;
    private final Runnable timeout = () -> fail();

    CampusCardWindow(Activity activity, SchoolLoginMemory memory, Runnable onClose) { this.activity = activity; this.memory=memory; this.onClose=onClose; }

    private boolean allowed(String value) {
        Uri u = Uri.parse(value);
        String h = u.getHost();
        return "https".equals(u.getScheme()) && h != null &&
            (h.equals("dufe.edu.cn") || h.endsWith(".dufe.edu.cn")) &&
            u.getUserInfo() == null && (u.getPort() == -1 || u.getPort() == 443);
    }

    void open() {
        if (dialog != null && dialog.isShowing()) return;
        dialog = new Dialog(activity, android.R.style.Theme_DeviceDefault_Light_NoActionBar);
        LinearLayout layout = new LinearLayout(activity);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(android.graphics.Color.WHITE);
        TextView title = new TextView(activity);
        title.setText("我的校园码 · 学校官方页面");
        title.setTextColor(android.graphics.Color.rgb(24, 42, 64));
        title.setPadding(24, 20, 24, 12);
        layout.addView(title);
        LinearLayout toolbar = new LinearLayout(activity);
        Button back = new Button(activity);
        back.setText("返回应用"); back.setOnClickListener(v -> close());
        Button refresh = new Button(activity);
        refresh.setText("刷新校园码"); refresh.setOnClickListener(v -> reload());
        toolbar.addView(back, new LinearLayout.LayoutParams(0, -2, 1));
        toolbar.addView(refresh, new LinearLayout.LayoutParams(0, -2, 1));
        layout.addView(toolbar);
        FrameLayout stage = new FrameLayout(activity);
        web = new WebView(activity);
        web.setBackgroundColor(android.graphics.Color.WHITE);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        CookieManager.getInstance().setAcceptCookie(true);
        status = new TextView(activity);
        status.setTextColor(android.graphics.Color.rgb(85, 101, 121));
        status.setGravity(android.view.Gravity.CENTER);
        status.setPadding(32, 32, 32, 32);
        status.setBackgroundColor(android.graphics.Color.WHITE);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        stage.addView(web, new FrameLayout.LayoutParams(-1, -1));
        stage.addView(status, new FrameLayout.LayoutParams(-1, -1));
        layout.addView(stage, new LinearLayout.LayoutParams(-1, 0, 1));
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (allowed(req.getUrl().toString())) return false;
                if (view == web && req.isForMainFrame()) fail();
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) { if (view == web) loading(); }
            @Override public void onPageFinished(WebView view, String url) {
                if (view != web || failed || suspended) return;
                handler.removeCallbacks(timeout);
                status.setVisibility(View.GONE);
                web.setVisibility(View.VISIBLE);
                CookieManager.getInstance().flush();
                memory.save();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
                if (view == web && req.isForMainFrame()) fail();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest req, WebResourceResponse response) {
                if (view == web && req.isForMainFrame() && response.getStatusCode() >= 400) fail();
            }
        });
        dialog.setContentView(layout);
        dialog.setOnDismissListener(value -> dispose());
        dialog.show();
        dialog.getWindow().setLayout(-1, -1);
        reload();
    }
    private void loading() {
        if (web == null) return;
        failed = false;
        web.setVisibility(View.INVISIBLE);
        status.setText("正在连接学校…"); status.setVisibility(View.VISIBLE);
        handler.removeCallbacks(timeout); handler.postDelayed(timeout, 25000);
    }
    private void fail() {
        if (web == null || suspended) return;
        failed = true;
        handler.removeCallbacks(timeout);
        web.stopLoading(); web.setVisibility(View.INVISIBLE);
        status.setText("学校页面暂时无法打开\n请检查网络后点击上方刷新"); status.setVisibility(View.VISIBLE);
    }
    private void reload() {
        if (web == null) return;
        loading(); web.loadUrl(ENTRY);
    }
    void suspend() {
        if (web == null) return;
        memory.save();
        suspended = true;
        handler.removeCallbacks(timeout);
        web.stopLoading(); web.setVisibility(View.INVISIBLE); web.onPause();
        status.setText("返回后重新连接学校"); status.setVisibility(View.VISIBLE);
    }
    void resume() {
        if (!suspended || web == null) return;
        suspended = false; web.onResume(); reload();
    }
    private void dispose() {
        boolean wasOpen = web != null;
        if(wasOpen)memory.save();
        handler.removeCallbacksAndMessages(null);
        if (web != null) { web.stopLoading(); web.destroy(); web = null; }
        dialog = null; suspended = false;
        if(wasOpen)onClose.run();
    }
    void close() { if (dialog != null) dialog.dismiss(); else dispose(); }
}
