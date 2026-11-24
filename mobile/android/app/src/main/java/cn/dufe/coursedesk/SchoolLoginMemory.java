package cn.dufe.coursedesk;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.CookieManager;
import androidx.webkit.CookieManagerCompat;
import androidx.webkit.WebViewFeature;
import java.security.KeyStore;
import java.util.HashSet;
import java.util.Locale;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

/** Session-only school cookies in an Android Keystore protected local vault. */
final class SchoolLoginMemory {
    private static final String KEY = "course-desk-school-login-v1";
    private static final String[] URLS = {
        "https://sso.dufe.edu.cn/", "https://sso.dufe.edu.cn/auth/oauth/authorize",
        "https://sso.dufe.edu.cn/app.php/open_apps/person_card/index/index", "https://ginkgostu.dufe.edu.cn/"
    };
    private final SharedPreferences prefs;
    private boolean restored;
    private boolean paused;
    SchoolLoginMemory(Context context) { prefs = context.getSharedPreferences("school-login-vault", Context.MODE_PRIVATE); }
    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (!ks.containsAlias(KEY)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) ks.getKey(KEY, null);
    }
    boolean credentialsSaved() { return prefs.contains("credentials"); }

    void saveCredentials(String account, String password) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] data = new JSONObject().put("account", account).put("password", password)
            .toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
        String encrypted = new JSONObject()
            .put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .put("data", Base64.encodeToString(cipher.doFinal(data), Base64.NO_WRAP)).toString();
        if (!prefs.edit().putString("credentials", encrypted).commit()) throw new IllegalStateException();
    }

    JSONObject readCredentials() throws Exception {
        JSONObject envelope = new JSONObject(prefs.getString("credentials", "{}"));
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        byte[] iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP);
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        byte[] data = cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP));
        return new JSONObject(new String(data, java.nio.charset.StandardCharsets.UTF_8));
    }

    boolean clearCredentials() { return prefs.edit().remove("credentials").commit(); }

    private boolean sessionOnly(String value) {
        String lower = value.toLowerCase(Locale.ROOT);
        return !lower.matches("(?s).*;\\s*(expires|max-age)\\s*=.*") && !value.contains("\r") && !value.contains("\n");
    }
    private String identity(String value) {
        String[] fields = value.split(";");
        String first = fields[0];
        String result = first.substring(0, first.indexOf('='));
        for (int i=1;i<fields.length;i++) {
            String f=fields[i].trim().toLowerCase(Locale.ROOT);
            if(f.startsWith("domain=")||f.startsWith("path="))result += ";"+f;
        }
        return result;
    }
    void restore() {
        if (restored || paused) return;
        restored = true;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.GET_COOKIE_INFO)) return;
        try {
            String saved=prefs.getString("sealed",null); if(saved==null)return;
            JSONObject envelope=new JSONObject(saved);
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(envelope.getString("iv"),Base64.NO_WRAP)));
            JSONArray rows=new JSONArray(new String(cipher.doFinal(Base64.decode(envelope.getString("data"),Base64.NO_WRAP)),java.nio.charset.StandardCharsets.UTF_8));
            CookieManager cm=CookieManager.getInstance();
            for(int i=0;i<Math.min(rows.length(),200);i++){
                JSONObject row=rows.getJSONObject(i);String url=row.getString("url"),value=row.getString("cookie");
                if(!java.util.Arrays.asList(URLS).contains(url)||!sessionOnly(value))continue;
                boolean exists=false;
                for(String live:CookieManagerCompat.getCookieInfo(cm,url))if(identity(live).equals(identity(value))){exists=true;break;}
                if(!exists)cm.setCookie(url,value);
            }
            cm.flush();
        } catch(Exception ignored) { prefs.edit().remove("sealed").commit(); }
    }
    void save() {
        if (!restored || paused) return;
        CookieManager cm=CookieManager.getInstance();cm.flush();
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.GET_COOKIE_INFO))return;
        try {
            JSONArray rows=new JSONArray();HashSet<String> seen=new HashSet<>();
            for(String url:URLS)for(String cookie:CookieManagerCompat.getCookieInfo(cm,url)){
                if(sessionOnly(cookie)&&seen.add(url+"\n"+identity(cookie)))rows.put(new JSONObject().put("url",url).put("cookie",cookie));
            }
            if(rows.length()==0){prefs.edit().remove("sealed").commit();return;}
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
            String data=Base64.encodeToString(cipher.doFinal(rows.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)),Base64.NO_WRAP);
            String envelope=new JSONObject().put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).put("data",data).toString();
            prefs.edit().putString("sealed",envelope).commit();
        } catch(Exception ignored) { /* Native cookie storage remains available; never fall back to plaintext. */ }
    }
    boolean forget() {
        paused=true;restored=true;
        boolean cleared=prefs.edit().clear().commit();
        try {
            KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);ks.deleteEntry(KEY);
            return true; // Old encrypted data cannot be restored even if a disk write failed.
        } catch(Exception ignored) { return cleared; }
    }
    void resume() { paused=false; }
}
