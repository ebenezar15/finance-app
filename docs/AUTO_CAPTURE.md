# Automatic payment capture

Google Pay, PhonePe, Paytm and banks don't let other apps read your payment history, and a web app can't read your SMS or notifications by itself. So Tandem can't connect to them directly. What it can do is read the **message** each payment produces, if your phone passes it along.

There are four ways to get a payment into Tandem:

| Way | Effort | Works on |
|---|---|---|
| **Automatic forwarding** by an automation app | Set up once | Android (MacroDroid: bank SMS and payment app notifications), iPhone (Shortcuts: bank SMS only) |
| **Share to Tandem** from the SMS or message | One tap per payment | Android, with Tandem installed |
| **Read a payment screenshot** in Inbox & import | Pick the screenshot | Any phone |
| **Paste a message** in Inbox & import | Copy and paste | Any phone |

Whichever way it arrives, Tandem does the same thing with it:

- reads the amount, whether money went out or came in, who it was with, the account's last digits and the reference number;
- chooses the account (by last digits) and the category (from what you've filed before, then common shop names);
- adds it straight away when it's sure, and puts it in the **review inbox** when it isn't, for example a payee it has never seen. Approving it once teaches Tandem that payee;
- counts a payment once even when both the app notification and the bank SMS arrive for it;
- ignores one-time passwords, offers, payment requests, reminders and failed payments.

## Automatic forwarding

You need a Tandem account (Settings → Account & unlock). Then go to **Settings → Automatic payment capture** and tap **Turn on**. You get a private capture link.

### Android: MacroDroid, from the Play Store (recommended)

MacroDroid is a free automation app. Because it comes from the Play Store, Google Play Protect doesn't block it.

Tandem gives you the whole configuration to paste: in **Settings → Automatic payment capture → Android: MacroDroid**, there are two **Copy** buttons.

1. Install **MacroDroid** from the Play Store.
2. **First macro, for bank SMS.** Add Macro → under **Triggers** tap **+**, search **SMS Received**, any sender, any content.
3. Under **Actions** tap **+**, search **HTTP Request**, open its **⋮** menu, choose **Import from cURL string**, and paste what **Copy for the SMS macro** gave you. Save the macro.
4. **Second macro, for payment apps.** Trigger: **Notification Received**, picking Google Pay, PhonePe and Paytm. Action: **HTTP Request**, importing what **Copy for the payment apps macro** gave you.
5. Allow the permissions MacroDroid asks for, and turn off battery optimisation for it.
6. In Tandem, tap **Send a test**. Then make a small payment and open Tandem.

What gets pasted looks like this (the `{…}` parts are MacroDroid's own placeholders for the message):

```
curl -X POST 'https://<your Tandem site>/api/capture?k=<your link>' -H 'Content-Type: text/plain' -d '{sms_message}'
curl -X POST 'https://<your Tandem site>/api/capture?k=<your link>' -H 'Content-Type: text/plain' -d '{not_title}. {notification}'
```

If the import option isn't there, fill the action in by hand: method **POST**, the capture link as the URL, content body type **text/plain**, and the body after `-d`. If MacroDroid doesn't offer **SMS Received**, add your Messages app to the second macro instead. Tasker and similar apps work the same way.

This forwards every SMS to your own link. Tandem's server drops one-time passwords and anything without a number before storing, and the app ignores whatever isn't a payment.

### Android: the Tandem Companion app (often blocked by Play Protect)

**Use MacroDroid if you can.** Google Play Protect automatically blocks apps installed from outside the Play Store that declare the SMS-reading or notification-reading permission, in India and several other countries, and can stop such an app after it's installed. The companion needs exactly those permissions, so nothing in the app can avoid the block. The only lasting fix is publishing it on the Play Store, which needs a Google Play developer account and Google's approval for SMS access.

It's kept for phones where Play Protect allows it. It checks every message on the phone and forwards only those about money moving; one-time passwords never leave the phone. Download it from `https://<your Tandem site>/tandem-companion.apk`, tap **Connect the companion app** in Tandem, allow SMS and notification access in the companion, and send a test. A picture guide is in [`companion-setup.png`](companion-setup.png). The source is in `android/`.

### iPhone: Shortcuts

1. **Shortcuts → Automation → +**, choose **Message**.
2. **Message Contains**: a word your bank always uses, such as `debited`. Choose **Run Immediately**.
3. Add **Get Contents of URL**: URL = your capture link, Method **POST**, Request Body **Form**, with a field `text` set to **Shortcut Input**.
4. Repeat for other words such as `credited` or `spent`.

iPhone doesn't let any app read Google Pay or PhonePe notifications. Your bank's SMS covers the same payments.

### When the numbers update

The automation app sends each message in the background. Tandem collects them when it's open: on opening, on coming back to it, and every minute while it stays open. Nothing is added while the app is closed; it catches up the next time you open it.

### Privacy

- Each message is **encrypted the moment it arrives**, to a key pair made on your phone. The private half is stored wrapped by your account's data key, so only your signed-in devices can read the queue. The server keeps no readable copy.
- Messages are deleted once collected, or after 30 days.
- The server stores only a hash of your link. Anyone who has the link could send made-up payments to your Tandem, but could never read anything. **Get a new link** replaces it at once.
- Limits: 1,500 characters per message, 120 messages per 15 minutes, 200 waiting at most.

### The endpoint, for other automation tools

```
POST /api/capture?k=<your link>
```

The text can be the raw body (`text/plain`), JSON `{ "text": "…" }`, a form field `text`, or a `text` query parameter (GET works too). The key can also go in an `X-Tandem-Key` header instead of `k`. An optional `at` gives the time the message arrived, in milliseconds.

## Share to Tandem

With Tandem installed from Chrome on Android, it appears in the share sheet. Open the SMS or message, tap **Share**, choose **Tandem**. A link of the form `/?capture=<text>` does the same thing.

## Read a payment screenshot

In **Inbox & import → Read a payment screenshot**, choose one or more screenshots of the "payment successful" screen from Google Pay, PhonePe, Paytm or a bank app. Tandem reads the amount, who it went to, the reference and the date, shows you what it found, and adds it when you tap **Add it** (or **Edit first** to change anything).

- The picture is read **on the phone** and never uploaded.
- The reader (about 7 MB) is downloaded the first time you use it, then kept, so it works offline afterwards.
- Failed and pending payments are not added.
- It works best with the full, uncropped success screen. If the rupee sign wasn't clear, Tandem says so and asks you to check the amount.
- It isn't available in the Claude share link, only in the installed app and the website.
