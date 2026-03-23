#!/usr/bin/env node
/**
 * compress-csv.js
 * Filters historical_data.csv to only the 5 products we actually use,
 * removes the "Mois/Année" column, and rounds prices to 2 decimals.
 * Overwrites the original CSV in place.
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_IN  = join(__dirname, '..', 'src', 'historical_data_original.csv');
const CSV_OUT = join(__dirname, '..', 'src', 'historical_data.csv');

const KEEP = new Set([
    'Essence 95 RON E10 (€/L)',
    'Essence 98 RON E5 (€/L)',
    'Diesel B7 (€/L)',
    // Pre-April 2024: legacy mazout denomination
    'Gasoil Diesel Chauffage (moins de 2000 l) (€/L)',
    'Gasoil Diesel Chauffage (à partir de 2000 l) (€/L)',
    // From April 2024: new H0/H7 norm (NBN T52-716, ≤10 ppm soufre)
    'Gasoil chauffage (H0/H7) (moins de 2000 l) (€/L)',
    'Gasoil chauffage (H0/H7) (à partir de 2000 l) (€/L)',
]);

const lines = readFileSync(CSV_IN, 'utf8').split('\n');
const out = ['"Jour","Produit","Prix TVA incl."'];
let kept = 0, skipped = 0;

for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Full format: "MAR21","26MAR21","Group","Product",price
    const m = line.match(/^"([^"]+)","([^"]+)","([^"]+)","([^"]+)",(.*)$/);
    if (!m) continue;
    const [, , day, , product, priceStr] = m;
    if (!KEEP.has(product)) { skipped++; continue; }
    const price = priceStr.trim() === '' ? null : parseFloat(priceStr);
    if (price == null || isNaN(price)) { skipped++; continue; }
    out.push(`"${day}","${product}",${price}`);
    kept++;
}

writeFileSync(CSV_OUT, out.join('\n') + '\n');
console.log(`✓ Compressed: kept ${kept} rows, removed ${skipped}`);
console.log(`  New format: Jour, Produit, Prix TVA incl. (2 decimals)`);
