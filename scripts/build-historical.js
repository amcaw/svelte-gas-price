#!/usr/bin/env node
/**
 * build-historical.js
 * Parses src/historical_data.csv into public/data/historical.json
 *
 * Output format: [{ date: "YYYY-MM-DD", essence95?, essence98?, diesel?, mazout?, mazout_plus? }]
 * sorted ascending, deduplicated against prices.json daily range.
 *
 * Known denomination changes (annotated in the chart):
 *   - Currently tracked: Essence 95 RON E10 (→ key "essence95"), Essence 98 RON E5 (→ key "essence98")
 *   - Add known rename events to DENOMINATION_CHANGES below if needed.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_IN    = join(__dirname, '..', 'src', 'historical_data.csv');
const OUT       = join(__dirname, '..', 'public', 'data', 'historical.json');
const PRICES_JSON = join(__dirname, '..', 'public', 'data', 'prices.json');

// ── Known product denomination/rename events ──────────────────────────────────
// These are written into the JSON and rendered as annotations on the chart.
// Format: { date: 'YYYY-MM-DD', label: string, fuels: string[] }
// Add entries here when Statbel renames a product.
const DENOMINATION_CHANGES = [
    // Example (fill in real dates if known):
    // { date: '2022-10-01', label: 'Essence 95 E5 → E10 (standard)', fuels: ['essence95'] },
];

// ── Product matcher (mirrors fetch-prices.js) ─────────────────────────────────
function matchProduct(name) {
    if (name.includes('98') && !name.includes('E10')) return 'essence98';
    if (name.includes('95') && name.includes('E10'))  return 'essence95';
    if (name.includes('B7')
        && !name.includes('Heating') && !name.includes('Chauffage')
        && !name.includes('Agriculture') && !name.includes('I&C')
        && !name.includes('pump') && !name.includes('pompe')) return 'diesel';
    if ((name.includes('Heating') || name.includes('Chauffage'))
        && (name.includes('>=2000') || name.includes('partir'))
        && !name.includes('H0') && !name.includes('Agriculture') && !name.includes('I&C')) return 'mazout_plus';
    if ((name.includes('Heating') || name.includes('Chauffage'))
        && (name.includes('<2000') || name.includes('moins de 2000'))
        && !name.includes('H0') && !name.includes('Agriculture') && !name.includes('I&C')) return 'mazout';
    return null;
}

// ── Date parser ───────────────────────────────────────────────────────────────
const MONTHS = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                 JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
function parseDay(str) {
    const dd   = str.slice(0, 2);
    const mm   = MONTHS[str.slice(2, 5).toUpperCase()];
    const yy   = str.slice(5, 7);
    const yyyy = parseInt(yy) >= 80 ? `19${yy}` : `20${yy}`;
    return `${yyyy}-${mm}-${dd}`;
}

// ── CSV parser (compressed 3-column format) ───────────────────────────────────
function parseCSV(text) {
    const rows = [];
    const lines = text.split('\n').slice(1); // skip header
    for (const line of lines) {
        if (!line.trim()) continue;
        // Compressed format: "26MAR21","Product name",price
        const match = line.match(/^"([^"]+)","([^"]+)",(.*)$/);
        if (!match) continue;
        const [, day, product, priceStr] = match;
        const price = priceStr.trim() === '' ? null : parseFloat(priceStr);
        if (price == null || isNaN(price)) continue;
        rows.push({ day, product, price });
    }
    return rows;
}

// ── Load cutoff date from prices.json (earliest date in daily) ────────────────
let cutoffDate = null;
if (existsSync(PRICES_JSON)) {
    const prices = JSON.parse(readFileSync(PRICES_JSON, 'utf8'));
    if (prices.daily?.length > 0) {
        cutoffDate = prices.daily[0].date;
        console.log(`Cutoff: excluding dates >= ${cutoffDate} (already in prices.json daily)`);
    }
}

// ── Parse CSV and group by date ───────────────────────────────────────────────
const csv  = readFileSync(CSV_IN, 'utf8');
const rows = parseCSV(csv);

const byDate = {};
for (const { day, product, price } of rows) {
    const date = parseDay(day);
    if (cutoffDate && date >= cutoffDate) continue;
    const key = matchProduct(product);
    if (!key) continue;
    if (!byDate[date]) byDate[date] = {};
    byDate[date][key] = parseFloat(price.toFixed(2));
}

const entries = Object.entries(byDate)
    .filter(([, v]) => v.essence95 != null || v.diesel != null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, prices]) => ({ date, ...prices }));

// ── Write output ──────────────────────────────────────────────────────────────
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
    entries,
    denominationChanges: DENOMINATION_CHANGES,
}, null, 2));

console.log(`✓ Written ${entries.length} historical entries to ${OUT}`);
if (entries.length > 0) {
    console.log(`  Range: ${entries[0].date} → ${entries.at(-1).date}`);
}
if (DENOMINATION_CHANGES.length > 0) {
    console.log(`  Denomination changes annotated: ${DENOMINATION_CHANGES.length}`);
}
