import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { resolve } from 'path';

// Set BASE_PATH env var to deploy to a subpage, e.g. BASE_PATH=svelte-gas-price
const base = process.env.BASE_PATH ? `/${process.env.BASE_PATH}/` : '/';

export default defineConfig({
    plugins: [svelte()],
    base,
    build: {
        rollupOptions: {
            input: {
                main:       resolve(__dirname, 'index.html'),
                widget:     resolve(__dirname, 'widget/index.html'),
                bestPrices: resolve(__dirname, 'BestPrices/index.html'),
            },
        },
    },
});
