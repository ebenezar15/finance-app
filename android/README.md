# Tandem Companion (Android)

A website can never read SMS, so Tandem's automatic payment detection needs a small native app. This is it: plain Java, no libraries, one screen.

- `SmsReceiver` reads incoming SMS; `NotifListener` reads notifications from payment apps only.
- `MoneyFilter` decides on the phone whether a message is about money moving. Only those are forwarded; one-time passwords never are.
- `Forwarder` posts them to the person's Tandem capture link (`/api/capture?k=…`), keeps a queue while offline, and `FlushJob` sends it when the connection returns.
- `MainActivity` connects (via `tandem-companion://link?u=…` or a pasted link), asks for the two permissions, and has a test button.

## Build

`.github/workflows/companion.yml` runs the unit tests, builds a release APK and uploads it to the `companion` release. The Tandem site's `/tandem-companion.apk` redirects there.

Locally, with the Android SDK and Gradle 8.7+:

```
gradle -p android testReleaseUnitTest assembleRelease
```

## Signing

The signing key is never kept in this repository. The workflow uses the repository secrets `COMPANION_KEYSTORE_B64` and `COMPANION_KEYSTORE_PASSWORD` (key alias `companion`) when they exist. Otherwise it generates a key once and keeps it in the Actions cache, so later builds install over earlier ones. If that cache is cleared a new key is made, and the app must be uninstalled once before the new build will install. For a key that never changes, add the two secrets.

## Limits

- Android 13 and later treat SMS and notification access as "restricted settings" for apps installed outside the Play Store. The person allows them once in App info → ⋮ → Allow restricted settings.
- Some phones stop background apps aggressively. Turning off battery optimisation for the companion avoids missed messages.
- It only forwards. Tandem collects the messages and updates its numbers when it's next open.
