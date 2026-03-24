/**
 * Shared color palette for all fuel widgets.
 * Responds to prefers-color-scheme automatically.
 */
export function getColors() {
    const dark = typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    return {
        essence95:  dark ? '#E63946' : '#B82D35',
        super98:    dark ? '#F4A261' : '#C15C00',
        diesel:     dark ? '#4A90E2' : '#053061',
        mazout:     dark ? '#F4A261' : '#B85C00',
        text:       dark ? '#F0F0F1' : '#2E3238',
        textMuted:  dark ? 'rgba(240,240,241,0.55)' : 'rgba(46,50,56,0.55)',
        background: dark ? '#001324' : '#F7F8FB',
        surface:    dark ? '#0a2a40' : '#ffffff',
        grid:       dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        axis:       dark ? 'rgba(255,255,255,0.4)'  : 'rgba(0,0,0,0.4)',
        positive:   dark ? '#FF6B6B' : '#C0392B',  // price went up
        negative:   dark ? '#4ECB71' : '#1A7A3C',  // price went down
        border:     dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)',
    };
}

export const FUEL_LABELS = {
    essence95: 'Essence 95 E10',
    diesel:    'Diesel B7',
    mazout:    'Mazout de chauffage',
};
