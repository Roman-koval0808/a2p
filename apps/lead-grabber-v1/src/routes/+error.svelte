<script lang="ts">
	import { page } from '$app/state';

	const statusCode = $derived(page.status ?? 404);
	const errorMessage = $derived(page.error?.message ?? 'Something went wrong');

	const is404 = $derived(statusCode === 404);
	const title = $derived(is404 ? 'Page not found' : 'Something went wrong');
	const description = $derived(
		is404 ? "The page you're looking for doesn't exist or was moved." : errorMessage
	);
</script>

<svelte:head>
	<title>{statusCode} – {title}</title>
</svelte:head>

<div
	class="error-page flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 px-4"
>
	<div class="max-w-md text-center">
		<div class="mb-8 select-none text-8xl font-bold tabular-nums text-slate-200">
			{statusCode}
		</div>
		<h1 class="mb-2 font-['Poppins'] text-2xl font-semibold text-slate-800">
			{title}
		</h1>
		<p class="mb-8 font-['Poppins'] leading-relaxed text-slate-600">
			{description}
		</p>
		<div class="flex flex-col justify-center gap-3 sm:flex-row">
			<button
				type="button"
				onclick={() => typeof window !== 'undefined' && window.history.back()}
				class="rounded-lg border border-slate-300 bg-white px-5 py-2.5 font-['Poppins'] font-medium text-slate-700 transition-colors hover:bg-slate-50"
			>
				← Go back
			</button>
			<a
				href="/"
				class="rounded-lg bg-[#577AB7] px-5 py-2.5 text-center font-['Poppins'] font-medium text-white transition-colors hover:bg-[#4a6ba5]"
			>
				Home
			</a>
		</div>
	</div>
</div>
