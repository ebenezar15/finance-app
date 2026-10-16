# Decisions

- **Neutral, global product.** No cultural theming. Currency, number grouping and financial-year start come from onboarding (INR gets 1,00,000 grouping and lakh/crore compact notation; others use their own locale).
- **Integer minor units everywhere, at a fixed ×100 scale.** Every currency is stored ×100 so money math never depends on the currency. Display uses each currency's own decimals (JPY 0, KWD 3). The trade-off is that a 3-decimal currency's thousandths are rounded to the nearest hundredth on entry (KWD 1.2345 is stored as 1.23). That's acceptable for household budgeting; a per-currency scale would need a data migration.
- **Any currency, English UI.** Currency formatting follows the currency's own convention where one is strong (INR, JPY…), otherwise the device locale. Dates use English names in the device's regional order.
- **Shared single-file build.** `build:embed` inlines everything into one page, keeps routes in memory (no URL paths), skips the service worker, opens on a demo household in the viewer's local currency, and saves files through the host's download prompt.
- **Read the whole household into memory.** A household has a few thousand rows, so `useData()` loads everything once per change. Screens stay consistent and the money engine stays pure. If this gets slow, the next step is moving aggregation into a worker.
- **Sankey drawn by hand.** The cash-flow river is a small custom SVG rather than a chart library. It needs custom labels, keyboard focus per stream, and click-through to activity.
- **Low-confidence parses never post.** Below 0.75 confidence, an alert goes to the review inbox. Ambiguous debit/credit wording scores 0.4.
- **Prepayments reduce tenure, not EMI**, which matches most lenders' default.
- **Subscription detection allows 25% amount drift**, so a price rise is flagged as a change rather than dropping out of detection.
- **Radix Dialog only.** Other primitives are plain accessible HTML, which keeps the bundle small for low-end phones.
