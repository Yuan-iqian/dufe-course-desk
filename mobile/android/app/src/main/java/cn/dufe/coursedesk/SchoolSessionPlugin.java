package cn.dufe.coursedesk;

import android.app.Dialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.json.JSONObject;

@CapacitorPlugin(name = "SchoolSession")
public class SchoolSessionPlugin extends Plugin {
    private static final String ORIGIN = "https://ginkgostu.dufe.edu.cn";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, PluginCall> pending = new HashMap<>();
    private WebView school;
    private Dialog dialog;
    private boolean loaded;
    private boolean clearing;
    private String reader;
    private String loginForm;
    private int credentialRevision;
    private CampusCardWindow campusCard;
    private SchoolLoginMemory loginMemory;
    private SchoolLoginMemory memory() {
        if(loginMemory==null)loginMemory=new SchoolLoginMemory(getContext());
        loginMemory.restore();return loginMemory;
    }

    @PluginMethod
    public void credentialsStatus(PluginCall call) {
        handler.post(() -> call.resolve(new JSObject().put("saved", memory().credentialsSaved())));
    }

    @PluginMethod
    public void saveCredentials(PluginCall call) {
        String account = call.getString("account", "").trim(), password = call.getString("password", "");
        if (account.isEmpty() || account.length() > 128 || password.isEmpty() || password.length() > 256) {
            call.reject("请输入学校账号和密码"); return;
        }
        handler.post(() -> {
            try { memory().saveCredentials(account, password); credentialRevision++; call.resolve(); }
            catch (Exception error) { call.reject("系统加密保存失败，请解锁设备后重试"); }
        });
    }

    @PluginMethod
    public void clearCredentials(PluginCall call) {
        handler.post(() -> {
            credentialRevision++;
            if (memory().clearCredentials()) call.resolve(); else call.reject("清除失败，请重试");
        });
    }

    private boolean onLoginPage(WebView view) {
        if (view == null || view.getUrl() == null) return false;
        Uri url = Uri.parse(view.getUrl());
        return allowedSchool(view.getUrl()) && "sso.dufe.edu.cn".equals(url.getHost()) &&
            "/auth/oauth/authorize".equals(url.getPath());
    }

    private void fillSaved(PluginCall call, WebView view, Dialog owner, int revision, int attempt) {
        if (clearing || view != school || dialog != owner || !owner.isShowing() || revision != credentialRevision) {
            call.reject("学校窗口已关闭或保存的账号已更新"); return;
        }
        if (loaded && onLoginPage(view)) {
            try {
                view.evaluateJavascript(loginForm + "(" + memory().readCredentials() + ")", value -> {
                    if ("true".equals(value)) call.resolve();
                    else if (attempt < 32) handler.postDelayed(() -> fillSaved(call, view, owner, revision, attempt + 1), 250);
                    else call.reject("未找到学校账号登录表单，请核对学校页面");
                });
            } catch (Exception error) { call.reject("无法读取已保存账号，请重新保存"); }
        } else if (attempt >= 32 || (loaded && exactSchool() && attempt >= 8)) {
            call.reject("未找到学校账号登录表单，请核对学校页面");
        } else {
            handler.postDelayed(() -> fillSaved(call, view, owner, revision, attempt + 1), 250);
        }
    }

    @PluginMethod
    public void reconnect(PluginCall call) {
        handler.post(() -> {
            if(clearing || (dialog!=null && dialog.isShowing())){call.resolve(new JSObject().put("started",false));return;}
            try { ensureSchool();loaded=false;school.loadUrl(ORIGIN+"/");call.resolve(new JSObject().put("started",true)); }
            catch(Exception error){call.resolve(new JSObject().put("started",false));}
        });
    }

    @PluginMethod
    public void openCampusCard(PluginCall call) {
        handler.post(() -> {
            if (clearing) { call.reject("正在退出学校，请稍后重试"); return; }
            try {
                if (campusCard == null) campusCard = new CampusCardWindow(getActivity(), memory(), () -> { if(!clearing)notifyListeners("schoolSessionChanged",new JSObject()); });
                campusCard.open(); call.resolve();
            } catch (Exception error) { call.reject("校园码暂时无法打开，请稍后重试"); }
        });
    }

    @PluginMethod
    public void closeCampusCard(PluginCall call) {
        handler.post(() -> { if (campusCard != null) campusCard.close(); call.resolve(); });
    }

    private boolean allowedSchool(String value) {
        Uri url = Uri.parse(value);
        String host = url.getHost();
        return "https".equals(url.getScheme()) && host != null &&
            (host.equals("dufe.edu.cn") || host.endsWith(".dufe.edu.cn")) &&
            url.getUserInfo() == null && (url.getPort() == -1 || url.getPort() == 443);
    }

    private boolean exactSchool() {
        if (school == null || school.getUrl() == null) return false;
        Uri url = Uri.parse(school.getUrl());
        return "https".equals(url.getScheme()) && "ginkgostu.dufe.edu.cn".equals(url.getHost()) &&
            (url.getPort() == -1 || url.getPort() == 443);
    }

    private void ensureSchool() throws Exception {
        if(clearing)throw new Exception("正在退出学校，请稍后重试");
        memory();
        if (school != null) return;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            throw new Exception("请更新 Android System WebView 后使用学校登录");
        }
        try (java.io.InputStream stream = getContext().getAssets().open("public/school-request.js")) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192]; int count;
            while ((count = stream.read(buffer)) != -1) bytes.write(buffer, 0, count);
            reader = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        }
        try (java.io.InputStream stream = getContext().getAssets().open("public/school-login-form.js")) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[4096]; int count;
            while ((count = stream.read(buffer)) != -1) bytes.write(buffer, 0, count);
            loginForm = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        }
        school = new WebView(getActivity());
        school.getSettings().setJavaScriptEnabled(true);
        school.getSettings().setDomStorageEnabled(true);
        school.getSettings().setAllowFileAccess(false);
        school.getSettings().setAllowContentAccess(false);
        school.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        WebViewCompat.addWebMessageListener(school, "CourseSchoolResult", Collections.singleton(ORIGIN),
            (view, message, origin, mainFrame, reply) -> {
                if (!mainFrame || !ORIGIN.equals(origin.toString()) || !exactSchool()) return;
                try {
                    JSONObject result = new JSONObject(message.getData());
                    PluginCall call = pending.remove(result.getString("requestId"));
                    if (call != null) call.resolve(new JSObject(result.getJSONObject("result").toString()));
                } catch (Exception ignored) { /* Unknown messages never resolve a pending request. */ }
            });
        school.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !allowedSchool(request.getUrl().toString());
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) { loaded = false; }
            @Override public void onPageFinished(WebView view, String url) {
                loaded = true;
                if (exactSchool()) notifyListeners("schoolPageReady", new JSObject());
                CookieManager.getInstance().flush();
                if(!clearing)memory().save();
            }
        });
        school.loadUrl(ORIGIN + "/");
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url", ORIGIN);
        if (!allowedSchool(url)) { call.reject("只能打开学校的 HTTPS 页面"); return; }
        handler.post(() -> {
            try {
                ensureSchool();
                boolean fill = Boolean.TRUE.equals(call.getBoolean("fillSaved"));
                if (fill && !memory().credentialsSaved()) { call.reject("请先保存学校账号"); return; }
                if (dialog != null && dialog.isShowing()) {
                    if (fill) fillSaved(call, school, dialog, credentialRevision, 0); else call.resolve();
                    return;
                }
                if (school.getParent() != null) ((ViewGroup) school.getParent()).removeView(school);
                dialog = new Dialog(getActivity(), android.R.style.Theme_DeviceDefault_Light_NoActionBar);
                LinearLayout layout = new LinearLayout(getActivity());
                layout.setOrientation(LinearLayout.VERTICAL);
                TextView label = new TextView(getActivity());
                label.setText("学校官方页面 · dufe.edu.cn");
                label.setPadding(24, 20, 24, 12);
                Button close = new Button(getActivity());
                close.setText("返回东财课历");
                close.setOnClickListener(view -> dialog.dismiss());
                layout.addView(label);
                layout.addView(close);
                layout.addView(school, new LinearLayout.LayoutParams(-1, 0, 1));
                dialog.setContentView(layout);
                dialog.setOnDismissListener(value -> {
                    if (school != null && school.getParent() != null) ((ViewGroup) school.getParent()).removeView(school);
                    if (!clearing && exactSchool()) notifyListeners("schoolPageReady", new JSObject());
                });
                dialog.show();
                dialog.getWindow().setLayout(-1, -1);
                if (!url.equals(ORIGIN) && !url.equals(ORIGIN + "/")) school.loadUrl(url);
                if (fill) {
                    if (!onLoginPage(school) && loaded) { loaded = false; school.loadUrl(ORIGIN + "/"); }
                    fillSaved(call, school, dialog, credentialRevision, 0);
                } else call.resolve();
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }

    private boolean allowedRequest(String path, String method) {
        if ("GET".equals(method)) return path.equals("/student/currentDate") || path.equals("/student/queryCourseList") || path.equals("/student/HomeworkList");
        if (!"POST".equals(method)) return false;
        return path.equals("/student/signIn/getStuSignInList") || path.equals("/student/signIn/getSignInInfo") ||
            path.equals("/student/signIn/getOnlineSignInInfo") || path.equals("/student/getWeekTimePaper") || path.equals("/student/exercise/getExerciseList");
    }

    @PluginMethod
    public void request(PluginCall call) {
        String path = call.getString("path", ""), method = call.getString("method", "");
        if (!allowedRequest(path, method)) { call.reject("不支持的学校读取操作"); return; }
        handler.post(() -> {
            try {
                ensureSchool();
                String requestId = UUID.randomUUID().toString();
                pending.put(requestId, call);
                handler.postDelayed(() -> {
                    PluginCall waiting = pending.remove(requestId);
                    if (waiting != null) waiting.resolve(new JSObject().put("error", "network"));
                }, 20000);
                runRequest(requestId, call);
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }

    private void runRequest(String requestId, PluginCall call) {
        if (!pending.containsKey(requestId)) return;
        if (!loaded) { handler.postDelayed(() -> runRequest(requestId, call), 250); return; }
        if (!exactSchool()) {
            if (onLoginPage(school)) {
                school.evaluateJavascript(loginForm + "(null)", value -> {
                    PluginCall waiting = pending.remove(requestId);
                    if (waiting != null) waiting.resolve(new JSObject().put("error", "true".equals(value) ? "auth" : "network"));
                });
            } else {
                pending.remove(requestId);
                call.resolve(new JSObject().put("error", "network"));
            }
            return;
        }
        String quoted = JSONObject.quote(requestId);
        String script = reader + "(" + call.getData().toString() + ").then(result => CourseSchoolResult.postMessage(JSON.stringify({requestId:" + quoted + ",result})))";
        school.evaluateJavascript(script, ignored -> {});
    }

    @PluginMethod
    public void logout(PluginCall call) {
        handler.post(() -> {
            clearing = true;
            final boolean forgotten=memory().forget();
            if (campusCard != null) campusCard.close();
            for (PluginCall waiting : pending.values()) waiting.resolve(new JSObject().put("error", "auth"));
            pending.clear();
            if (dialog != null) dialog.dismiss();
            if (school != null) { school.destroy(); school = null; }
            loaded = false;
            WebStorage.getInstance().deleteAllData();
            CookieManager.getInstance().removeAllCookies(value -> {
                CookieManager.getInstance().flush();memory().resume();clearing = false;
                if(forgotten)call.resolve();else call.reject("登录记忆清理失败，请再次退出账号");
            });
        });
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String value = call.getString("url", "");
        Uri url = Uri.parse(value);
        String host = url.getHost();
        boolean validHost = host != null && (host.equals("mp.weixin.qq.com") || host.equals("dufe.edu.cn") || host.endsWith(".dufe.edu.cn"));
        if (!validHost || url.getUserInfo() != null || !("https".equals(url.getScheme()) || "http".equals(url.getScheme()))) {
            call.reject("无效的学校来源地址"); return;
        }
        try { getActivity().startActivity(new Intent(Intent.ACTION_VIEW, url)); call.resolve(); }
        catch (android.content.ActivityNotFoundException error) { call.reject("没有可打开来源页面的浏览器"); }
    }

    @PluginMethod
    public void settings(PluginCall call) {
        Intent intent;
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        }
        try { getActivity().startActivity(intent); call.resolve(); }
        catch (android.content.ActivityNotFoundException error) { call.reject("请到手机设置中开启本应用通知"); }
    }

    @Override protected void handleOnPause() { if(loginMemory!=null)loginMemory.save();if (campusCard != null) campusCard.suspend(); }
    @Override protected void handleOnResume() { if (campusCard != null) campusCard.resume(); }
    @Override protected void handleOnDestroy() {
        if(loginMemory!=null)loginMemory.save();
        clearing = true;
        if (campusCard != null) campusCard.close();
        handler.removeCallbacksAndMessages(null);
        if (dialog != null) dialog.dismiss();
        if (school != null) school.destroy();
    }
}
