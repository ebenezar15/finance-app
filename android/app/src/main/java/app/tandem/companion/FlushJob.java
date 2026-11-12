package app.tandem.companion;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Runs when the phone has a connection again and sends whatever was waiting. */
public class FlushJob extends JobService {
  @Override
  public boolean onStartJob(final JobParameters params) {
    new Thread(() -> {
      boolean done = Forwarder.flush(getApplicationContext());
      jobFinished(params, !done);
    }).start();
    return true;
  }

  @Override
  public boolean onStopJob(JobParameters params) { return true; }
}
