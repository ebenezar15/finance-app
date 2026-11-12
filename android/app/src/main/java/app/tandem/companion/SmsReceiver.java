package app.tandem.companion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

/** Reads each incoming SMS on the phone and forwards only the ones about money. */
public class SmsReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null || !Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
    final StringBuilder body = new StringBuilder();
    try {
      SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
      if (parts == null) return;
      for (SmsMessage p : parts) if (p != null && p.getMessageBody() != null) body.append(p.getMessageBody());
    } catch (Exception e) {
      return;
    }
    final String text = body.toString();
    if (!MoneyFilter.looksLikeMoney(text)) return;
    final Context app = context.getApplicationContext();
    final PendingResult pending = goAsync();
    new Thread(() -> {
      try { Forwarder.handle(app, text); } finally { pending.finish(); }
    }).start();
  }
}
