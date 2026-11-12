package app.tandem.companion;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MoneyFilterTest {
  @Test public void forwardsCreditedAndDebitedMessages() {
    String[] yes = {
      "Dear UPI user A/C X1234 debited by 250.0 on date 12Nov26 trf to RAMESH K Refno 431234567890. If not u? call 1800111109. -SBI",
      "Sent Rs.180.00 From HDFC Bank A/C *4321 To CITY CABS On 12/11/26 Ref 431211112222 Not You? Call 18002586161",
      "Rs 5,000.00 credited to a/c XX9876 on 12-11-26 by a/c linked to VPA arun@okaxis (UPI Ref No 431255556666).",
      "INR 1,249.50 spent on ICICI Bank Card XX4321 on 12-Nov-26 at FRESH MART. Avl Lmt: INR 85,000.",
      "Your a/c no. XX1234 is credited by Rs.48,000.00 on 01-11-26 by NEFT SALARY (Ref no 000123456).",
      "Rs.2000 withdrawn from A/c XX1234 at ATM on 12Nov26. Avl bal Rs.15,320.50",
      "You paid ₹120.00 to Uber India",
      "PhonePe. Paid ₹640 to Fresh Mart",
      "You received ₹2,000 from Arun Kumar",
      "USD 42.10 charged to your card ending 9921 at AMAZON",
    };
    for (String s : yes) assertTrue(s, MoneyFilter.looksLikeMoney(s));
  }

  @Test public void neverForwardsOneTimePasswordsOrChatter() {
    String[] no = {
      "483920 is your OTP for txn of Rs 250.00 at Fresh Mart. Do not share it with anyone.",
      "Your one time password for payment of Rs.640 is 221133",
      "Use verification code 998877 to log in.",
      "Hi, are we still meeting at 5?",
      "Your parcel has been sent and will arrive tomorrow.",
      "Get 50% off on your next ride. Offer valid till Sunday.",
      "Paid",
      "",
    };
    for (String s : no) assertFalse(s, MoneyFilter.looksLikeMoney(s));
    assertFalse(MoneyFilter.looksLikeMoney(null));
  }

  @Test public void readsOnlyPaymentApps() {
    assertTrue(MoneyFilter.isPaymentApp("com.google.android.apps.nbu.paisa.user"));
    assertTrue(MoneyFilter.isPaymentApp("com.phonepe.app"));
    assertTrue(MoneyFilter.isPaymentApp("net.one97.paytm"));
    assertFalse(MoneyFilter.isPaymentApp("com.instagram.android"));
    assertFalse(MoneyFilter.isPaymentApp("com.google.android.gm"));
    assertFalse(MoneyFilter.isPaymentApp(null));
  }

  @Test public void acceptsOnlyRealCaptureLinks() {
    assertTrue(MoneyFilter.validLink("https://tandem-money-apps-4fab.vercel.app/api/capture?k=Abc123_def-456GHI789jklMNO012pqr"));
    assertFalse(MoneyFilter.validLink("http://tandem.example/api/capture?k=Abc123_def-456GHI789jklMNO012pqr"));
    assertFalse(MoneyFilter.validLink("https://evil.example/steal?k=Abc123_def-456GHI789jklMNO012pqr"));
    assertFalse(MoneyFilter.validLink("https://tandem.example/api/capture?k=short"));
    assertFalse(MoneyFilter.validLink("https://tandem.example/api/capture?k=Abc123_def-456GHI789jklMNO012pqr&x=1"));
    assertFalse(MoneyFilter.validLink(null));
  }

  @Test public void tidiesAndCapsLength() {
    assertEquals("Rs.250 debited from A/c", MoneyFilter.tidy("  Rs.250   debited\nfrom A/c  "));
    assertEquals(1400, MoneyFilter.tidy("x".repeat(5000)).length());
  }
}
