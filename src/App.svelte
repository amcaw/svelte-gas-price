<script>
    import { onMount } from 'svelte';
    import Widget from './lib/Widget.svelte';
    import pym from 'pym.js';

    let pymChild;

    onMount(() => {
        // Initialize pym.Child for iframe embedding & auto-resize
        if (typeof window !== 'undefined') {
            pymChild = new pym.Child({ polling: 500 });
        }
    });

    // Call this after any render update that may change height
    function sendHeight() {
        if (pymChild) {
            setTimeout(() => pymChild.sendHeight(), 50);
        }
    }
</script>

<Widget onrendered={sendHeight} />
