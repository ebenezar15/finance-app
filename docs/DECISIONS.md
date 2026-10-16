# Decisions

- **Neutral, global product.** No cultural theming. Currency, number grouping and financial-year start come from onboarding (INR gets 1,00,000 grouping and lakh/crore compact notation; others use their own locale).
- **Integer minor units everywhere.** Every currency is stored ×100. For JPY this means the stored values carry two unused decimals; display still rounds correctly.
- **Read the whole household into memory.** A household has a few thousand rows, so `useData()` loads everything once per change. Screens stay consistent and the money engine stays pure. If this gets slow, the next step is moving aggregation into a worker.
- **Sankey drawn by hand.** The cash-flow river is a small custom SVG rather than a chart library. It needs custom labels, keyboard focus per stream, and click-through to activity.
- **Low-confidence parses never post.** Below 0.75 confidence, an alert goes to the review inbox. Ambiguous debit/credit wording scores 0.4.
- **Prepayments reduce tenure, not EMI**, which matches most lenders' default.
- **Subscription detection allows 25% amount drift**, so a price rise is flagged as a change rather than dropping out of detection.
- **Radix Dialog only.** Other primitives are plain accessible HTML, which keeps the bundle small for low-end phones.
