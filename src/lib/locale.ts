/**
 * The interface is written in English, so dates and plain numbers use English names while
 * keeping the device's regional order (en-GB → 16 Oct, en-US → Oct 16). Money formatting is
 * separate and follows each currency's own convention (see money.ts).
 */
export const APP_LOCALE: string = (() => {
  try {
    const loc = new Intl.Locale(navigator.language).maximize();
    const candidate = loc.language === 'en' ? navigator.language : `en-${loc.region ?? 'US'}`;
    return Intl.DateTimeFormat.supportedLocalesOf([candidate]).length ? candidate : 'en-US';
  } catch {
    return 'en-US';
  }
})();
