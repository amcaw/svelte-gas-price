<script>
    import { onMount } from 'svelte';
    import { initPym } from '../lib/pym.js';
    import { getColors } from '../lib/colors.js';

    initPym();

    const FUELS = [
        { key: 'essence95', label: 'Essence 95 E10' },
        { key: 'super98',   label: 'Super 98 E5' },
        { key: 'diesel',    label: 'Diesel B7' },
    ];

    let activeFuel = $state('essence95');
    let data       = $state(null);
    let error      = $state(null);

    onMount(async () => {
        try {
            const base = import.meta.env.BASE_URL;
            const url  = `${base}data/best-prices.json`.replace('//', '/');
            const res  = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            data = await res.json();
        } catch (e) {
            error = e.message;
        }
    });

    const colors = getColors();

    // data.provinces[i][fuel] = { price, locality, url }
    const sorted = $derived.by(() => {
        if (!data) return [];
        return [...data.provinces]
            .filter(p => p[activeFuel]?.price != null)
            .sort((a, b) => a[activeFuel].price - b[activeFuel].price);
    });

    const minPrice = $derived(sorted.length ? sorted[0][activeFuel].price : 0);
    const fuelColor = $derived(
        activeFuel === 'diesel'  ? colors.diesel  :
        activeFuel === 'super98' ? colors.super98 :
        colors.essence95
    );

    function fmt(price) {
        return price.toLocaleString('fr-BE', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' €';
    }

    function formatDate(iso) {
        if (!iso) return '';
        const [y, m, d] = iso.split('-');
        return `${d}/${m}`;
    }


</script>

<div class="widget">

    <!-- ── Header ── -->
    <div class="header">
        <h1 class="title">Meilleurs prix des carburants en Belgique selon <a class="title-link" href="https://carbu.com/belgique//index.php/meilleurs-prix/" target="_blank" rel="noopener">carbu.com</a></h1>
        {#if data}
            <span class="updated">MAJ {formatDate(data.lastUpdated)}</span>
        {/if}
    </div>

    <!-- ── Fuel tabs ── -->
    <nav class="fuel-tabs" aria-label="Type de carburant">
        {#each FUELS as fuel}
            <button
                class="tab"
                class:active={activeFuel === fuel.key}
                onclick={() => activeFuel = fuel.key}
                aria-pressed={activeFuel === fuel.key}
            >{fuel.label}</button>
        {/each}
    </nav>

    <!-- ── Content ── -->
    {#if error}
        <p class="error">Impossible de charger les données ({error})</p>
    {:else if !data}
        <p class="loading">Chargement…</p>
    {:else}
        <div class="list">
            {#each sorted as row, i}
                {@const isBest = i === 0}
                {@const entry = row[activeFuel]}
                <a
                    class="row"
                    class:best={isBest}
                    href={entry.url}
                    target="_blank"
                    rel="noopener"
                >
                    <span class="rank" style:color={isBest ? fuelColor : undefined}>{i + 1}</span>
                    <span class="province-wrap">
                        <span class="province" class:best-text={isBest}>{row.province}</span>
                        <span class="locality">{entry.locality}</span>
                    </span>
                    <span class="price" style:color={isBest ? fuelColor : undefined}>
                        {fmt(entry.price)}
                    </span>
                </a>
            {/each}
        </div>

        <div class="footer">
            <span>Source : <a href="https://carbu.com/belgique/meilleurs-prix/Belgique/BE/0" target="_blank" rel="noopener">carbu.com</a> · prix les plus bas par province</span>
        </div>
    {/if}

</div>

<style>
    .widget {
        width: 100%;
        font-family: 'Montserrat', sans-serif;
        box-sizing: border-box;
    }

    /* ── Header ── */
    .header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 14px;
    }
    .title {
        font-size: 1rem;
        font-weight: 700;
        margin: 0;
        line-height: 1.3;
    }
    .title-link {
        color: inherit;
        text-decoration: underline;
        text-underline-offset: 2px;
    }
    .updated {
        font-size: 0.68rem;
        opacity: 0.45;
        white-space: nowrap;
        flex-shrink: 0;
    }

    /* ── Fuel tabs ── */
    .fuel-tabs {
        display: flex;
        gap: 6px;
        margin-bottom: 16px;
    }
    .tab {
        flex: 1;
        padding: 8px 10px;
        border: none;
        border-radius: 10px;
        font-family: inherit;
        font-size: 0.78rem;
        font-weight: 600;
        cursor: pointer;
        background: rgba(255,255,255,0.06);
        color: inherit;
        opacity: 0.55;
        transition: opacity 0.15s, background 0.15s;
    }
    .tab.active {
        background: rgba(255,255,255,0.13);
        opacity: 1;
    }
    @media (prefers-color-scheme: light) {
        .tab { background: rgba(0,0,0,0.05); }
        .tab.active { background: rgba(0,0,0,0.10); }
    }

    /* ── Province list ── */
    .list {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .row {
        display: grid;
        grid-template-columns: 20px 1fr 76px;
        align-items: center;
        gap: 8px;
        padding: 7px 10px;
        border-radius: 8px;
        text-decoration: none;
        color: inherit;
        transition: background 0.15s;
    }
    .row:hover { background: rgba(255,255,255,0.05); }
    .row.best  { background: rgba(255,255,255,0.05); }
    @media (prefers-color-scheme: light) {
        .row:hover { background: rgba(0,0,0,0.04); }
        .row.best  { background: rgba(0,0,0,0.04); }
    }

    .rank {
        font-size: 0.72rem;
        font-weight: 700;
        opacity: 0.4;
        text-align: right;
    }
    .row.best .rank { opacity: 1; }

    .province-wrap {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
    }
    .province {
        font-size: 0.82rem;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .province.best-text { font-weight: 700; }
    .locality {
        font-size: 0.68rem;
        opacity: 0.45;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .price {
        font-size: 0.86rem;
        font-weight: 700;
        text-align: right;
        white-space: nowrap;
        opacity: 0.75;
    }
    .row.best .price { opacity: 1; }

    /* ── Footer ── */
    .footer {
        margin-top: 12px;
        font-size: 0.64rem;
        opacity: 0.35;
        text-align: right;
    }
    .footer a {
        color: inherit;
        text-decoration: underline;
    }

    /* ── States ── */
    .loading, .error {
        font-size: 0.82rem;
        opacity: 0.5;
        padding: 20px 0;
        text-align: center;
    }
</style>
