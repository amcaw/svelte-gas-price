<script>
    import { onMount, createEventDispatcher } from 'svelte';
    import * as d3 from 'd3';

    const dispatch = createEventDispatcher();

    // ── Theme detection ──────────────────────────────────────────────────────
    // Matches the dark/light palette used in meteoclimat
    const darkMode = () =>
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;

    function getColors() {
        const dark = darkMode();
        return {
            warm:       dark ? '#E63946' : '#B82D35',
            cool:       dark ? '#4A90E2' : '#053061',
            text:       dark ? '#F0F0F1' : '#2E3238',
            background: dark ? '#001324' : '#F7F8FB',
            grid:       dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
            axis:       dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
        };
    }

    // ── Example data ─────────────────────────────────────────────────────────
    const data = d3.range(20).map(i => ({
        x: i,
        value: Math.sin(i / 3) * 10 + Math.random() * 2,
    }));

    // ── SVG ref ──────────────────────────────────────────────────────────────
    let svgContainer;

    // ── Draw chart ───────────────────────────────────────────────────────────
    function draw() {
        if (!svgContainer) return;
        d3.select(svgContainer).selectAll('*').remove();

        const colors = getColors();

        const margin = { top: 20, right: 20, bottom: 40, left: 44 };
        const width  = svgContainer.clientWidth  - margin.left - margin.right;
        const height = svgContainer.clientHeight - margin.top  - margin.bottom;

        const svg = d3.select(svgContainer)
            .attr('viewBox', `0 0 ${svgContainer.clientWidth} ${svgContainer.clientHeight}`)
            .attr('preserveAspectRatio', 'xMinYMin meet');

        const g = svg.append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Scales
        const x = d3.scaleLinear()
            .domain([0, data.length - 1])
            .range([0, width]);

        const y = d3.scaleLinear()
            .domain(d3.extent(data, d => d.value)).nice()
            .range([height, 0]);

        // Grid lines
        g.append('g')
            .attr('class', 'grid')
            .call(d3.axisLeft(y).tickSize(-width).tickFormat(''))
            .call(ax => ax.select('.domain').remove())
            .call(ax => ax.selectAll('.tick line')
                .attr('stroke', colors.grid));

        // Line
        const line = d3.line()
            .x(d => x(d.x))
            .y(d => y(d.value))
            .curve(d3.curveCatmullRom);

        g.append('path')
            .datum(data)
            .attr('fill', 'none')
            .attr('stroke', colors.warm)
            .attr('stroke-width', 2)
            .attr('d', line);

        // Dots
        g.selectAll('circle')
            .data(data)
            .join('circle')
            .attr('cx', d => x(d.x))
            .attr('cy', d => y(d.value))
            .attr('r', 4)
            .attr('fill', d => d.value >= 0 ? colors.warm : colors.cool)
            .append('title')
            .text(d => d.value.toFixed(2));

        // X axis
        g.append('g')
            .attr('transform', `translate(0,${height})`)
            .call(d3.axisBottom(x).ticks(5))
            .call(ax => ax.select('.domain').attr('stroke', colors.axis))
            .call(ax => ax.selectAll('.tick line').attr('stroke', colors.axis))
            .call(ax => ax.selectAll('text').attr('fill', colors.text).style('font-family', 'Montserrat, sans-serif').style('font-size', '11px'));

        // Y axis
        g.append('g')
            .call(d3.axisLeft(y).ticks(5))
            .call(ax => ax.select('.domain').attr('stroke', colors.axis))
            .call(ax => ax.selectAll('.tick line').attr('stroke', colors.axis))
            .call(ax => ax.selectAll('text').attr('fill', colors.text).style('font-family', 'Montserrat, sans-serif').style('font-size', '11px'));

        // Notify parent to update pym height
        dispatch('rendered');
    }

    onMount(() => {
        draw();

        // Re-draw on window resize
        const ro = new ResizeObserver(() => draw());
        ro.observe(svgContainer);

        // Re-draw on theme change
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        mq.addEventListener('change', draw);

        return () => {
            ro.disconnect();
            mq.removeEventListener('change', draw);
        };
    });
</script>

<div class="widget">
    <h2 class="title">Widget title</h2>
    <p class="subtitle">Short description of this widget</p>

    <div class="chart-wrap">
        <svg bind:this={svgContainer}></svg>
    </div>

    <p class="source">Source: your source here</p>
</div>

<style>
    .widget {
        padding: 16px;
        max-width: 800px;
        margin: 0 auto;
    }

    .title {
        font-size: 1.1rem;
        font-weight: 700;
        margin: 0 0 4px;
    }

    .subtitle {
        font-size: 0.82rem;
        margin: 0 0 16px;
        opacity: 0.7;
    }

    .chart-wrap {
        width: 100%;
        height: 320px;
    }

    svg {
        width: 100%;
        height: 100%;
        display: block;
    }

    .source {
        font-size: 0.72rem;
        opacity: 0.5;
        margin: 8px 0 0;
    }
</style>
