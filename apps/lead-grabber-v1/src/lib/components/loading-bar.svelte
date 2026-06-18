<!-- @migration task: review uses of `navigating` -->
<script lang="ts">
	import { navigating } from '$app/state';
	let { class: className } = $props();
</script>

<div class="fixed left-0 right-0 top-0 z-50">
	{#if navigating.to}
		<div class="h-1 w-full bg-gray-200">
			<div class="animate-loading-bar h-1 bg-primary"></div>
		</div>
	{/if}
</div>

<style>
	@keyframes loading-bar {
		0% {
			width: 0;
		}
		50% {
			width: 70%;
		}
		100% {
			width: 100%;
		}
	}

	.animate-loading-bar {
		animation: loading-bar 1s ease-in-out infinite;
	}
</style>
