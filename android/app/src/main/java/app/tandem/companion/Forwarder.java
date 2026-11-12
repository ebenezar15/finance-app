package app.tandem.companion;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Keeps a small queue of money messages on the phone and posts them to the person's Tandem
 * capture link. If the phone is offline they wait and go out when it's back.
 */
public final class Forwarder {
  private Forwarder() {}

  static final String PREFS = "tandem";
  static final String K_LINK = "link", K_QUEUE = "queue", K_SENT = "sent", K_LAST = "lastSent", K_ERR = "lastError", K_SEEN = "lastSeen", K_SEEN_AT = "lastSeenAt";
  static final int MAX_QUEUE = 200;
  static final int JOB_ID = 4711;
  public static final String TEST_TEXT = "TANDEM-TEST You paid 1.00 to Test";

  static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

  public static String link(Context c) { return prefs(c).getString(K_LINK, ""); }
  public static void setLink(Context c, String link) { prefs(c).edit().putString(K_LINK, link == null ? "" : link.trim()).remove(K_ERR).apply(); }
  public static int waiting(Context c) { try { return new JSONArray(prefs(c).getString(K_QUEUE, "[]")).length(); } catch (Exception e) { return 0; } }
  public static int sent(Context c) { return prefs(c).getInt(K_SENT, 0); }
  public static long lastSent(Context c) { return prefs(c).getLong(K_LAST, 0); }
  public static String lastError(Context c) { return prefs(c).getString(K_ERR, ""); }

  /** Adds a message unless it's the same text seen in the last minute (apps often notify twice). */
  public static synchronized boolean enqueue(Context c, String text) {
    String t = MoneyFilter.tidy(text);
    if (t.isEmpty() || !MoneyFilter.validLink(link(c))) return false;
    SharedPreferences p = prefs(c);
    long now = System.currentTimeMillis();
    if (t.equals(p.getString(K_SEEN, "")) && now - p.getLong(K_SEEN_AT, 0) < 60_000) return false;
    try {
      JSONArray q = new JSONArray(p.getString(K_QUEUE, "[]"));
      q.put(new JSONObject().put("t", t).put("at", now));
      while (q.length() > MAX_QUEUE) q.remove(0);
      p.edit().putString(K_QUEUE, q.toString()).putString(K_SEEN, t).putLong(K_SEEN_AT, now).apply();
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  /** Sends everything waiting. Returns true when the queue is empty afterwards. Call off the main thread. */
  public static synchronized boolean flush(Context c) {
    SharedPreferences p = prefs(c);
    String link = link(c);
    if (!MoneyFilter.validLink(link)) return true;
    try {
      JSONArray q = new JSONArray(p.getString(K_QUEUE, "[]"));
      int sent = 0;
      String error = "";
      while (q.length() > 0) {
        JSONObject m = q.getJSONObject(0);
        int code = post(link + "&at=" + m.optLong("at"), m.optString("t"));
        if (code >= 200 && code < 300) { q.remove(0); sent++; continue; }
        if (code == 404) { error = "This link is no longer active. Get the current one from Tandem."; break; }
        if (code == 429) { error = "Too many messages at once. Trying again later."; break; }
        error = code < 0 ? "No connection. Waiting to send." : "Tandem’s server answered " + code + ". Trying again later.";
        break;
      }
      SharedPreferences.Editor e = p.edit().putString(K_QUEUE, q.toString()).putString(K_ERR, error);
      if (sent > 0) e.putInt(K_SENT, p.getInt(K_SENT, 0) + sent).putLong(K_LAST, System.currentTimeMillis());
      e.apply();
      return q.length() == 0;
    } catch (Exception e) {
      p.edit().putString(K_ERR, "Couldn’t send. Trying again later.").apply();
      return false;
    }
  }

  private static int post(String url, String body) {
    HttpURLConnection h = null;
    try {
      h = (HttpURLConnection) new URL(url).openConnection();
      h.setRequestMethod("POST");
      h.setConnectTimeout(8000);
      h.setReadTimeout(8000);
      h.setDoOutput(true);
      h.setRequestProperty("Content-Type", "text/plain; charset=utf-8");
      h.setRequestProperty("User-Agent", "TandemCompanion/1.0");
      byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
      h.setFixedLengthStreamingMode(bytes.length);
      try (OutputStream o = h.getOutputStream()) { o.write(bytes); }
      return h.getResponseCode();
    } catch (Exception e) {
      return -1;
    } finally {
      if (h != null) h.disconnect();
    }
  }

  /** Asks Android to run FlushJob as soon as there's a connection; survives restarts. */
  public static void schedule(Context c) {
    try {
      JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
      if (js == null) return;
      js.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(c, FlushJob.class))
          .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
          .setPersisted(true)
          .setBackoffCriteria(60_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
          .build());
    } catch (Exception ignored) { /* the next message will try again */ }
  }

  /** A money message arrived: queue it, try to send straight away, and leave a job as the safety net. */
  public static void handle(Context c, String text) {
    if (!MoneyFilter.looksLikeMoney(text)) return;
    if (!enqueue(c, text)) return;
    if (!flush(c)) schedule(c);
  }
}
