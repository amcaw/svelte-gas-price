# svelte-gas-price

Embeddable fuel price widgets for Belgium, built with Svelte 5 + D3 + pym.js and deployed on GitHub Pages.

## Widgets

- **Calculator** (`/widget/`) — computes the cost of a full tank today vs. a past date, for Essence 95, Diesel, or Mazout.
- **BestPrices** (`/BestPrices/`) — cheapest pump prices by province (Essence 95, Super 98, Diesel), updated three times a day.

## Data sources

**Today's prices** — scraped from the [SPF Economie official page](https://petrolprices.economie.fgov.be/petrolprices?locale=fr) (iframe embedded on economie.fgov.be). More reliable and often published earlier than the Statbel API.

**Historical prices** — [Statbel / be.STAT API](https://bestat.statbel.fgov.be/) (CC BY 4.0). Daily history is accumulated across runs to avoid gaps.

| Source | View ID | Content |
|---|---|---|
| SPF Economie | — | Current tariff (HTML scraping via cheerio) |
| Statbel | `00881a30` | Last 365 price-change events (daily) |
| Statbel | `b2be867c` | Last 24-month averages (monthly) |
| Statbel | `74d181b1` | Annual averages 2019–present |

Both sources are fetched daily via GitHub Actions → `public/data/prices.json`. Data is pushed directly to `gh-pages` (no rebuild needed).

**Best pump prices** — scraped from carbu.com by province and locality → `public/data/best-prices.json` (used with permission from carbu.com).

## Mazout denomination

Statbel changed its product naming in **April 2024** following the NBN T52-716 European harmonisation:

- **Before April 2024**: "Gasoil Diesel Heating/Chauffage"
- **Since April 2024**: "H0 Domestic Heating" (< 2 000 L) / "H7" (≥ 2 000 L)

The data pipeline uses **H0/H7 as primary** and the legacy label as fallback, ensuring continuity across the full historical range. When both labels appear for the same date (transition period), H0 wins.

Two volume tiers are tracked: `mazout` (< 2 000 L) and `mazout_plus` (≥ 2 000 L).

## Dev

```sh
npm install
npm run dev           # local dev server
npm run fetch-prices  # update prices.json manually
npm run build         # production build
```
