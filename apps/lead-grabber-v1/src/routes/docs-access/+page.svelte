<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';

	interface Props {
		form: { error?: string } | null;
	}

	let { form }: Props = $props();
</script>

<svelte:head>
	<title>Docs Access</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-6">
	<div class="w-full max-w-sm">
		<h1 class="mb-1 text-xl font-bold tracking-tight">Docs access</h1>
		<p class="mb-6 text-sm text-slate-500">
			The API documentation is restricted. Enter the shared access code to continue.
		</p>

		<form method="POST" use:enhance class="space-y-3">
			<input type="hidden" name="next" value={page.url.searchParams.get('next') ?? '/docs'} />
			<input
				type="password"
				name="code"
				required
				autocomplete="off"
				placeholder="Access code"
				class="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-primary focus:outline-none"
			/>
			{#if form?.error}
				<p class="text-sm text-red-600">{form.error}</p>
			{/if}
			<button
				type="submit"
				class="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
			>
				Continue
			</button>
		</form>
	</div>
</div>
