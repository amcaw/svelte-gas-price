/**
 * Loader and helpers for public/data/prices.json
 *
 * Data shape:
 *   lastUpdated  string       "YYYY-MM-DD"
 *   today        { essence95, diesel, mazout }   €/L
 *   daily        [{ date, essence95, diesel, mazout }]   sorted asc
 *   monthly      [{ year, month, essence95, diesel, mazout }]   sorted asc
 *   annual       [{ year, essence95, diesel, mazout }]   sorted asc
 */

let _cache = null;

export async function loadPrices(base = import.meta.env.BASE_URL) {
    if (_cache) return _cache;
    const url = `${base}data/prices.json`.replace('//', '/');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load prices.json: ${res.status}`);
    _cache = await res.json();
    return _cache;
}

/**
 * Get today's price for a fuel type.
 */
export function getTodayPrice(prices, fuelType) {
    return prices.today[fuelType] ?? null;
}

/**
 * Get monthly average for a specific year+month.
 * Falls back to annual average if monthly not available.
 */
export function getMonthlyPrice(prices, fuelType, year, month) {
    const m = prices.monthly.find(r => r.year === year && r.month === month);
    if (m && m[fuelType] != null) return m[fuelType];
    return getAnnualPrice(prices, fuelType, year);
}

/**
 * Get annual average price for a fuel type and year.
 */
export function getAnnualPrice(prices, fuelType, year) {
    const a = prices.annual.find(r => r.year === year);
    return a?.[fuelType] ?? null;
}

/**
 * Get closest daily price to a target date (YYYY-MM-DD).
 * Looks within the available daily range, else falls back to monthly/annual.
 */
export function getClosestPrice(prices, fuelType, targetDate) {
    const daily = prices.daily;
    if (daily.length > 0) {
        const first = daily[0].date;
        const last  = daily.at(-1).date;
        if (targetDate >= first && targetDate <= last) {
            // Binary search for closest date
            let lo = 0, hi = daily.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (daily[mid].date < targetDate) lo = mid + 1;
                else hi = mid;
            }
            // Pick the nearest between lo-1 and lo
            const candidates = [daily[lo]];
            if (lo > 0) candidates.push(daily[lo - 1]);
            const closest = candidates.reduce((a, b) =>
                Math.abs(a.date.localeCompare(targetDate)) <=
                Math.abs(b.date.localeCompare(targetDate)) ? a : b
            );
            return closest[fuelType] ?? null;
        }
    }
    // Fall back to monthly or annual
    const d = new Date(targetDate);
    return getMonthlyPrice(prices, fuelType, d.getFullYear(), d.getMonth() + 1);
}

/**
 * Returns the oldest available year in annual data.
 */
export function getOldestYear(prices) {
    return prices.annual[0]?.year ?? 2019;
}

/**
 * Returns available years for comparison (all annual years except current).
 */
export function getComparisonYears(prices) {
    const currentYear = new Date().getFullYear();
    return prices.annual
        .filter(r => r.year < currentYear)
        .map(r => r.year)
        .sort((a, b) => b - a); // descending (most recent first)
}
