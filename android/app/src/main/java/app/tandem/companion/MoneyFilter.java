package app.tandem.companion;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Decides whether a message is about money moving, so that only those ever leave the phone.
 * Deliberately a little generous: Tandem does the careful reading and drops anything that isn't
 * a real payment. One-time passwords are never forwarded.
 */
public final class MoneyFilter {
  private MoneyFilter() {}

  private static final Pattern OTP = Pattern.compile(
      "\\b(otp|one[ -]?time password|verification code|security code|do not share|don't share|never share)\\b", Pattern.CASE_INSENSITIVE);
  private static final Pattern MOVED = Pattern.compile(
      "\\b(debited|credited|spent|paid|received|sent|withdrawn|withdrawal|deposited|purchase|refund(ed)?|transferred|trf|payment of|txn|charged)\\b",
      Pattern.CASE_INSENSITIVE);
  private static final Pattern AMOUNT = Pattern.compile(
      "(₹|rs\\.?|inr|usd|eur|gbp|aed|sar|\\$|€|£)\\s?[0-9][0-9,]*(\\.[0-9]{1,2})?|[0-9][0-9,]*(\\.[0-9]{1,2})?\\s?(inr|usd|eur|gbp|aed|sar)\\b"
          + "|\\b(debited|credited)\\s+(by|for|with)\\s+[0-9]",
      Pattern.CASE_INSENSITIVE);

  /** True for "Rs.250 debited from A/c XX1234…", "You paid ₹120 to Uber", "₹5,000 credited…". */
  public static boolean looksLikeMoney(String text) {
    if (text == null) return false;
    String t = text.trim();
    if (t.length() < 8 || t.length() > 2000) return false;
    if (OTP.matcher(t).find()) return false;
    return MOVED.matcher(t).find() && AMOUNT.matcher(t).find();
  }

  /** Payment apps whose notifications are worth reading. Everything else is ignored outright. */
  public static boolean isPaymentApp(String pkg) {
    if (pkg == null) return false;
    switch (pkg.toLowerCase(Locale.ROOT)) {
      case "com.google.android.apps.nbu.paisa.user": // Google Pay (India)
      case "com.google.android.apps.walletnfcrel":   // Google Wallet / Pay
      case "com.phonepe.app":
      case "net.one97.paytm":
      case "in.org.npci.upiapp":                     // BHIM
      case "in.amazon.mshop.android.shopping":       // Amazon Pay
      case "com.dreamplug.androidapp":               // CRED
      case "com.mobikwik_new":
      case "com.freecharge.android":
      case "com.whatsapp":                           // WhatsApp Pay receipts (still filtered by wording)
        return true;
      default:
        return false;
    }
  }

  /** Collapses whitespace and trims to what the server accepts. */
  public static String tidy(String text) {
    String t = text == null ? "" : text.replaceAll("\\s+", " ").trim();
    return t.length() > 1400 ? t.substring(0, 1400) : t;
  }

  /** A capture link looks like https://<site>/api/capture?k=<key>. */
  public static boolean validLink(String link) {
    return link != null && link.matches("^https://[A-Za-z0-9.-]+(:[0-9]+)?/api/capture\\?k=[A-Za-z0-9_-]{20,80}$");
  }
}
