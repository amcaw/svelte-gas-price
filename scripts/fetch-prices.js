#!/usr/bin/env node
/**
 * fetch-prices.js
 * Fetches Belgian max fuel prices from Statbel / be.STAT API
 * and writes public/data/prices.json
 *
 * Data sources (all CC BY 4.0):
 *   665e2960  → current day prices (all products)
 *   00881a30  → last 365 price-change events (daily, ~5–8 months)
 *   b2be867c  → last 24-month averages (monthly)
 *   74d181b1  → annual averages 2019–present (French labels)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'data', 'prices.json');

const BASE = 'https://bestat.statbel.fgov.be/bestat/api/views';
const VIEWS = {
    today:   '665e2960-bf86-4d64-b4a8-90f2d30ea892',
    daily:   '00881a30-7ec8-4117-93c3-c9e661b3dbd4',
    monthly: 'b2be867c-947a-47d3-8098-80a5071204b1',
    annual:  '74d181b1-7074-4c9f-9a71-85303980d41f',
};

// ── Product name matchers ─────────────────────────────────────────────────────
// Returns one of: essence95 | essence98 | diesel | mazout | mazout_plus | null
function matchProduct(name) {
    // 98 must be checked before 95 (98 contains no "E10" so 95 won't false-match anyway, but be explicit)
    if (name.includes('98') && !name.includes('E10')) return 'essence98';
    if (name.includes('95') && name.includes('E10'))  return 'essence95';
    if (name.includes('B7')
        && !name.includes('Heating') && !name.includes('Chauffage')
        && !name.includes('Agriculture') && !name.includes('I&C')
        && !name.includes('pump') && !name.includes('pompe')) return 'diesel';
    // Gasoil Diesel Heating/Chauffage (legacy denomination, consistent across all dates)
    if ((name.includes('Heating') || name.includes('Chauffage'))
        && !name.includes('H0') && !name.includes('Agriculture') && !name.includes('I&C')
        && (name.includes('>=2000') || name.includes('partir'))) return 'mazout_plus';
    if ((name.includes('Heating') || name.includes('Chauffage'))
        && !name.includes('H0') && !name.includes('Agriculture') && !name.includes('I&C')
        && (name.includes('<2000') || name.includes('moins de 2000'))) return 'mazout';
    return null;
}

async function fetchJSON(viewId) {
    const url = `${BASE}/${viewId}/result/JSON`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for view ${viewId}`);
    return res.json();
}

// Parse Statbel date format "23MAR26" → "2026-03-23"
const MONTHS = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                 JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
function parseDay(str) {
    const dd = str.slice(0,2);
    const mm = MONTHS[str.slice(2,5).toUpperCase()];
    const yy = str.slice(5,7);
    const yyyy = parseInt(yy) >= 80 ? `19${yy}` : `20${yy}`;
    return `${yyyy}-${mm}-${dd}`;
}

// ── Fetch today ───────────────────────────────────────────────────────────────
async function fetchToday() {
    const data = await fetchJSON(VIEWS.today);
    const today = {};
    for (const fact of data.facts) {
        const key = matchProduct(fact['Product'] || '');
        if (key && fact['Price incl. VAT'] != null) {
            today[key] = parseFloat(fact['Price incl. VAT'].toFixed(2));
        }
    }
    const date = parseDay(data.facts[0]['Day']);
    return { date, prices: today };
}

// ── Fetch daily (last 365 changes) ───────────────────────────────────────────
async function fetchDaily() {
    const data = await fetchJSON(VIEWS.daily);
    const byDate = {};
    for (const fact of data.facts) {
        const key = matchProduct(fact['Product'] || '');
        if (!key || fact['Price incl. VAT'] == null) continue;
        const date = parseDay(fact['Day']);
        if (!byDate[date]) byDate[date] = {};
        byDate[date][key] = parseFloat(fact['Price incl. VAT'].toFixed(2));
    }
    return Object.entries(byDate)
        .filter(([, v]) => v.essence95 && v.diesel)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, prices]) => ({ date, ...prices }));
}

// ── Fetch monthly averages ────────────────────────────────────────────────────
async function fetchMonthly() {
    const data = await fetchJSON(VIEWS.monthly);
    const byYM = {};
    for (const fact of data.facts) {
        const key = matchProduct(fact['Product'] || '');
        if (!key || fact['Average price incl. VAT'] == null) continue;
        const ym = `${fact['Year']}-${String(parseInt(fact['Month'])).padStart(2,'0')}`;
        if (!byYM[ym]) byYM[ym] = {};
        byYM[ym][key] = parseFloat(fact['Average price incl. VAT'].toFixed(2));
    }
    return Object.entries(byYM)
        .filter(([, v]) => v.essence95 && v.diesel)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([ym, prices]) => {
            const [year, month] = ym.split('-');
            return { year: parseInt(year), month: parseInt(month), ...prices };
        });
}

// ── Fetch annual averages ─────────────────────────────────────────────────────
async function fetchAnnual() {
    const data = await fetchJSON(VIEWS.annual);
    const byYear = {};
    for (const fact of data.facts) {
        const product = fact['Produit'] || fact['Product'] || '';
        const key = matchProduct(product);
        if (!key) continue;
        const price = fact['Prix moyen TVA incl.'] ?? fact['Average price incl. VAT'];
        if (price == null) continue;
        const year = parseInt(fact['Année'] || fact['Year']);
        if (!byYear[year]) byYear[year] = {};
        byYear[year][key] = parseFloat(price.toFixed(2));
    }
    return Object.entries(byYear)
        .filter(([, v]) => v.essence95 && v.diesel)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .map(([year, prices]) => ({ year: parseInt(year), ...prices }));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('Fetching prices from Statbel...');

    const [todayData, dailyData, monthlyData, annualData] = await Promise.all([
        fetchToday(),
        fetchDaily(),
        fetchMonthly(),
        fetchAnnual(),
    ]);

    const output = {
        lastUpdated: new Date().toLocaleDateString('sv'), // date du cron, pas de l'API
        today: todayData.prices,
        daily: dailyData,
        monthly: monthlyData,
        annual: annualData,
    };

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(output, null, 2));

    const t = todayData.prices;
    console.log(`✓ Written to ${OUT}`);
    console.log(`  Today (${todayData.date}): E95=${t.essence95} E98=${t.essence98} D7=${t.diesel} Mazout<2000=${t.mazout} Mazout>=2000=${t.mazout_plus}`);
    console.log(`  Daily: ${dailyData.length} entries | Monthly: ${monthlyData.length} | Annual: ${annualData.length} years (${annualData[0]?.year}–${annualData.at(-1)?.year})`);
}

main().catch(err => { console.error(err); process.exit(1); });
