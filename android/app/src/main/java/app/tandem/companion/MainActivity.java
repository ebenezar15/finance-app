package app.tandem.companion;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.text.format.DateUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/**
 * The one screen: connect to Tandem, allow SMS and payment notifications, test, and see status.
 * Built in code (no layout files, no libraries) to keep the app tiny.
 */
public class MainActivity extends Activity {
  private static final int TEAL = Color.rgb(15, 76, 92), INK = Color.rgb(23, 32, 46), MUTED = Color.rgb(92, 103, 118),
      BG = Color.rgb(243, 244, 241), GOOD = Color.rgb(31, 140, 104), WARN = Color.rgb(176, 110, 10);
  private static final int REQ_SMS = 7;

  private final Handler main = new Handler(Looper.getMainLooper());
  private TextView linkState, smsState, notifState, status;
  private EditText linkBox;
  private Button smsBtn, notifBtn, testBtn;

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    getWindow().setStatusBarColor(TEAL);
    ScrollView scroll = new ScrollView(this);
    scroll.setBackgroundColor(BG);
    scroll.setFillViewport(true);
    LinearLayout col = new LinearLayout(this);
    col.setOrientation(LinearLayout.VERTICAL);
    col.setPadding(dp(20), dp(24), dp(20), dp(32));
    scroll.addView(col, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    col.addView(text("Tandem Companion", 26, INK, true));
    col.addView(gap(6));
    col.addView(text("Sends your bank’s “credited” and “debited” messages, and Google Pay, PhonePe and Paytm payment notifications, to your Tandem so the numbers update without typing.", 15, MUTED, false));

    // 1. Connect
    LinearLayout c1 = card(col, "1. Connect to your Tandem");
    linkState = text("", 14, MUTED, false);
    c1.addView(linkState);
    c1.addView(gap(8));
    c1.addView(text("In Tandem, open Settings → Automatic payment capture and tap “Connect the companion app”. Or copy your capture link there and paste it here.", 13, MUTED, false));
    c1.addView(gap(8));
    linkBox = new EditText(this);
    linkBox.setHint("https://…/api/capture?k=…");
    linkBox.setTextSize(13);
    linkBox.setSingleLine(true);
    linkBox.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
    c1.addView(linkBox);
    LinearLayout row = new LinearLayout(this);
    row.setOrientation(LinearLayout.HORIZONTAL);
    row.addView(button("Paste", false, v -> paste()));
    row.addView(hgap(8));
    row.addView(button("Save link", true, v -> saveLink(linkBox.getText().toString())));
    c1.addView(row);

    // 2. SMS
    LinearLayout c2 = card(col, "2. Bank messages (SMS)");
    smsState = text("", 14, MUTED, false);
    c2.addView(smsState);
    c2.addView(gap(8));
    smsBtn = button("Allow reading SMS", true, v -> askSms());
    c2.addView(smsBtn);
    c2.addView(gap(6));
    c2.addView(text("If Android says the setting is restricted: open this app’s App info, tap the ⋮ menu at the top right, choose “Allow restricted settings”, then come back.", 12, MUTED, false));
    c2.addView(button("Open App info", false, v -> openAppInfo()));

    // 3. Notifications
    LinearLayout c3 = card(col, "3. Payment app notifications");
    notifState = text("", 14, MUTED, false);
    c3.addView(notifState);
    c3.addView(gap(8));
    notifBtn = button("Allow notification access", true, v -> openNotifSettings());
    c3.addView(notifBtn);
    c3.addView(gap(6));
    c3.addView(text("Only notifications from payment apps are read: Google Pay, PhonePe, Paytm, BHIM, Amazon Pay, CRED and similar.", 12, MUTED, false));

    // 4. Test + status
    LinearLayout c4 = card(col, "4. Check it works");
    testBtn = button("Send a test to Tandem", true, v -> sendTest());
    c4.addView(testBtn);
    c4.addView(gap(10));
    status = text("", 14, INK, false);
    c4.addView(status);
    c4.addView(gap(8));
    c4.addView(text("Keep this app out of battery saving so it can work in the background.", 12, MUTED, false));
    c4.addView(button("Battery settings", false, v -> openBattery()));

    col.addView(gap(18));
    col.addView(text("Privacy: every message is checked on this phone first. Only ones about money moving are sent, and only to your own Tandem link, where they are encrypted on arrival. One-time passwords and ordinary messages never leave the phone. Nothing is sent anywhere else.", 12, MUTED, false));

    setContentView(scroll);
    handleIntent(getIntent());
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleIntent(intent);
  }

  @Override
  protected void onResume() {
    super.onResume();
    refresh();
  }

  /** "Connect" in Tandem opens tandem-companion://link?u=<capture link>. */
  private void handleIntent(Intent intent) {
    Uri data = intent == null ? null : intent.getData();
    if (data == null || !"tandem-companion".equals(data.getScheme())) return;
    String u = data.getQueryParameter("u");
    if (u != null) saveLink(u);
  }

  private void saveLink(String raw) {
    String link = raw == null ? "" : raw.trim();
    if (!MoneyFilter.validLink(link)) {
      toast("That doesn’t look like a Tandem capture link. Copy it from Settings → Automatic payment capture.");
      return;
    }
    Forwarder.setLink(this, link);
    linkBox.setText("");
    toast("Connected to your Tandem.");
    refresh();
  }

  private void paste() {
    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
    ClipData clip = cm == null ? null : cm.getPrimaryClip();
    if (clip == null || clip.getItemCount() == 0) { toast("Nothing to paste. Copy the link in Tandem first."); return; }
    CharSequence t = clip.getItemAt(0).coerceToText(this);
    linkBox.setText(t == null ? "" : t.toString().trim());
  }

  private boolean hasSms() { return checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED; }

  private boolean hasNotif() {
    String on = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
    return on != null && on.contains(new ComponentName(this, NotifListener.class).flattenToString());
  }

  private void askSms() {
    if (hasSms()) { toast("SMS is already allowed."); return; }
    requestPermissions(new String[] { Manifest.permission.RECEIVE_SMS }, REQ_SMS);
  }

  @Override
  public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
    super.onRequestPermissionsResult(code, perms, results);
    if (code == REQ_SMS && !hasSms()) toast("Not allowed yet. If Android blocked it, use “Allow restricted settings” in App info, then try again.");
    refresh();
  }

  private void open(Intent i) {
    try { startActivity(i); } catch (Exception e) { toast("Couldn’t open that screen. Find it in your phone’s Settings."); }
  }
  private void openNotifSettings() { open(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)); }
  private void openAppInfo() { open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); }
  private void openBattery() { open(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); }

  private void sendTest() {
    if (!MoneyFilter.validLink(Forwarder.link(this))) { toast("Connect to your Tandem first (step 1)."); return; }
    testBtn.setEnabled(false);
    testBtn.setText("Sending…");
    final Context app = getApplicationContext();
    new Thread(() -> {
      // A fresh suffix so the "seen in the last minute" guard never swallows a repeated test.
      Forwarder.enqueue(app, Forwarder.TEST_TEXT + " " + System.currentTimeMillis());
      final boolean ok = Forwarder.flush(app);
      main.post(() -> {
        testBtn.setEnabled(true);
        testBtn.setText("Send a test to Tandem");
        toast(ok ? "Sent. In Tandem, Settings → Automatic payment capture shows it arrived." : Forwarder.lastError(app));
        refresh();
      });
    }).start();
  }

  private void refresh() {
    boolean linked = MoneyFilter.validLink(Forwarder.link(this));
    set(linkState, linked ? "✓ Connected" : "Not connected yet", linked);
    boolean sms = hasSms();
    set(smsState, sms ? "✓ Allowed. Credited and debited messages are picked up as they arrive." : "Not allowed yet", sms);
    smsBtn.setVisibility(sms ? View.GONE : View.VISIBLE);
    boolean notif = hasNotif();
    set(notifState, notif ? "✓ Allowed. Payment app notifications are picked up." : "Not allowed yet", notif);
    notifBtn.setText(notif ? "Notification settings" : "Allow notification access");

    long last = Forwarder.lastSent(this);
    StringBuilder s = new StringBuilder();
    s.append(Forwarder.sent(this)).append(" sent to Tandem so far");
    if (last > 0) s.append("\nLast one: ").append(DateUtils.getRelativeTimeSpanString(last, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS));
    int waiting = Forwarder.waiting(this);
    if (waiting > 0) s.append("\n").append(waiting).append(" waiting to send");
    String err = Forwarder.lastError(this);
    if (err != null && !err.isEmpty()) s.append("\n").append(err);
    status.setText(s.toString());
    if (waiting > 0 && linked) Forwarder.schedule(this);
  }

  /* ───────────── small view helpers ───────────── */

  private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
  private void toast(String m) { Toast.makeText(this, m, Toast.LENGTH_LONG).show(); }
  private void set(TextView t, String s, boolean good) { t.setText(s); t.setTextColor(good ? GOOD : WARN); t.setTypeface(Typeface.DEFAULT_BOLD); }

  private TextView text(String s, int sp, int colour, boolean bold) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextSize(sp);
    t.setTextColor(colour);
    t.setLineSpacing(0, 1.15f);
    if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
    return t;
  }

  private View gap(int h) { View v = new View(this); v.setLayoutParams(new LinearLayout.LayoutParams(1, dp(h))); return v; }
  private View hgap(int w) { View v = new View(this); v.setLayoutParams(new LinearLayout.LayoutParams(dp(w), 1)); return v; }

  private LinearLayout card(LinearLayout parent, String title) {
    LinearLayout c = new LinearLayout(this);
    c.setOrientation(LinearLayout.VERTICAL);
    c.setPadding(dp(16), dp(16), dp(16), dp(16));
    GradientDrawable bg = new GradientDrawable();
    bg.setColor(Color.WHITE);
    bg.setCornerRadius(dp(18));
    bg.setStroke(dp(1), Color.rgb(221, 225, 219));
    c.setBackground(bg);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    lp.topMargin = dp(16);
    parent.addView(c, lp);
    c.addView(text(title, 17, INK, true));
    c.addView(gap(8));
    return c;
  }

  private Button button(String label, boolean primary, View.OnClickListener on) {
    Button b = new Button(this);
    b.setText(label);
    b.setAllCaps(false);
    b.setTextSize(15);
    b.setTextColor(primary ? Color.WHITE : INK);
    b.setGravity(Gravity.CENTER);
    b.setPadding(dp(18), dp(10), dp(18), dp(10));
    b.setMinHeight(dp(46));
    b.setMinimumHeight(dp(46));
    b.setStateListAnimator(null);
    GradientDrawable bg = new GradientDrawable();
    bg.setColor(primary ? TEAL : Color.rgb(234, 237, 232));
    bg.setCornerRadius(dp(12));
    b.setBackground(bg);
    b.setOnClickListener(on);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    lp.topMargin = dp(6);
    b.setLayoutParams(lp);
    return b;
  }
}
