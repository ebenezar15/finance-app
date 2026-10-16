import { useMemo } from 'react';
import { CURRENCIES, POPULAR_CURRENCIES, currencyName, currencySymbol } from '../lib/money';

/** Region → currency, used only to pre-select a sensible default from the device locale. */
const REGION_CURRENCY: Record<string, string> = {
  US: 'USD', GB: 'GBP', IN: 'INR', JP: 'JPY', CN: 'CNY', AU: 'AUD', CA: 'CAD', CH: 'CHF', SG: 'SGD', HK: 'HKD', NZ: 'NZD',
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR', ZA: 'ZAR', NG: 'NGN', KE: 'KES', GH: 'GHS', EG: 'EGP',
  MA: 'MAD', BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', SE: 'SEK', NO: 'NOK', DK: 'DKK', IS: 'ISK',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', TR: 'TRY', IL: 'ILS', RU: 'RUB', UA: 'UAH', PK: 'PKR', BD: 'BDT',
  LK: 'LKR', NP: 'NPR', ID: 'IDR', MY: 'MYR', TH: 'THB', VN: 'VND', PH: 'PHP', KR: 'KRW', TW: 'TWD',
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', IE: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR',
  SK: 'EUR', SI: 'EUR', LT: 'EUR', LV: 'EUR', EE: 'EUR', HR: 'EUR', LU: 'EUR', MT: 'EUR', CY: 'EUR',
};

export function guessCurrency(): string {
  try {
    const loc = new Intl.Locale(navigator.language).maximize();
    return (loc.region && REGION_CURRENCY[loc.region]) || 'USD';
  } catch {
    return 'USD';
  }
}

/** All ISO currencies, with the most common ones first. Native <select> keeps it fast and accessible. */
export function CurrencySelect({ value, onChange, id, className = 'field' }: { value: string; onChange: (c: string) => void; id?: string; className?: string }) {
  const label = (c: string) => `${c} — ${currencyName(c)}${currencySymbol(c) !== c ? ` (${currencySymbol(c)})` : ''}`;
  const rest = useMemo(() => CURRENCIES.filter((c) => !POPULAR_CURRENCIES.includes(c)).map((c) => [c, label(c)] as const), []);
  const popular = useMemo(() => {
    const local = guessCurrency();
    return [local, ...POPULAR_CURRENCIES.filter((c) => c !== local)];
  }, []);
  return (
    <select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Common">{popular.map((c) => <option key={c} value={c}>{label(c)}</option>)}</optgroup>
      <optgroup label="All currencies">{rest.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</optgroup>
    </select>
  );
}
