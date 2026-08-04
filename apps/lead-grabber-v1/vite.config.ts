/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import openapiPlugin from 'sveltekit-openapi-generator';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const publicBaseUrl = (env.PUBLIC_BASE_URL || 'http://localhost:3005').replace(/\/+$/, '');

	return {
		plugins: [
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
			}),
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
		sourcemap: true,
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
