#!/usr/bin/env node
/**
 * fetch-best-prices.js
 * 1. Scrapes carbu.com/belgique/meilleurs-prix/Belgique/BE/0 for province-level best prices.
 * 2. For each province, scrapes the province detail page to find the cheapest locality
 *    (name + direct station-list URL) for Essence 95 E10 (col 1) and Diesel B7 (col 5).
 * Writes public/data/best-prices.json.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT    = join(__dirname, '..', 'public', 'data', 'best-prices.json');
const ORIGIN = 'https://carbu.com';
const MAIN   = `${ORIGIN}/belgique/meilleurs-prix/Belgique/BE/0`;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; news-bot/1.0)' };

// ── Decode basic HTML entities ─────────────────────────────────────────────
const ENTITIES = { '&egrave;':'è','&eacute;':'é','&agrave;':'à','&ecirc;':'ê',
                   '&icirc;':'î','&ocirc;':'ô','&ugrave;':'ù','&ucirc;':'û',
                   '&euml;':'ë','&ouml;':'ö','&amp;':'&','&nbsp;':' ' };
function decode(str) {
    return str.replace(/&[a-z]+;/g, m => ENTITIES[m] ?? m).trim();
}

async function fetchHtml(url) {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
}

// ── Parse the officialPriceBe table rows ───────────────────────────────────
// Returns array of { name, nameUrl, cells[] } where each cell is { price, url } or null.
// Columns: 0=name  1=E10  2=E5  3=98E5  4=98E10  5=DieselB7  …
function parseRows(html) {
    const tableMatch = html.match(/<table[^>]*class="table table-bordered"[^>]*>([\s\S]*?)<\/table>/);
    if (!tableMatch) return [];

    const rows = [...tableMatch[1].matchAll(/class="officialPriceBe[^"]*"[^>]*>([\s\S]*?)(?=<tr\s|$)/g)];
    return rows.map(([, rowHtml]) => {
        // Name from first alt attribute
        const nameMatch = rowHtml.match(/alt="([^"]+)"/);
        if (!nameMatch) return null;
        const name = decode(nameMatch[1]);

        // Province/locality page URL (from first href in the row — the name cell link)
        const nameUrlMatch = rowHtml.match(/href="([^"]+meilleurs-prix[^"]*)"/);
        const nameUrl = nameUrlMatch
            ? (nameUrlMatch[1].startsWith('http') ? nameUrlMatch[1] : ORIGIN + nameUrlMatch[1])
            : null;

        // Split on <td for per-column data (handles missing </td> on dash cells)
        const cells = rowHtml.split('<td').slice(1).map(cell => {
            const priceMatch = cell.match(/([0-9]+[,\.][0-9]+)\s*&euro;/);
            const urlMatch   = cell.match(/href="([^"]+liste-stations[^"]*)"/);
            return {
                price: priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null,
                url:   urlMatch ? (urlMatch[1].startsWith('http') ? urlMatch[1] : ORIGIN + urlMatch[1]) : null,
            };
        });

        return { name, nameUrl, cells };
    }).filter(Boolean);
}

// ── Fetch cheapest locality for a province ─────────────────────────────────
async function fetchProvinceBest(provinceUrl) {
    const html = await fetchHtml(provinceUrl);
    const rows = parseRows(html);

    const best = (colIdx) => {
        const candidates = rows
            .filter(r => r.cells[colIdx]?.price != null)
            .sort((a, b) => a.cells[colIdx].price - b.cells[colIdx].price);
        if (!candidates.length) return null;
        const top = candidates[0];
        return { locality: top.name, price: top.cells[colIdx].price, url: top.cells[colIdx].url };
    };

    return { essence95: best(1), super98: best(3), diesel: best(5) };
}

// ── Main ──────────────────────────────────────────────────────────────────
console.log('Fetching main overview…');
const mainHtml  = await fetchHtml(MAIN);
const provinces = parseRows(mainHtml);
console.log(`  Found ${provinces.length} provinces`);

console.log('Fetching province detail pages…');
const results = await Promise.all(provinces.map(async prov => {
    if (!prov.nameUrl) return null;
    const best = await fetchProvinceBest(prov.nameUrl);
    return {
        province:  prov.province ?? prov.name,
        essence95: best.essence95,
        super98:   best.super98,
        diesel:    best.diesel,
    };
}));

const valid = results.filter(Boolean);

const output = {
    lastUpdated: new Date().toLocaleDateString('sv'),
    source:      'carbu.com',
    provinces:   valid,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(output, null, 2));

console.log(`✓ Written ${valid.length} provinces to ${OUT}`);
valid.forEach(p => {
    const e = p.essence95;
    const s = p.super98;
    const d = p.diesel;
    console.log(`  ${p.province.padEnd(20)} E10: ${e?.price} @ ${e?.locality}  |  98E5: ${s?.price} @ ${s?.locality}  |  D: ${d?.price} @ ${d?.locality}`);
});
