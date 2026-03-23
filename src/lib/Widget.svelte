<script>
    import { onMount } from 'svelte';
    import * as d3 from 'd3';

    let { onrendered = () => {} } = $props();

    // ── Theme detection ──────────────────────────────────────────────────────
    const darkMode = () =>
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;

    function getColors() {
        const dark = darkMode();
        return {
            gasoline:   dark ? '#E63946' : '#B82D35',   // warm — essence 95
            diesel:     dark ? '#4A90E2' : '#053061',   // cool  — diesel
            text:       dark ? '#F0F0F1' : '#2E3238',
            background: dark ? '#001324' : '#F7F8FB',
            grid:       dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
            axis:       dark ? 'rgba(255,255,255,0.4)'  : 'rgba(0,0,0,0.4)',
            tooltip:    dark ? '#0a2a40' : '#ffffff',
        };
    }

    // ── Placeholder data — monthly Belgian pump prices (€/L) ────────────────
    // Replace with real API / CSV data as needed
    const raw = [
        { date: '2023-01', gasoline: 1.782, diesel: 1.715 },
        { date: '2023-02', gasoline: 1.798, diesel: 1.698 },
        { date: '2023-03', gasoline: 1.820, diesel: 1.672 },
        { date: '2023-04', gasoline: 1.804, diesel: 1.643 },
        { date: '2023-05', gasoline: 1.756, diesel: 1.598 },
        { date: '2023-06', gasoline: 1.721, diesel: 1.556 },
        { date: '2023-07', gasoline: 1.742, diesel: 1.572 },
        { date: '2023-08', gasoline: 1.798, diesel: 1.623 },
        { date: '2023-09', gasoline: 1.836, diesel: 1.681 },
        { date: '2023-10', gasoline: 1.812, diesel: 1.695 },
        { date: '2023-11', gasoline: 1.778, diesel: 1.658 },
        { date: '2023-12', gasoline: 1.752, diesel: 1.632 },
        { date: '2024-01', gasoline: 1.764, diesel: 1.648 },
        { date: '2024-02', gasoline: 1.789, diesel: 1.661 },
        { date: '2024-03', gasoline: 1.823, diesel: 1.687 },
        { date: '2024-04', gasoline: 1.841, diesel: 1.702 },
        { date: '2024-05', gasoline: 1.815, diesel: 1.679 },
        { date: '2024-06', gasoline: 1.798, diesel: 1.654 },
        { date: '2024-07', gasoline: 1.782, diesel: 1.638 },
        { date: '2024-08', gasoline: 1.769, diesel: 1.621 },
        { date: '2024-09', gasoline: 1.748, diesel: 1.597 },
        { date: '2024-10', gasoline: 1.724, diesel: 1.573 },
        { date: '2024-11', gasoline: 1.701, diesel: 1.549 },
        { date: '2024-12', gasoline: 1.689, diesel: 1.531 },
        { date: '2025-01', gasoline: 1.712, diesel: 1.558 },
        { date: '2025-02', gasoline: 1.738, diesel: 1.574 },
        { date: '2025-03', gasoline: 1.721, diesel: 1.562 },
    ];

    const parseMonth = d3.timeParse('%Y-%m');
    const data = raw.map(d => ({ ...d, date: parseMonth(d.date) }));

    const series = [
        { key: 'gasoline', label: 'Essence 95' },
        { key: 'diesel',   label: 'Diesel'     },
    ];

    // ── Tooltip state ─────────────────────────────────────────────────────────
    let tooltip = $state({ visible: false, x: 0, y: 0, date: '', gasoline: '', diesel: '' });

    // ── SVG ref ───────────────────────────────────────────────────────────────
    let svgContainer;
    let wrapEl;

    // ── Draw chart ────────────────────────────────────────────────────────────
    function draw() {
        if (!svgContainer) return;
        d3.select(svgContainer).selectAll('*').remove();

        const colors  = getColors();
        const margin  = { top: 16, right: 16, bottom: 40, left: 52 };
        const W       = svgContainer.clientWidth;
        const H       = svgContainer.clientHeight;
        const width   = W - margin.left - margin.right;
        const height  = H - margin.top  - margin.bottom;

        const svg = d3.select(svgContainer)
            .attr('viewBox', `0 0 ${W} ${H}`)
            .attr('preserveAspectRatio', 'xMinYMin meet');

        const g = svg.append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Scales
        const x = d3.scaleTime()
            .domain(d3.extent(data, d => d.date))
            .range([0, width]);

        const allValues = data.flatMap(d => [d.gasoline, d.diesel]);
        const y = d3.scaleLinear()
            .domain([d3.min(allValues) * 0.97, d3.max(allValues) * 1.02])
            .range([height, 0]);

        // Grid
        g.append('g')
            .call(d3.axisLeft(y).tickSize(-width).tickFormat(''))
            .call(ax => ax.select('.domain').remove())
            .call(ax => ax.selectAll('.tick line').attr('stroke', colors.grid));

        // Lines + areas
        series.forEach(s => {
            const color = colors[s.key];

            // Area fill
            const area = d3.area()
                .x(d => x(d.date))
                .y0(height)
                .y1(d => y(d[s.key]))
                .curve(d3.curveCatmullRom);

            g.append('path')
                .datum(data)
                .attr('fill', color)
                .attr('opacity', 0.08)
                .attr('d', area);

            // Line
            const line = d3.line()
                .x(d => x(d.date))
                .y(d => y(d[s.key]))
                .curve(d3.curveCatmullRom);

            g.append('path')
                .datum(data)
                .attr('fill', 'none')
                .attr('stroke', color)
                .attr('stroke-width', 2.2)
                .attr('d', line);
        });

        // Hover bisector overlay
        const bisect = d3.bisector(d => d.date).left;

        const overlay = g.append('rect')
            .attr('width', width)
            .attr('height', height)
            .attr('fill', 'transparent')
            .style('cursor', 'crosshair');

        const vline = g.append('line')
            .attr('stroke', colors.axis)
            .attr('stroke-dasharray', '4 2')
            .attr('stroke-width', 1)
            .attr('y1', 0)
            .attr('y2', height)
            .attr('opacity', 0);

        overlay
            .on('mousemove', function(event) {
                const [mx] = d3.pointer(event, this);
                const date  = x.invert(mx);
                const idx   = bisect(data, date, 1);
                const d0    = data[idx - 1];
                const d1    = data[idx] || d0;
                const d     = date - d0.date > d1.date - date ? d1 : d0;
                const xPos  = x(d.date);

                vline.attr('x1', xPos).attr('x2', xPos).attr('opacity', 1);

                const fmt = d3.timeFormat('%b %Y');
                const wrapRect = wrapEl.getBoundingClientRect();
                const svgRect  = svgContainer.getBoundingClientRect();

                tooltip = {
                    visible:  true,
                    x:        svgRect.left - wrapRect.left + margin.left + xPos,
                    y:        svgRect.top  - wrapRect.top  + margin.top,
                    date:     fmt(d.date),
                    gasoline: d.gasoline.toFixed(3),
                    diesel:   d.diesel.toFixed(3),
                };
            })
            .on('mouseleave', () => {
                vline.attr('opacity', 0);
                tooltip = { ...tooltip, visible: false };
            });

        // X axis — year ticks
        g.append('g')
            .attr('transform', `translate(0,${height})`)
            .call(d3.axisBottom(x)
                .ticks(d3.timeYear.every(1))
                .tickFormat(d3.timeFormat('%Y')))
            .call(ax => ax.select('.domain').attr('stroke', colors.axis))
            .call(ax => ax.selectAll('.tick line').attr('stroke', colors.axis))
            .call(ax => ax.selectAll('text')
                .attr('fill', colors.text)
                .style('font-family', 'Montserrat, sans-serif')
                .style('font-size', '11px'));

        // Y axis — €/L
        g.append('g')
            .call(d3.axisLeft(y)
                .ticks(5)
                .tickFormat(d => `${d.toFixed(2)} €`))
            .call(ax => ax.select('.domain').attr('stroke', colors.axis))
            .call(ax => ax.selectAll('.tick line').attr('stroke', colors.axis))
            .call(ax => ax.selectAll('text')
                .attr('fill', colors.text)
                .style('font-family', 'Montserrat, sans-serif')
                .style('font-size', '11px'));

        onrendered();
    }

    onMount(() => {
        draw();
        const ro = new ResizeObserver(() => draw());
        ro.observe(svgContainer);
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        mq.addEventListener('change', draw);
        return () => {
            ro.disconnect();
            mq.removeEventListener('change', draw);
        };
    });
</script>

<div class="widget" bind:this={wrapEl}>
    <h2 class="title">Prix des carburants en Belgique</h2>
    <p class="subtitle">Prix à la pompe en €/litre — données mensuelles</p>

    <!-- Legend -->
    <div class="legend">
        <span class="dot gasoline"></span><span>Essence 95</span>
        <span class="dot diesel"></span><span>Diesel</span>
    </div>

    <div class="chart-wrap">
        <svg bind:this={svgContainer}></svg>

        {#if tooltip.visible}
            <div
                class="tooltip"
                style="left:{tooltip.x}px; top:{tooltip.y}px"
            >
                <strong>{tooltip.date}</strong>
                <div><span class="dot gasoline sm"></span> Essence 95 : <b>{tooltip.gasoline} €/L</b></div>
                <div><span class="dot diesel sm"></span> Diesel : <b>{tooltip.diesel} €/L</b></div>
            </div>
        {/if}
    </div>

    <p class="source">Source: SPF Économie — données indicatives</p>
</div>

<style>
    .widget {
        padding: 16px;
        max-width: 800px;
        margin: 0 auto;
        position: relative;
    }

    .title {
        font-size: 1.1rem;
        font-weight: 700;
        margin: 0 0 4px;
    }

    .subtitle {
        font-size: 0.82rem;
        margin: 0 0 10px;
        opacity: 0.7;
    }

    .legend {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.78rem;
        margin-bottom: 12px;
        opacity: 0.85;
    }

    .dot {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
    }
    .dot.gasoline { background: #E63946; }
    .dot.diesel   { background: #4A90E2; }
    .dot.sm       { width: 8px; height: 8px; }

    @media (prefers-color-scheme: light) {
        .dot.gasoline { background: #B82D35; }
        .dot.diesel   { background: #053061; }
    }

    .chart-wrap {
        width: 100%;
        height: 300px;
        position: relative;
    }

    svg {
        width: 100%;
        height: 100%;
        display: block;
    }

    .tooltip {
        position: absolute;
        pointer-events: none;
        transform: translate(-50%, 8px);
        background: #0a2a40;
        color: #F0F0F1;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 6px;
        padding: 8px 12px;
        font-size: 0.78rem;
        line-height: 1.6;
        white-space: nowrap;
        z-index: 10;
    }

    @media (prefers-color-scheme: light) {
        .tooltip {
            background: #ffffff;
            color: #2E3238;
            border-color: rgba(0,0,0,0.12);
            box-shadow: 0 2px 8px rgba(0,0,0,0.12);
        }
    }

    .source {
        font-size: 0.72rem;
        opacity: 0.5;
        margin: 8px 0 0;
    }
</style>
