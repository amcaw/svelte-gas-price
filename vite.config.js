import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// Set BASE_PATH env var to deploy to a subpage, e.g. BASE_PATH=/my-widget
// This matches the GitHub repo name when deploying to GitHub Pages
const base = process.env.BASE_PATH ? `/${process.env.BASE_PATH}/` : '/';

export default defineConfig({
    plugins: [svelte()],
    base,
});
