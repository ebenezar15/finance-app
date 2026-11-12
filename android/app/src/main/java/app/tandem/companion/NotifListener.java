package app.tandem.companion;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/** Reads notifications from payment apps only (Google Pay, PhonePe, Paytm…) and forwards the money ones. */
public class NotifListener extends NotificationListenerService {
  @Override
  public void onNotificationPosted(StatusBarNotification sbn) {
    if (sbn == null || !MoneyFilter.isPaymentApp(sbn.getPackageName())) return;
    Notification n = sbn.getNotification();
    if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
    Bundle x = n.extras;
    if (x == null) return;
    CharSequence title = x.getCharSequence(Notification.EXTRA_TITLE);
    CharSequence big = x.getCharSequence(Notification.EXTRA_BIG_TEXT);
    CharSequence small = x.getCharSequence(Notification.EXTRA_TEXT);
    String body = big != null && big.length() > 0 ? big.toString() : small != null ? small.toString() : "";
    final String text = ((title != null ? title + ". " : "") + body).trim();
    if (!MoneyFilter.looksLikeMoney(text)) return;
    new Thread(() -> Forwarder.handle(getApplicationContext(), text)).start();
  }
}
