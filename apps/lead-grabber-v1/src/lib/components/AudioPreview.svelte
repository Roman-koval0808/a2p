<script lang="ts">
	import Spinner from '$lib/components/ui/spinner.svelte';

	interface Props {
		src: string | null | undefined;
		class?: string;
	}
	let { src, class: className = '' }: Props = $props();

	let status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');

	function onLoadStart() {
		status = 'loading';
	}
	function onCanPlay() {
		status = 'ready';
	}
	function onError() {
		status = 'error';
	}
	$effect(() => {
		if (!src) status = 'idle';
		else status = 'loading';
	});
</script>

{#if src}
	<div class="flex flex-col items-center gap-2 {className}">
		{#if status === 'loading'}
			<div class="flex items-center gap-2 text-[#808080]">
				<Spinner class="h-5 w-5 text-[#577AB7]" />
				<span class="font-['Poppins'] text-sm">Loading…</span>
			</div>
		{:else if status === 'error'}
			<p class="font-['Poppins'] text-sm text-red-600">Failed to load audio</p>
		{/if}
		{#if status === 'ready' || status === 'loading'}
			<audio
				controls
				class="mx-auto h-9 w-full max-w-md {status === 'loading' ? 'invisible absolute' : ''}"
				{src}
				preload="metadata"
				onloadstart={onLoadStart}
				oncanplay={onCanPlay}
				onerror={onError}
			></audio>
		{/if}
	</div>
{/if}
