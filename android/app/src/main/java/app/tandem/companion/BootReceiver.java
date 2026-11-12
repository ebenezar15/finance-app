package app.tandem.companion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a restart, send anything that was still waiting. */
public class BootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (Forwarder.waiting(context) > 0) Forwarder.schedule(context);
  }
}
