# svelte-gas-price

Embeddable fuel price widgets for Belgium, built with Svelte 5 + D3 + pym.js and deployed on GitHub Pages.

## Widgets

- **Calculator** (`/widget/`) — computes the cost of a full tank today vs. a past date, for Essence 95, Diesel, or Mazout.
- **BestPrices** (`/BestPrices/`) — cheapest pump prices by province (Essence 95, Super 98, Diesel), updated three times a day.

## Data sources

**Official maximum prices** — [Statbel / be.STAT API](https://bestat.statbel.fgov.be/) (CC BY 4.0), fetched daily via GitHub Actions → `public/data/prices.json`. Covers today's price, a rolling daily history (accumulated across runs to avoid gaps), monthly averages, and annual averages back to 2019.

Endpoints used (`https://bestat.statbel.fgov.be/bestat/api/views/{id}/result/JSON`):

| View ID | Content |
|---|---|
| `665e2960-bf86-4d64-b4a8-90f2d30ea892` | Current day prices |
| `00881a30-7ec8-4117-93c3-c9e661b3dbd4` | Last 365 price-change events |
| `b2be867c-947a-47d3-8098-80a5071204b1` | Last 24-month averages |
| `74d181b1-7074-4c9f-9a71-85303980d41f` | Annual averages 2019–present |

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
