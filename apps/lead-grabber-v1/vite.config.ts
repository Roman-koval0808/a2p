/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
		environment: 'node',
		globals: true
	},
	ssr: {
		noExternal: ['lucide-svelte'],
		external: ['firebase-admin', 'clearsky-db-client']
	},
	build: {
		minify: true,
		sourcemap: true,
		rollupOptions: {
			output: {
				manualChunks: {
					vendor: ['svelte'],
					ui: ['lucide-svelte', 'svelte-sonner', 'bits-ui']
				}
			}
		}
	},
	optimizeDeps: {
		include: ['lucide-svelte', 'svelte-sonner', 'bits-ui']
	}
});
