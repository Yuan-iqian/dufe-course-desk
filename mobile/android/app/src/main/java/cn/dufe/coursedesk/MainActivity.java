package cn.dufe.coursedesk;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SchoolSessionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
