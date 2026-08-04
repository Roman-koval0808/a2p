<script lang="ts">
	import { onMount } from 'svelte';
	import 'swagger-ui-dist/swagger-ui.css';

	let container: HTMLDivElement | undefined = $state(undefined);
	let status = $state<'loading' | 'ready' | 'error'>('loading');

	onMount(async () => {
		try {
			const res = await fetch('/docs/spec.json');
			if (!res.ok) throw new Error('spec fetch failed');
			const loaded = await res.json();

			const { SwaggerUIBundle } = await import('swagger-ui-dist');

			// Swagger UI needs a DOM node; spec substitution done by passing the spec object.
			SwaggerUIBundle({
				spec: {
					...loaded,
					servers: [
						{ url: window.location.origin, description: 'This server' },
						...(loaded.servers ?? [])
					]
				},
				domNode: container,
				presets: [SwaggerUIBundle.presets.apis],
				layout: 'BaseLayout',
				persistAuthorization: true,
				defaultModelsExpandDepth: 1
			});

			status = 'ready';
		} catch (e) {
			console.error('[docs] Failed to load API spec', e);
			status = 'error';
		}
	});
</script>

<svelte:head>
	<title>API Docs</title>
</svelte:head>

{#if status !== 'ready'}
	<div class="flex min-h-screen items-center justify-center text-sm text-slate-500">
		{#if status === 'loading'}
			Loading API spec…
		{:else}
			Failed to load the API spec.
		{/if}
	</div>
{/if}

<div bind:this={container} class="api-docs"></div>

<style>
	:global(.swagger-ui .topbar) {
		display: none;
	}
	:global(html, body) {
		max-width: none;
	}
</style>