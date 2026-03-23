<script>
    import { onMount } from 'svelte';
    import * as d3 from 'd3';
    import { initPym, sendHeight } from '../lib/pym.js';
    import { loadPrices } from '../lib/data.js';
    import { getColors } from '../lib/colors.js';

    initPym();

    // ── D3 French locale ──────────────────────────────────────────────────────
    const frLocale = d3.timeFormatLocale({
        dateTime: '%A %e %B %Y à %X', date: '%d/%m/%Y', time: '%H:%M:%S',
        periods: ['AM', 'PM'],
        days: ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'],
        shortDays: ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'],
        months: ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'],
        shortMonths: ['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'],
    });
    const frTimeFormat = frLocale.format;

    // ── Fuel tabs config ──────────────────────────────────────────────────────
    const FUELS = [
        { key: 'essence95',  label: 'Essence 95',  defaultLiters: 45 },
        { key: 'essence98',  label: 'Essence 98',  defaultLiters: 45 },
        { key: 'diesel',     label: 'Diesel',      defaultLiters: 50 },
        { key: 'mazout',     label: 'Mazout',      defaultLiters: 1000 },
    ];

    // ── State ─────────────────────────────────────────────────────────────────
    let activeFuel = $state('essence95');
    let liters     = $state(45);
    let prices     = $state(null);
    let loading    = $state(true);
    let error      = $state(null);

    // ── Chart DOM refs ────────────────────────────────────────────────────────
    let svgEl    = $state();
    let chartWrap = $state();
    let chartTooltip = $state({ visible: false, x: 0, date: '', price: '' });

    // ── Load data ─────────────────────────────────────────────────────────────
    onMount(async () => {
        // Mark body as standalone when not embedded in a pym iframe
        if (window.self === window.top) {
            document.body.classList.add('standalone');
        }

        try {
            prices = await loadPrices();
        } catch (e) {
            error = 'Impossible de charger les données.';
        } finally {
            loading = false;
            sendHeight();
        }
    });

    // ── Derived helpers ───────────────────────────────────────────────────────
    function fuelKey(fuel, litersVal) {
        if (fuel === 'mazout') return litersVal >= 2000 ? 'mazout_plus' : 'mazout';
        return fuel;
    }

    // Actual current date in YYYY-MM-DD (browser clock, not API date)
    const todayISO = new Date().toLocaleDateString('sv'); // 'sv' locale gives YYYY-MM-DD

    // Today's current official price
    const todayPrice = $derived(() => {
        if (!prices) return null;
        return prices.today[fuelKey(activeFuel, liters)] ?? null;
    });

    // Comparison: daily.at(-2) vs daily.at(-1)
    const comparison = $derived(() => {
        if (!prices || prices.daily.length < 2) return null;
        const fk = fuelKey(activeFuel, liters);
        const entryA = prices.daily.at(-2);
        const entryB = prices.daily.at(-1);
        if (entryA[fk] == null || entryB[fk] == null) return null;
        const isTomorrow = entryB.date > todayISO;
        const delta = parseFloat((entryB[fk] - entryA[fk]).toFixed(4));
        return {
            dateA:  entryA.date, priceA: entryA[fk],
            dateB:  entryB.date, priceB: entryB[fk],
            isTomorrow,
            samePrice: entryA[fk] === entryB[fk],
            delta,
        };
    });

    // Hero = always the most recent entry (entryB), which may be tomorrow
    const heroPrice = $derived(() => {
        const cmp = comparison();
        return cmp ? cmp.priceB : todayPrice();
    });

    // Chart data
    const chartData = $derived(() => {
        if (!prices) return [];
        const chartKey = activeFuel === 'mazout' ? 'mazout' : activeFuel;
        const parse = d3.timeParse('%Y-%m-%d');
        return prices.daily
            .filter(d => d[chartKey] != null)
            .map(d => ({ date: parse(d.date), price: d[chartKey] }));
    });

    // ── Draw chart ────────────────────────────────────────────────────────────
    function drawChart(animate = false) {
        if (!svgEl || !chartWrap) return;
        const data = chartData();
        if (data.length < 2) return;

        const colors = getColors();
        const fuelColor = colors[activeFuel === 'mazout' ? 'mazout' : activeFuel] ?? colors.essence95;
        const duration = animate ? 450 : 0;

        const margin = { top: 8, right: 8, bottom: 28, left: 48 };
        const W = chartWrap.clientWidth  || 400;
        const H = Math.max(80, chartWrap.clientHeight || 140);
        const w = W - margin.left - margin.right;
        const h = H - margin.top  - margin.bottom;

        const svg = d3.select(svgEl)
            .attr('viewBox', `0 0 ${W} ${H}`)
            .attr('preserveAspectRatio', 'xMinYMin meet')
            .style('height', '100%');

        // Main group — create once, reuse
        let g = svg.select('g.chart-g');
        const isNew = g.empty();
        if (isNew) g = svg.append('g').attr('class', 'chart-g').attr('transform', `translate(${margin.left},${margin.top})`);

        const x = d3.scaleTime().domain(d3.extent(data, d => d.date)).range([0, w]);
        const ys = data.map(d => d.price);
        const y = d3.scaleLinear().domain([d3.min(ys) * 0.97, d3.max(ys) * 1.02]).range([h, 0]);

        const areaGen = d3.area().x(d => x(d.date)).y0(h).y1(d => y(d.price)).curve(d3.curveCatmullRom);
        const lineGen = d3.line().x(d => x(d.date)).y(d => y(d.price)).curve(d3.curveCatmullRom);

        // Grid — enter/update with transition
        const gridFn = d3.axisLeft(y).ticks(3).tickSize(-w).tickFormat('');
        let gridG = g.select('g.grid');
        if (gridG.empty()) gridG = g.insert('g', ':first-child').attr('class', 'grid');
        (animate ? gridG.transition().duration(duration) : gridG).call(gridFn);
        gridG.select('.domain').remove();
        gridG.selectAll('.tick line').attr('stroke', colors.grid);

        // Area — enter/update with transition
        let area = g.select('path.chart-area');
        if (area.empty()) area = g.append('path').attr('class', 'chart-area').attr('opacity', 0.12);
        area.attr('fill', fuelColor);
        (animate ? area.transition().duration(duration) : area).attr('d', areaGen(data));

        // Line — enter/update with transition
        let line = g.select('path.chart-line');
        if (line.empty()) line = g.append('path').attr('class', 'chart-line').attr('fill', 'none').attr('stroke-width', 2);
        line.attr('stroke', fuelColor);
        (animate ? line.transition().duration(duration) : line).attr('d', lineGen(data));

        // Crosshair
        let vline = g.select('line.vline');
        if (vline.empty()) vline = g.append('line').attr('class', 'vline')
            .attr('stroke-dasharray', '4 2').attr('stroke-width', 1).attr('y1', 0).attr('y2', h).attr('opacity', 0);
        vline.attr('stroke', colors.axis);

        // X-axis (recreate — x domain doesn't change across fuel switches)
        g.selectAll('.x-axis').remove();
        g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${h})`)
            .call(d3.axisBottom(x).ticks(d3.timeMonth.every(2)).tickFormat(frTimeFormat('%b %y')))
            .call(ax => ax.select('.domain').attr('stroke', colors.axis))
            .call(ax => ax.selectAll('.tick line').attr('stroke', colors.axis))
            .call(ax => ax.selectAll('text').attr('fill', colors.text).style('font-family', 'Montserrat, sans-serif').style('font-size', '10px'));

        // Y-axis — enter/update with transition so ticks interpolate
        const yAxisFn = d3.axisLeft(y).ticks(3)
            .tickFormat(d => `${d.toLocaleString('fr-BE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}€`);
        let yAxisG = g.select('g.y-axis');
        if (yAxisG.empty()) yAxisG = g.append('g').attr('class', 'y-axis');
        (animate ? yAxisG.transition().duration(duration) : yAxisG).call(yAxisFn);
        yAxisG.select('.domain').attr('stroke', colors.axis);
        yAxisG.selectAll('.tick line').attr('stroke', colors.axis);
        yAxisG.selectAll('text').attr('fill', colors.text).style('font-family', 'Montserrat, sans-serif').style('font-size', '10px');

        // Hover overlay (always on top)
        g.selectAll('.overlay').remove();
        const bisect = d3.bisector(d => d.date).left;
        g.append('rect').attr('class', 'overlay')
            .attr('width', w).attr('height', h)
            .attr('fill', 'transparent').style('cursor', 'crosshair')
            .on('mousemove', function(event) {
                const [mx] = d3.pointer(event, this);
                const date = x.invert(mx);
                const idx = bisect(data, date, 1);
                const d0 = data[Math.max(0, idx - 1)];
                const d1 = data[idx] || d0;
                const d = date - d0.date > d1.date - date ? d1 : d0;
                const xPos = x(d.date);
                vline.attr('x1', xPos).attr('x2', xPos).attr('opacity', 1);
                chartTooltip = {
                    visible: true,
                    x: margin.left + xPos,
                    date: frTimeFormat('%-d %b %Y')(d.date),
                    price: fmtPrice(d.price),
                };
            })
            .on('mouseleave', () => {
                vline.attr('opacity', 0);
                chartTooltip = { ...chartTooltip, visible: false };
            });
    }

    $effect(() => {
        activeFuel;
        if (prices) drawChart(true); // animate on fuel change
    });

    onMount(() => {
        const ro = new ResizeObserver(() => { if (prices) drawChart(false); });
        setTimeout(() => { if (chartWrap) ro.observe(chartWrap); }, 0);
        return () => ro.disconnect();
    });

    // ── Helpers ───────────────────────────────────────────────────────────────
    function setFuel(key) {
        activeFuel = key;
        const fuel = FUELS.find(f => f.key === key);
        liters = fuel?.defaultLiters ?? 45;
        sendHeight();
    }

    function adjust(delta) {
        const step = activeFuel === 'mazout' ? 100 : 5;
        liters = Math.max(1, (parseInt(liters) || 0) + delta * step);
    }

    function euros(n) {
        return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function fmtPrice(n, decimals = 3) {
        return n.toLocaleString('fr-BE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }

    function formatDate(iso) {
        const [, m, d] = iso.split('-');
        return `${d}/${m}`;
    }

    const colors = $derived(getColors());
</script>

<div class="widget">

    <!-- ── Header ── -->
    <div class="header">
        <h1 class="title">Prix des carburants en Belgique</h1>
        {#if prices}
            <span class="updated">MAJ {formatDate(prices.lastUpdated)}</span>
        {/if}
    </div>

    <!-- ── Segmented fuel selector ── -->
    <nav class="fuel-tabs" aria-label="Type de carburant">
        {#each FUELS as fuel}
            <button
                class="tab"
                class:active={activeFuel === fuel.key}
                onclick={() => setFuel(fuel.key)}
                aria-pressed={activeFuel === fuel.key}
            >{fuel.label}</button>
        {/each}
    </nav>

    {#if loading}
        <div class="skeleton"></div>
    {:else if error}
        <p class="error-msg">{error}</p>
    {:else}

        <!-- ── Hero price ── -->
        <div class="price-hero">
            {#if heroPrice() != null}
                {#if comparison() != null}
                    {@const cmp = comparison()}
                    <div class="price-row">
                        <p class="price-val">{fmtPrice(heroPrice())}<span class="price-unit"> €/L</span></p>
                        <div
                            class="trend"
                            class:up={cmp.delta > 0}
                            class:down={cmp.delta < 0}
                            class:flat={cmp.delta === 0}
                        >
                            {#if cmp.delta > 0}↑{:else if cmp.delta < 0}↓{/if}
                            {#if cmp.delta !== 0}
                                {cmp.delta > 0 ? '+' : '-'}{fmtPrice(Math.abs(cmp.delta))} €/L
                            {:else}
                                Stable
                            {/if}
                        </div>
                    </div>
                    <p class="price-validity">Tarif valable à partir du {formatDate(cmp.dateB)}</p>
                {:else}
                    <p class="price-val">{fmtPrice(heroPrice())}<span class="price-unit"> €/L</span></p>
                {/if}
            {:else}
                <p class="price-na">—</p>
            {/if}
        </div>

        <!-- ── Calculator ── -->
        <section class="calc-card">
            <p class="calc-label">
                Indiquez une quantité de carburant
            </p>

            <div class="calc-row">
                <button class="adj-btn" onclick={() => adjust(-1)} aria-label="Diminuer">−</button>
                <input
                    type="number"
                    min="1"
                    max={activeFuel === 'mazout' ? 10000 : 200}
                    bind:value={liters}
                    aria-label="Nombre de litres"
                />
                <button class="adj-btn" onclick={() => adjust(1)} aria-label="Augmenter">+</button>
                <span class="unit-label">L</span>
            </div>

            {#if comparison() != null}
                {@const cmp = comparison()}
                {@const costA = parseFloat((cmp.priceA * liters).toFixed(2))}
                {@const costB = parseFloat((cmp.priceB * liters).toFixed(2))}
                {@const labelA = cmp.isTomorrow ? "Aujourd'hui" : 'Hier'}
                {@const labelB = cmp.isTomorrow ? 'Demain' : "Aujourd'hui"}
                {@const mazoutTag = activeFuel === 'mazout' ? (liters >= 2000 ? '≥ 2000 L' : '< 2000 L') : null}

                <div class="cost-card">
                    <div class="cost-row">
                        <span class="cost-label">
                            {labelA}
                            <span class="cost-date">{formatDate(cmp.dateA)}{mazoutTag ? ` · ${mazoutTag}` : ''}</span>
                        </span>
                        <span class="cost-amount">{euros(costA)} €</span>
                    </div>
                    <div class="cost-row" class:featured-up={cmp.delta > 0} class:featured-down={cmp.delta < 0}>
                        <span class="cost-label">
                            {labelB}
                            <span class="cost-date">{formatDate(cmp.dateB)}{mazoutTag ? ` · ${mazoutTag}` : ''}</span>
                        </span>
                        <span class="cost-amount">{euros(costB)} €</span>
                    </div>
                </div>
            {/if}
        </section>

        <!-- ── Chart ── -->
        <section class="chart-section">
            <h2 class="chart-title">Évolution sur 1 an</h2>
            <div class="chart-wrap" bind:this={chartWrap}>
                <svg bind:this={svgEl} style="width:100%;height:100%;display:block;"></svg>
                {#if chartTooltip.visible}
                    <div class="chart-tooltip" style="left:{chartTooltip.x}px">
                        <span class="ct-date">{chartTooltip.date}</span>
                        <span class="ct-price">{chartTooltip.price} €/L</span>
                    </div>
                {/if}
            </div>
        </section>

    {/if}

    <!-- ── Footer ── -->
    <p class="source">
        <a href="https://statbel.fgov.be/fr/themes/energie/prix-du-petrole" target="_blank" rel="noopener">Statbel / SPF Économie</a>
        · Prix maximum TVA incluse
    </p>

</div>

<style>
    /* ══════════════════════════════════════════════════════════════
       Dark-first palette — mirrors app.css convention.
       Light overrides via @media (prefers-color-scheme: light).
       ══════════════════════════════════════════════════════════════ */

    /* ── Base ── */
    .widget {
        padding: 0;
        max-width: 480px;
        margin: 0;
        font-family: 'Montserrat', sans-serif;
        color: #F0F0F1;
        background: #001324;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    /* Standalone (not embedded in a pym iframe): fill the viewport */
    :global(body.standalone) .widget {
        height: 100dvh;
    }

    @media (prefers-color-scheme: light) {
        .widget { color: #2E3238; background: #F7F8FB; }
    }

    /* ── Header ── */
    .header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
    }

    .title {
        font-size: 1rem;
        font-weight: 700;
        margin: 0;
        line-height: 1.3;
    }

    .updated {
        font-size: 0.72rem;
        opacity: 0.45;
        white-space: nowrap;
        flex-shrink: 0;
    }

    /* ── Segmented control ── */
    .fuel-tabs {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        background: rgba(255,255,255,0.08);
        border-radius: 12px;
        padding: 3px;
        gap: 2px;
    }

    @media (prefers-color-scheme: light) {
        .fuel-tabs { background: rgba(0,0,0,0.06); }
    }

    .tab {
        border: none;
        border-radius: 9px;
        padding: 10px 4px;
        font-family: inherit;
        font-size: 0.7rem;
        font-weight: 700;
        cursor: pointer;
        background: transparent;
        color: inherit;
        opacity: 0.55;
        transition: background 0.15s, opacity 0.15s, box-shadow 0.15s;
        white-space: nowrap;
        line-height: 1.2;
    }

    .tab.active {
        background: #1a3a5c;
        opacity: 1;
        color: #4A90E2;
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    }

    @media (prefers-color-scheme: light) {
        .tab.active {
            background: #fff;
            color: #003D60;
            box-shadow: 0 1px 4px rgba(0,0,0,0.14);
        }
    }

    /* ── Hero price ── */
    .price-hero {
        text-align: center;
        padding: 4px 0 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
    }

    .price-row {
        display: flex;
        align-items: center;
        gap: 14px;
    }

    .price-val {
        font-size: 4rem;
        font-weight: 700;
        letter-spacing: -0.03em;
        line-height: 1;
        margin: 0;
    }

    .price-unit {
        font-size: 1.2rem;
        font-weight: 600;
        opacity: 0.55;
    }

    .price-validity {
        font-size: 0.78rem;
        font-weight: 500;
        opacity: 0.5;
        margin: 0;
    }

    .price-na {
        font-size: 3rem;
        opacity: 0.35;
        margin: 0;
    }

    .trend {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 0.82rem;
        font-weight: 700;
        padding: 5px 14px;
        border-radius: 99px;
    }

    .trend.up   { background: rgba(255,107,107,0.15); color: #FF6B6B; }
    .trend.down { background: rgba(78,203,113,0.15);  color: #4ECB71; }
    .trend.flat { background: rgba(255,255,255,0.07); opacity: 0.6; }

    @media (prefers-color-scheme: light) {
        .trend.up   { background: rgba(192,57,43,0.1);  color: #C0392B; }
        .trend.down { background: rgba(26,122,60,0.1);  color: #1A7A3C; }
        .trend.flat { background: rgba(0,0,0,0.05); }
    }

    /* ── Calculator card ── */
    .calc-card {
        background: rgba(255,255,255,0.05);
        border-radius: 18px;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 18px;
    }

    @media (prefers-color-scheme: light) {
        .calc-card { background: rgba(0,0,0,0.03); }
    }

    .calc-label {
        font-size: 0.82rem;
        font-weight: 600;
        margin: 0;
        opacity: 0.65;
        text-align: center;
    }

    .calc-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
    }

    .adj-btn {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 2px solid #4A90E2;
        background: transparent;
        color: #4A90E2;
        font-size: 1.6rem;
        font-weight: 300;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s, color 0.15s;
        flex-shrink: 0;
        line-height: 1;
    }

    .adj-btn:hover, .adj-btn:active {
        background: #4A90E2;
        color: #001324;
    }

    @media (prefers-color-scheme: light) {
        .adj-btn { border-color: #003D60; color: #003D60; }
        .adj-btn:hover, .adj-btn:active { background: #003D60; color: #fff; }
    }

    input[type="number"] {
        width: 80px;
        height: 48px;
        text-align: center;
        font-family: inherit;
        font-size: 1.3rem;
        font-weight: 700;
        border: 2px solid rgba(255,255,255,0.2);
        border-radius: 10px;
        background: transparent;
        color: inherit;
        outline: none;
        appearance: textfield;
        -moz-appearance: textfield;
    }

    input[type="number"]::-webkit-outer-spin-button,
    input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

    @media (prefers-color-scheme: light) {
        input[type="number"] { border-color: rgba(0,0,0,0.12); }
    }

    .unit-label {
        font-size: 0.9rem;
        font-weight: 700;
        opacity: 0.45;
    }

    /* ── Cost comparison card ── */
    .cost-card {
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 14px;
        overflow: hidden;
    }

    @media (prefers-color-scheme: light) {
        .cost-card { background: #fff; border-color: rgba(0,0,0,0.08); }
    }

    .cost-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 13px 16px;
        font-size: 0.88rem;
    }

    .cost-row + .cost-row {
        border-top: 1px solid rgba(255,255,255,0.07);
    }

    @media (prefers-color-scheme: light) {
        .cost-row + .cost-row { border-top-color: rgba(0,0,0,0.06); }
    }

    .cost-label {
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .cost-date {
        font-weight: 400;
        opacity: 0.45;
        font-size: 0.75rem;
    }

    .cost-amount {
        font-weight: 700;
        font-size: 1rem;
    }

    .cost-row.featured-up .cost-amount {
        background: rgba(255,107,107,0.18);
        color: #FF6B6B;
        padding: 3px 8px;
        border-radius: 6px;
    }

    .cost-row.featured-down .cost-amount {
        background: rgba(78,203,113,0.18);
        color: #4ECB71;
        padding: 3px 8px;
        border-radius: 6px;
    }

    @media (prefers-color-scheme: light) {
        .cost-row.featured-up .cost-amount   { background: rgba(192,57,43,0.1);  color: #C0392B; }
        .cost-row.featured-down .cost-amount { background: rgba(26,122,60,0.1);  color: #1A7A3C; }
    }

    /* ── Chart ── */
    .chart-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    .chart-title {
        font-size: 0.72rem;
        font-weight: 700;
        opacity: 0.45;
        margin: 0 0 6px;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        flex-shrink: 0;
    }

    .chart-wrap {
        flex: 1;
        width: 100%;
        min-height: 80px;
        position: relative;
    }

    .chart-tooltip {
        position: absolute;
        top: 0;
        transform: translateX(-50%);
        background: #0d2d45;
        color: #F0F0F1;
        border-radius: 7px;
        padding: 5px 10px;
        font-size: 0.75rem;
        white-space: nowrap;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }

    .ct-date  { font-weight: 400; opacity: 0.65; font-size: 0.68rem; }
    .ct-price { font-weight: 700; }

    @media (prefers-color-scheme: light) {
        .chart-tooltip {
            background: #fff;
            color: #2E3238;
            border: 1px solid rgba(0,0,0,0.09);
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
    }

    /* ── Skeleton ── */
    .skeleton {
        height: 320px;
        border-radius: 18px;
        background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.03) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
    }

    @keyframes shimmer {
        0%   { background-position: 200% 0; }
        100% { background-position: -200% 0; }
    }

    @media (prefers-color-scheme: light) {
        .skeleton {
            background: linear-gradient(90deg, rgba(0,0,0,0.04) 25%, rgba(0,0,0,0.08) 50%, rgba(0,0,0,0.04) 75%);
            background-size: 200% 100%;
        }
    }

    /* ── Error ── */
    .error-msg { color: #FF6B6B; font-size: 0.85rem; margin: 0; }

    @media (prefers-color-scheme: light) {
        .error-msg { color: #C0392B; }
    }

    /* ── Source ── */
    .source {
        font-size: 0.68rem;
        opacity: 0.38;
        margin: 0;
        text-align: center;
        line-height: 1.6;
    }

    .source a { color: inherit; }
</style>
