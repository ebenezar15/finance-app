# Automatic payment capture

Google Pay, PhonePe, Paytm and banks don't let other apps read your payment history, and a web app can't read your SMS or notifications by itself. So Tandem can't connect to them directly. What it can do is read the **message** each payment produces, if your phone passes it along.

There are three ways to get a payment message into Tandem:

| Way | Effort | Works on |
|---|---|---|
| **Automatic forwarding** by an automation app | Set up once | Android (app notifications and SMS), iPhone (bank SMS) |
| **Share to Tandem** from the SMS or message | One tap per payment | Android, with Tandem installed |
| **Paste a message** in Inbox & import | Copy and paste | Any phone |

Whichever way it arrives, Tandem does the same thing with it:

- reads the amount, whether money went out or came in, who it was with, the account's last digits and the reference number;
- chooses the account (by last digits) and the category (from what you've filed before, then common shop names);
- adds it straight away when it's sure, and puts it in the **review inbox** when it isn't, for example a payee it has never seen. Approving it once teaches Tandem that payee;
- counts a payment once even when both the app notification and the bank SMS arrive for it;
- ignores one-time passwords, offers, payment requests, reminders and failed payments.

## Automatic forwarding

You need a Tandem account (Settings → Account & unlock). Then go to **Settings → Automatic payment capture** and tap **Turn on**. You get a private capture link.

### Android: MacroDroid

1. Install **MacroDroid** (free) from the Play Store. Tasker and similar apps work the same way.
2. **Add Macro**. Trigger: **Device Events → Notification → Notification Received**. Pick the apps to watch: Google Pay, PhonePe, Paytm, your bank's app and your SMS app.
3. Action: **Web Interactions → HTTP Request**. Method **POST**, URL = your capture link, content type **text/plain**, and for the body insert **Notification title** and **Notification text** with the "…" button.
4. Save. Allow **notification access** when asked, and turn off battery optimisation for MacroDroid.
5. In Tandem, tap **Send a test**. Then make a small payment and open Tandem.

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
