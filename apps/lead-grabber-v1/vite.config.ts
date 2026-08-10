/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import openapiPlugin from 'sveltekit-openapi-generator';

export default defineConfig(({ mode, command }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const publicBaseUrl = (env.PUBLIC_BASE_URL || 'http://localhost:3005').replace(/\/+$/, '');

	return {
		plugins: [
			// The OpenAPI generator is CODEGEN, not part of the app. It scans every route under
			// src/routes/api on each run and rewrites src/lib/api/*.generated.js — files that are
			// committed and read from disk at runtime. A production build therefore gains nothing
			// from re-running it, but pays for the whole scan, which is a large share of build time
			// on a small VPS. Dev server only; regenerate by running `vite dev` (or `npm run dev`)
			// after changing an API route, and commit the result as before.
			...(command === 'serve'
				? [
						openapiPlugin({
							info: {
								title: 'ClearSky / A2P Backend API',
								version: '1.0.0',
								description:
									'REST API for the ClearSky dialer, messaging, contacts, notifications and call tracking backend. Auth via `Authorization: Bearer <token>` (token returned by POST /api/auth/login) or the app_session cookie.'
							},
							servers: [{ url: publicBaseUrl, description: 'Backend server' }],
							baseSchemasPath: 'src/lib/api/openapi-schemas.generated.js',
							include: [
								'src/routes/api/**/*.{js,ts}',
								'src/lib/api/openapi-paths.generated.js',
								'src/lib/api/openapi-schemas.js'
							],
							debounceMs: 100
						})
					]
				: []),
			sveltekit()
		],
		test: {
			include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
			environment: 'node',
			globals: true
		},
		ssr: {
			noExternal: ['lucide-svelte'],
			external: ['firebase-admin', 'clearsky-db-client', 'profiledb-client']
		},
		build: {
			minify: true,
			sourcemap: false,
			rollupOptions: {
				external: (id) =>
					id.includes('clearsky-db-client') ||
					id.includes('profiledb-client') ||
					id.includes('firebase-admin'),
				output: {
					manualChunks: {
						vendor: ['svelte'],
						ui: ['lucide-svelte', 'svelte-sonner', 'bits-ui']
					}
				}
			}
		},
		optimizeDeps: {
			include: ['lucide-svelte', 'svelte-sonner', 'bits-ui', '@telnyx/webrtc']
		}
	};
});
