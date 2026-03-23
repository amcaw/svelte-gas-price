import '../app.css';
import Calculator from './Calculator.svelte';
import { mount } from 'svelte';

const app = mount(Calculator, {
    target: document.getElementById('app'),
});

export default app;
