import '../app.css';
import BestPrices from './BestPrices.svelte';
import { mount } from 'svelte';

const app = mount(BestPrices, {
    target: document.getElementById('app'),
});

export default app;
