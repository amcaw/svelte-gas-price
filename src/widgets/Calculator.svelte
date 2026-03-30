<script>
    import { onMount, untrack } from 'svelte';
    import * as d3 from 'd3';
    import { initPym, sendHeight } from '../lib/pym.js';
    import { loadPrices, loadHistorical, getClosestPrice } from '../lib/data.js';
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
        { key: 'essence95',  label: 'Essence 95' },
        { key: 'essence98',  label: 'Essence 98' },
        { key: 'diesel',     label: 'Diesel' },
        { key: 'mazout',     label: 'Mazout' },
    ];

    // ── State ─────────────────────────────────────────────────────────────────
    let activeFuel   = $state('essence95');
    let liters       = $state(50);   // shared across essence95/98/diesel
    let litersMazout = $state(1000); // separate for mazout
    let prices       = $state(null);
    let loading      = $state(true);
    let error        = $state(null);
    let chartRange   = $state('1y');   // '1y' | '3y' | '5y'
    let historical   = $state(null);   // loaded on demand
    let histLoading  = $state(false);

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
    // Active liters value — shared for essence/diesel, separate for mazout
    const activeliters = $derived(activeFuel === 'mazout' ? litersMazout : liters);

    function fuelKey(fuel, litersVal) {
        if (fuel === 'mazout') return litersVal >= 2000 ? 'mazout_plus' : 'mazout';
        return fuel;
    }

    // Actual current date in YYYY-MM-DD (browser clock, not API date)
    const todayISO = new Date().toLocaleDateString('sv'); // 'sv' locale gives YYYY-MM-DD
    const yesterdayISO = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('sv'); })();
    const tomorrowISO = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('sv'); })();

    /** Returns a relative label for a date string: Hier, Aujourd'hui, Demain, or the formatted date */
    function relativeLabel(dateStr) {
        if (dateStr === todayISO) return "Aujourd'hui";
        if (dateStr === yesterdayISO) return 'Hier';
        if (dateStr === tomorrowISO) return 'Demain';
        return formatDate(dateStr);
    }

    // Today's current official price
    const todayPrice = $derived(() => {
        if (!prices) return null;
        return prices.today[fuelKey(activeFuel, activeliters)] ?? null;
    });

    // Comparison: previous daily vs current (SPF today or last daily)
    const comparison = $derived(() => {
        if (!prices || prices.daily.length < 2) return null;
        const fk = fuelKey(activeFuel, activeliters);
        // Use SPF today price as entryB when it's newer than the last daily entry
        const lastDaily = prices.daily.at(-1);
        const spfDate = prices.priceDate;
        const useSpf = spfDate && spfDate > lastDaily.date && prices.today[fk] != null;
        const entryB = useSpf
            ? { date: spfDate, [fk]: prices.today[fk] }
            : lastDaily;
        const entryA = useSpf ? lastDaily : prices.daily.at(-2);
        if (entryA[fk] == null || entryB[fk] == null) return null;
        const delta = parseFloat((entryB[fk] - entryA[fk]).toFixed(4));
        return {
            dateA:  entryA.date, priceA: entryA[fk],
            dateB:  entryB.date, priceB: entryB[fk],
            samePrice: entryA[fk] === entryB[fk],
            delta,
        };
    });

    // Hero = always the most recent entry (entryB), which may be tomorrow
    const heroPrice = $derived(() => {
        const cmp = comparison();
        return cmp ? cmp.priceB : todayPrice();
    });

    // Year-over-year: price for each comparison date, 1 year back
    const yearAgo = $derived(() => {
        if (!prices) return null;
        const cmp = comparison();
        if (!cmp) return null;
        const fk = fuelKey(activeFuel, activeliters);
        function shiftYear(dateStr) {
            const d = new Date(dateStr);
            d.setFullYear(d.getFullYear() - 1);
            return d.toLocaleDateString('sv');
        }
        return {
            priceYearAgoA: getClosestPrice(prices, fk, shiftYear(cmp.dateA)),
            priceYearAgoB: getClosestPrice(prices, fk, shiftYear(cmp.dateB)),
        };
    });

    // Chart key — follows mazout threshold (< vs ≥ 2000 L)
    const activeChartKey = $derived(() => fuelKey(activeFuel, activeliters));

    // Chart data — merges historical + monthly bridge + daily depending on chartRange
    const chartData = $derived(() => {
        if (!prices) return [];
        const chartKey = activeChartKey();
        const parse = d3.timeParse('%Y-%m-%d');

        const dailyEntries = prices.daily
            .filter(d => d[chartKey] != null)
            .map(d => ({ date: parse(d.date), price: d[chartKey] }));

        // Append SPF today price if it's newer than the last daily entry
        const lastDailyDate = prices.daily.at(-1)?.date;
        if (prices.priceDate && prices.priceDate > lastDailyDate && prices.today[chartKey] != null) {
            dailyEntries.push({ date: parse(prices.priceDate), price: prices.today[chartKey] });
        }

        if (chartRange === '1y') return dailyEntries;

        const cutoffDate = new Date();
        cutoffDate.setFullYear(cutoffDate.getFullYear() - (chartRange === '3y' ? 3 : 5));
        const cutoffISO = cutoffDate.toLocaleDateString('sv');

        // Daily window start — monthly data bridges any gap before it
        const dailyStartISO = dailyEntries.length > 0 ? dailyEntries[0].date.toLocaleDateString('sv') : null;

        // Monthly averages as bridge (covers last 24 months, fills gap between historical and daily)
        const monthlyEntries = prices.monthly
            .filter(m => {
                if (m[chartKey] == null) return false;
                const iso = `${m.year}-${String(m.month).padStart(2,'0')}-01`;
                return iso >= cutoffISO && (!dailyStartISO || iso < dailyStartISO);
            })
            .map(m => ({
                date: parse(`${m.year}-${String(m.month).padStart(2,'0')}-01`),
                price: m[chartKey],
            }));

        if (!historical) {
            const merged = [...monthlyEntries, ...dailyEntries];
            merged.sort((a, b) => a.date - b.date);
            return merged;
        }

        const historicalEntries = historical.entries
            .filter(d => d[chartKey] != null && d.date >= cutoffISO)
            .map(d => ({ date: parse(d.date), price: d[chartKey] }));

        // Historical end — monthly bridge fills any gap between historical end and daily start
        const histEndISO = historicalEntries.length > 0 ? historicalEntries.at(-1).date.toLocaleDateString('sv') : null;
        const bridgeMonthly = monthlyEntries.filter(d => !histEndISO || d.date.toLocaleDateString('sv') > histEndISO);

        const seenDaily = new Set(dailyEntries.map(d => d.date.toISOString()));
        const merged = [
            ...historicalEntries.filter(d => !seenDaily.has(d.date.toISOString())),
            ...bridgeMonthly,
            ...dailyEntries,
        ];
        merged.sort((a, b) => a.date - b.date);
        return merged;
    });

    // Denomination change markers within current chart range
    const denominationMarkers = $derived(() => {
        if (!historical?.denominationChanges?.length) return [];
        const parse = d3.timeParse('%Y-%m-%d');
        const chartKey = activeChartKey();
        return historical.denominationChanges
            .filter(c => !c.fuels || c.fuels.includes(chartKey))
            .map(c => ({ date: parse(c.date), label: c.label }))
            .filter(c => c.date != null);
    });

    // ── Draw chart ────────────────────────────────────────────────────────────
    // animate: true = D3 data transition | 'fade' = fade out/in (for range change) | false = instant
    function drawChart(animate = false) {
        if (!svgEl || !chartWrap) return;
        const data = chartData();
        if (data.length < 2) return;

        if (animate === 'fade') {
            const svg = d3.select(svgEl);
            // Remove any leftover old group from a previous interrupted crossfade
            svg.selectAll('g.chart-old').interrupt().remove();
            // Rename current group so _drawChartInner creates a fresh one
            const oldG = svg.select('g.chart-g');
            if (!oldG.empty()) oldG.attr('class', 'chart-old');
            // Draw new content (creates g.chart-g at default opacity 1)
            _drawChartInner(false);
            // Start new group invisible, then fade it in
            const newG = svg.select('g.chart-g').style('opacity', 0);
            // Crossfade: old out, new in simultaneously
            oldG.transition('xfade').duration(260).style('opacity', 0).on('end', () => oldG.remove());
            newG.transition('xfade').duration(260).style('opacity', 1);
            return;
        }
        _drawChartInner(animate);
    }

    function _drawChartInner(animate) {
        const data = chartData();
        const colors = getColors();
        const fuelColor = colors[activeFuel === 'mazout' ? 'mazout' : activeFuel] ?? colors.essence95;
        const duration = animate ? 450 : 0;

        const margin = { top: 12, right: 46, bottom: 22, left: 38 };
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

        // Grid — horizontal lines only, no domain
        const gridFn = d3.axisLeft(y).ticks(3).tickSize(-w).tickFormat('');
        let gridG = g.select('g.grid');
        if (gridG.empty()) gridG = g.insert('g', ':first-child').attr('class', 'grid');
        (animate ? gridG.transition().duration(duration) : gridG).call(gridFn);
        gridG.select('.domain').remove();
        gridG.selectAll('.tick line')
            .attr('stroke', colors.grid)
            .attr('stroke-dasharray', '3 3');

        // Ukraine war highlight band (24 Feb 2022 – 24 Aug 2022)
        g.selectAll('.war-band').remove();
        const warStart = new Date('2022-02-24');
        const warEnd   = new Date('2022-08-24');
        const [xMin, xMax] = x.domain();
        if (warEnd >= xMin && warStart <= xMax) {
            const bx1 = x(Math.max(warStart, xMin));
            const bx2 = x(Math.min(warEnd,   xMax));
            g.insert('rect', ':first-child').attr('class', 'war-band')
                .attr('x', bx1).attr('y', 0)
                .attr('width', bx2 - bx1).attr('height', h)
                .attr('fill', 'rgba(180,180,180,0.22)')
                .attr('pointer-events', 'none');
        }

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

        // X-axis — text only, no domain line, no tick marks
        const xTickInterval = chartRange === '5y' ? d3.timeYear.every(1)
                            : chartRange === '3y' ? d3.timeMonth.every(6)
                            : d3.timeMonth.every(2);
        const xTickFormat = chartRange === '5y' ? frTimeFormat('%Y') : frTimeFormat('%b %y');
        g.selectAll('.x-axis').remove();
        g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${h + 4})`)
            .call(d3.axisBottom(x).ticks(xTickInterval).tickFormat(xTickFormat).tickSize(0))
            .call(ax => ax.select('.domain').remove())
            .call(ax => ax.selectAll('text')
                .attr('fill', colors.text).attr('opacity', 0.45)
                .style('font-family', 'Montserrat, sans-serif').style('font-size', '10px'));

        // Y-axis — labels outside left edge, no domain line, no tick marks
        g.selectAll('.y-label').remove();
        y.ticks(3).forEach(t => {
            g.append('text').attr('class', 'y-label')
                .attr('x', -5).attr('y', y(t) + 3)
                .attr('fill', colors.text).attr('opacity', 0.4)
                .style('font-family', 'Montserrat, sans-serif').style('font-size', '9px')
                .attr('text-anchor', 'end')
                .text(t.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '€');
        });

        // End-of-line dot + current price label
        g.selectAll('.end-label').remove();
        const lastD = data[data.length - 1];
        const ex = x(lastD.date);
        const ey = y(lastD.price);
        g.append('circle').attr('class', 'end-label')
            .attr('cx', ex).attr('cy', ey).attr('r', 2.5)
            .attr('fill', fuelColor);
        g.append('text').attr('class', 'end-label')
            .attr('x', ex + 6).attr('y', ey + 4)
            .attr('fill', fuelColor)
            .style('font-family', 'Montserrat, sans-serif').style('font-size', '10px').style('font-weight', '600')
            .text(lastD.price.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '€');

        // Denomination change markers
        g.selectAll('.denom-marker').remove();
        const markers = denominationMarkers();
        for (const m of markers) {
            const xm = x(m.date);
            if (xm < 0 || xm > w) continue;
            g.append('line').attr('class', 'denom-marker')
                .attr('x1', xm).attr('x2', xm).attr('y1', 0).attr('y2', h)
                .attr('stroke', colors.axis).attr('stroke-dasharray', '3 3')
                .attr('stroke-width', 1).attr('opacity', 0.5);
            g.append('text').attr('class', 'denom-marker')
                .attr('x', xm + 3).attr('y', 10)
                .attr('fill', colors.text).attr('font-size', '9px')
                .attr('font-family', 'Montserrat, sans-serif').attr('opacity', 0.55)
                .text(m.label);
        }

        // Curved arrow annotation — persistent group outside chart-g (not affected by crossfade)
        {
            // Arrowhead marker (defs, once per svg)
            let defs = svg.select('defs.annot-defs');
            if (defs.empty()) {
                defs = svg.insert('defs', ':first-child').attr('class', 'annot-defs');
                defs.append('marker').attr('id', 'annot-arrow')
                    .attr('viewBox', '0 -4 8 8').attr('refX', 7).attr('refY', 0)
                    .attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto')
                    .append('path').attr('d', 'M0,-4L8,0L0,4').attr('class', 'annot-marker-path');
            }
            svg.select('.annot-marker-path').attr('fill', colors.text).attr('opacity', 0.8);

            // Persistent group — always re-appended last so it stays on top
            let annotG = svg.select('g.annot-g');
            if (annotG.empty()) annotG = svg.append('g').attr('class', 'annot-g');
            else svg.append(() => annotG.node());
            annotG.attr('transform', `translate(${margin.left},${margin.top})`);

            const annotDate = new Date('2026-02-28');
            const [xMinA, xMaxA] = x.domain();
            const annotVisible = annotDate >= xMinA && annotDate <= xMaxA;
            const annotDur = 350;

            if (annotVisible) {
                const bisectA = d3.bisector(d => d.date).left;
                const ai = bisectA(data, annotDate, 1);
                const da = (data[ai - 1] && Math.abs(data[ai - 1].date - annotDate) <= Math.abs((data[ai] || data[ai-1]).date - annotDate))
                    ? data[ai - 1] : (data[ai] || data[ai - 1]);
                const ax = x(annotDate);
                const ay = y(da.price);
                const labelOffX = ax > w * 0.6 ? -52 : 52;
                const labelOffY = -38;
                const lx = ax + labelOffX;
                const ly = ay + labelOffY;
                const cpx = ax + labelOffX * 0.3;
                const cpy = ay + labelOffY * 0.6;
                const pathD = `M${lx},${ly} Q${cpx},${cpy} ${ax},${ay - 3}`;
                const anchor = labelOffX > 0 ? 'start' : 'end';

                // Path — create once, transition position on update
                let annotPath = annotG.select('path.annot');
                if (annotPath.empty()) {
                    annotPath = annotG.append('path').attr('class', 'annot')
                        .attr('d', pathD).attr('fill', 'none').attr('stroke', colors.text)
                        .attr('stroke-width', 1).attr('opacity', 0).attr('marker-end', 'url(#annot-arrow)');
                    annotPath.transition('annot').duration(annotDur).attr('opacity', 0.6);
                } else {
                    annotPath.transition('annot').duration(annotDur)
                        .attr('d', pathD).attr('stroke', colors.text).attr('opacity', 0.6);
                }

                // Text — create once, transition position on update
                let annotText = annotG.select('text.annot');
                if (annotText.empty()) {
                    annotText = annotG.append('text').attr('class', 'annot')
                        .attr('x', lx).attr('y', ly - 10).attr('text-anchor', anchor)
                        .attr('fill', colors.text).attr('opacity', 0)
                        .attr('font-size', '8px').attr('font-family', 'Montserrat, sans-serif');
                    annotText.append('tspan').attr('x', lx).attr('dy', 0).text('Début offensive');
                    annotText.append('tspan').attr('x', lx).attr('dy', '1.2em').text('USA-Israël vs. Iran');
                    annotText.transition('annot').duration(annotDur).attr('opacity', 0.7);
                } else {
                    annotText.transition('annot').duration(annotDur)
                        .attr('x', lx).attr('y', ly - 10).attr('text-anchor', anchor)
                        .attr('fill', colors.text).attr('opacity', 0.7);
                    annotText.selectAll('tspan').attr('x', lx);
                }
            } else {
                annotG.select('path.annot').transition('annot').duration(200).attr('opacity', 0)
                    .on('end', function() { d3.select(this).remove(); });
                annotG.select('text.annot').transition('annot').duration(200).attr('opacity', 0)
                    .on('end', function() { d3.select(this).remove(); });
            }
        }

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
                    price: fmtPrice(d.price, 2),
                };
            })
            .on('mouseleave', () => {
                vline.attr('opacity', 0);
                chartTooltip = { ...chartTooltip, visible: false };
            });
    }

    // Redraw on fuel/liter change (animated)
    $effect(() => {
        activeChartKey();
        untrack(() => { if (prices && chartWrap) drawChart(true); });
    });

    // Attach ResizeObserver once chartWrap is in the DOM (after prices loads).
    // ResizeObserver fires once on attach, giving correct clientWidth for initial draw.
    $effect(() => {
        if (!chartWrap) return;
        const ro = new ResizeObserver(() => untrack(() => { if (prices) drawChart(false); }));
        ro.observe(chartWrap);
        return () => ro.disconnect();
    });

    // ── Helpers ───────────────────────────────────────────────────────────────
    async function setChartRange(range) {
        if (range !== '1y' && !historical && !histLoading) {
            histLoading = true;
            try { historical = await loadHistorical(); }
            catch (e) { chartRange = '1y'; histLoading = false; return; }
            histLoading = false;
        }
        chartRange = range;
        drawChart('fade');
        sendHeight();
    }

    function setFuel(key) {
        activeFuel = key;
        sendHeight();
    }

    function adjust(delta) {
        if (activeFuel === 'mazout') {
            litersMazout = Math.min(6000, Math.max(1, (parseInt(litersMazout) || 0) + delta * 100));
        } else {
            liters = Math.min(100, Math.max(1, (parseInt(liters) || 0) + delta * 5));
        }
    }

    function euros(n) {
        return n.toLocaleString('fr-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }

    function eurosCompact(n) {
        return n.toLocaleString('fr-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }

    function fmtPrice(n, decimals = 3) {
        return n.toLocaleString('fr-BE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }

    function formatDate(iso) {
        const [, m, d] = iso.split('-');
        return `${d}/${m}`;
    }

    const colors = $derived(getColors());

    const priceDateLabel = $derived(() => {
        if (!prices) return null;
        const d = prices.priceDate ?? prices.lastUpdated; // YYYY-MM-DD
        const label = formatDate(d);
        const rel = relativeLabel(d);
        // If relativeLabel returned a known tag (Hier/Aujourd'hui/Demain), use it in parens
        // Otherwise just show "dernier tarif en vigueur" for older dates
        const isRelative = ["Aujourd'hui", 'Hier', 'Demain'].includes(rel);
        const tag = isRelative ? rel.toLowerCase() : 'dernier tarif en vigueur';
        return `pour le ${label} (${tag})`;
    });
</script>

<div class="widget">

    <!-- ── Header ── -->
    <div class="header">
        <h1 class="title">
            Prix maximum des carburants en Belgique
            {#if priceDateLabel()}<span class="title-date">{priceDateLabel()}</span>{/if}
        </h1>
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
                        <p class="price-val">{fmtPrice(heroPrice(), 2)}<span class="price-unit"> €/L</span></p>
                        <p
                            class="trend"
                            class:up={cmp.delta > 0}
                            class:down={cmp.delta < 0}
                            class:flat={cmp.delta === 0}
                        >
                            {#if cmp.delta > 0}↑{:else if cmp.delta < 0}↓{/if}
                            {#if cmp.delta !== 0}{cmp.delta > 0 ? '+' : '-'}{fmtPrice(Math.abs(cmp.delta), 2)} €/L{:else}Stable{/if}
                            <span class="trend-label">· par rapport à la veille</span>
                        </p>
                    </div>
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
                {activeFuel === 'mazout' ? 'Indiquez une quantité de combustible' : 'Indiquez une quantité de carburant'}
            </p>

            <div class="calc-row">
                <button class="adj-btn" onclick={() => adjust(-1)} aria-label="Diminuer">−</button>
                <div class="input-wrap" class:input-wrap-mazout={activeFuel === 'mazout'}>
                    <input
                        type="number"
                        min="1"
                        max={activeFuel === 'mazout' ? 6000 : 100}
                        value={activeliters}
                        aria-label="Nombre de litres"
                        oninput={(e) => {
                            const max = activeFuel === 'mazout' ? 6000 : 100;
                            const v = Math.min(max, Math.max(1, parseInt(e.target.value) || 1));
                            if (activeFuel === 'mazout') { litersMazout = v; } else { liters = v; }
                            e.target.value = v;
                        }}
                    />
                    <span class="unit-label">L</span>
                </div>
                <button class="adj-btn" onclick={() => adjust(1)} aria-label="Augmenter">+</button>
            </div>

            {#if comparison() != null}
                {@const cmp = comparison()}
                {@const costA = parseFloat((cmp.priceA * activeliters).toFixed(2))}
                {@const costB = parseFloat((cmp.priceB * activeliters).toFixed(2))}
                {@const labelA = relativeLabel(cmp.dateA)}
                {@const labelB = relativeLabel(cmp.dateB)}
                {@const mazoutTag = activeFuel === 'mazout' ? (activeliters >= 2000 ? '≥ 2000 L' : '< 2000 L') : null}

                {@const ya = yearAgo()}
                {@const diffA = ya?.priceYearAgoA != null ? parseFloat((costA - ya.priceYearAgoA * activeliters).toFixed(2)) : null}
                {@const pctA  = diffA != null ? Math.round((diffA / (ya.priceYearAgoA * activeliters)) * 100) : null}
                {@const diffB = ya?.priceYearAgoB != null ? parseFloat((costB - ya.priceYearAgoB * activeliters).toFixed(2)) : null}
                {@const pctB  = diffB != null ? Math.round((diffB / (ya.priceYearAgoB * activeliters)) * 100) : null}
                <div class="cost-card">
                    <div class="cost-row">
                        <span class="cost-label">
                            {labelA}
                            <span class="cost-date">{formatDate(cmp.dateA)}{mazoutTag ? ` · ${mazoutTag}` : ''}</span>
                        </span>
                        <span class="cost-amount-col">
                            <span class="cost-amount">{activeliters > 0 ? euros(costA) + ' €' : '—'}</span>
                            {#if diffA != null && activeliters > 0 && !isNaN(pctA)}
                                <span class="ya-sub" class:ya-up={diffA > 0} class:ya-down={diffA < 0}>
                                    {diffA > 0 ? '+' : ''}{eurosCompact(diffA)} € ({pctA > 0 ? '+' : ''}{pctA}%)
                                </span>
                                <span class="ya-label">par rapport à l'an dernier</span>
                            {:else if ya?.priceYearAgoA != null}
                                <span class="ya-sub">—%</span>
                                <span class="ya-label">par rapport à l'an dernier</span>
                            {/if}
                        </span>
                    </div>
                    <div class="cost-row" class:featured-up={cmp.delta > 0} class:featured-down={cmp.delta < 0}>
                        <span class="cost-label">
                            {labelB}
                            <span class="cost-date">{formatDate(cmp.dateB)}{mazoutTag ? ` · ${mazoutTag}` : ''}</span>
                        </span>
                        <span class="cost-amount-col">
                            <span class="cost-amount">{activeliters > 0 ? euros(costB) + ' €' : '—'}</span>
                            {#if diffB != null && activeliters > 0 && !isNaN(pctB)}
                                <span class="ya-sub" class:ya-up={diffB > 0} class:ya-down={diffB < 0}>
                                    {diffB > 0 ? '+' : ''}{eurosCompact(diffB)} € ({pctB > 0 ? '+' : ''}{pctB}%)
                                </span>
                                <span class="ya-label">par rapport à l'an dernier</span>
                            {:else if ya?.priceYearAgoB != null}
                                <span class="ya-sub">—%</span>
                                <span class="ya-label">par rapport à l'an dernier</span>
                            {/if}
                        </span>
                    </div>
                </div>
            {/if}
        </section>

        <!-- ── Chart ── -->
        <section class="chart-section">
            <div class="chart-header">
                <div class="chart-title-row">
                    <div>
                        <div class="chart-title-line">
                            <h2 class="chart-title">
                                Évolution sur {chartRange === '1y' ? '1 an' : chartRange === '3y' ? '3 ans' : '5 ans'}
                            </h2>
                            {#if activeFuel === 'mazout'}
                                <span class="info-icon" aria-label="Note sur le mazout">ⓘ
                                    <span class="info-tooltip">Prix affiché : gasoil de chauffage H0/H7 (norme NBN T52-716, depuis avril 2024). Avant cette date, ce sont les prix pour «&nbsp;Gasoil Diesel Chauffage&nbsp;» qui s'affichent.</span>
                                </span>
                            {/if}
                        </div>
                        {#if activeFuel === 'mazout'}
                            <p class="chart-subtitle">Mazout ordinaire · livraison {activeliters >= 2000 ? '≥ 2000 L' : '< 2000 L'}</p>
                        {/if}
                    </div>
                </div>
                <div class="range-tabs">
                    {#each [['1y','1 an'],['3y','3 ans'],['5y','5 ans']] as [r, label]}
                        <button
                            class="range-tab"
                            class:active={chartRange === r}
                            onclick={() => setChartRange(r)}
                        >{label}</button>
                    {/each}
                </div>
            </div>
            <div class="chart-legend" style:visibility={chartRange === '5y' ? 'visible' : 'hidden'}>
                <span class="war-swatch"></span>
                <span class="war-label">6 premiers mois de la guerre en Ukraine</span>
            </div>
            <div class="chart-wrap" bind:this={chartWrap}>
                <svg bind:this={svgEl} style="width:100%;height:100%;display:block;"></svg>
                {#if histLoading}
                    <div class="hist-loading">Chargement…</div>
                {/if}
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
        Source : <a href="https://statbel.fgov.be/fr/themes/energie/prix-du-petrole" target="_blank" rel="noopener">Statbel / SPF Économie</a>
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
    .title-date {
        display: block;
        font-size: 0.72rem;
        font-weight: 500;
        opacity: 0.5;
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
        flex-direction: column;
        align-items: center;
        gap: 4px;
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



    /* ── Year-ago sub-line (solution A) ── */
    .cost-amount-col {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
    }

    .ya-sub {
        font-size: 0.68rem;
        font-weight: 600;
        opacity: 0.55;
    }

    .ya-sub.ya-up   { color: #FF6B6B; opacity: 1; }
    .ya-sub.ya-down { color: #4ECB71; opacity: 1; }

    @media (prefers-color-scheme: light) {
        .ya-sub.ya-up   { color: #C0392B; }
        .ya-sub.ya-down { color: #1A7A3C; }
    }

    .ya-label {
        font-size: 0.6rem;
        font-weight: 400;
        opacity: 0.38;
        text-align: right;
    }

    .price-na {
        font-size: 3rem;
        opacity: 0.35;
        margin: 0;
    }

    .trend {
        margin: 0;
        font-size: 0.78rem;
        font-weight: 600;
    }

    .trend.up   { color: #FF6B6B; }
    .trend.down { color: #4ECB71; }
    .trend.flat { opacity: 0.45; }
    .trend-label { font-weight: 400; opacity: 0.6; }

    @media (prefers-color-scheme: light) {
        .trend.up   { color: #C0392B; }
        .trend.down { color: #1A7A3C; }
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
        line-height: 0;
        padding-top: 1px;
    }

    .adj-btn:hover, .adj-btn:active {
        background: #4A90E2;
        color: #001324;
    }

    @media (prefers-color-scheme: light) {
        .adj-btn { border-color: #003D60; color: #003D60; }
        .adj-btn:hover, .adj-btn:active { background: #003D60; color: #fff; }
    }

    .input-wrap {
        display: inline-flex;
        align-items: center;
        gap: 1px;
        border: 2px solid rgba(255,255,255,0.2);
        border-radius: 10px;
        padding: 0 12px;
        height: 48px;
        min-width: 90px;
    }
    .input-wrap-mazout { min-width: 120px; }

    @media (prefers-color-scheme: light) {
        .input-wrap { border-color: rgba(0,0,0,0.12); }
    }

    input[type="number"] {
        flex: 1;
        min-width: 0;
        text-align: right;
        font-family: inherit;
        font-size: 1.3rem;
        font-weight: 700;
        border: none;
        background: transparent;
        color: inherit;
        outline: none;
        appearance: textfield;
        -moz-appearance: textfield;
    }

    input[type="number"]::-webkit-outer-spin-button,
    input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

    .unit-label {
        font-size: 1.3rem;
        font-weight: 700;
        opacity: 0.4;
        pointer-events: none;
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
        flex-direction: column;
        align-items: flex-start;
        gap: 1px;
    }

    .cost-date {
        display: block;
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

    .chart-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
        flex-shrink: 0;
    }

    .chart-title-line {
        display: flex;
        align-items: center;
        gap: 5px;
    }
    .chart-title {
        font-size: 0.72rem;
        font-weight: 700;
        opacity: 0.45;
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.07em;
    }
    .chart-subtitle {
        font-size: 0.65rem;
        font-weight: 500;
        opacity: 0.4;
        margin: 1px 0 0;
        letter-spacing: 0.03em;
    }

    .range-tabs {
        display: flex;
        gap: 2px;
        background: rgba(255,255,255,0.06);
        border-radius: 8px;
        padding: 2px;
    }

    @media (prefers-color-scheme: light) {
        .range-tabs { background: rgba(0,0,0,0.05); }
    }

    .range-tab {
        border: none;
        border-radius: 6px;
        padding: 3px 8px;
        font-family: inherit;
        font-size: 0.65rem;
        font-weight: 700;
        cursor: pointer;
        background: transparent;
        color: inherit;
        opacity: 0.5;
        transition: background 0.12s, opacity 0.12s;
    }

    .range-tab.active {
        background: #1a3a5c;
        opacity: 1;
        color: #4A90E2;
    }

    @media (prefers-color-scheme: light) {
        .range-tab.active { background: #fff; color: #003D60; }
    }

    .hist-loading {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.72rem;
        opacity: 0.45;
        pointer-events: none;
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

    /* ── Chart legend (war band) ── */
    .chart-legend {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
    }

    .war-swatch {
        display: inline-block;
        width: 14px;
        height: 10px;
        border-radius: 3px;
        background: rgba(180, 180, 180, 0.38);
        border: 1px solid rgba(180, 180, 180, 0.65);
        flex-shrink: 0;
    }

    .war-label {
        font-size: 0.62rem;
        opacity: 0.5;
        line-height: 1;
    }

    /* ── Chart info icon + tooltip ── */
    .chart-title-row {
        display: flex;
        align-items: center;
        gap: 5px;
    }

    .info-icon {
        position: relative;
        display: inline-flex;
        align-items: center;
        font-size: 1rem;
        color: rgba(74, 144, 226, 0.65);
        cursor: default;
        flex-shrink: 0;
    }

    @media (prefers-color-scheme: light) {
        .info-icon { color: rgba(0, 61, 96, 0.55); }
    }

    .info-tooltip {
        display: none;
        position: absolute;
        bottom: calc(100% + 6px);
        left: 0;
        width: 220px;
        background: #0d2d45;
        color: #F0F0F1;
        font-size: 0.62rem;
        font-weight: 400;
        line-height: 1.5;
        padding: 8px 10px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.4);
        text-transform: none;
        letter-spacing: 0;
        pointer-events: none;
        z-index: 10;
    }

    .info-icon:hover .info-tooltip,
    .info-icon:focus .info-tooltip {
        display: block;
    }

    @media (prefers-color-scheme: light) {
        .info-tooltip {
            background: #fff;
            color: #2E3238;
            border: 1px solid rgba(0,0,0,0.09);
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
    }

    /* ── Source ── */
    .source {
        font-size: 0.68rem;
        opacity: 0.38;
        margin: 0;
        text-align: right;
        line-height: 1.6;
    }

    .source a { color: inherit; }
</style>
