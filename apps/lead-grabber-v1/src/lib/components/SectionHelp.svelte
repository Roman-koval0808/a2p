<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';

	let { text }: { text: string } = $props();

	const POPOVER_WIDTH = 420;
	const VIEWPORT_PAD = 12;

	let open = $state(false);
	let triggerEl: HTMLButtonElement | null = $state(null);
	let popoverEl: HTMLDivElement | null = $state(null);
	let popoverStyle = $state('');

	function toggle() {
		open = !open;
		if (open) updatePosition();
	}

	function updatePosition() {
		if (!triggerEl) return;
		const r = triggerEl.getBoundingClientRect();
		const vw = document.documentElement.clientWidth;
		const vh = document.documentElement.clientHeight;
		// Prefer above, then below
		const aboveY = r.top - 8;
		const belowY = r.bottom + 8;
		const useAbove = aboveY >= VIEWPORT_PAD;
		const y = useAbove ? aboveY : belowY;
		const anchorCenter = r.left + r.width / 2;
		let left = anchorCenter - POPOVER_WIDTH / 2;
		left = Math.max(VIEWPORT_PAD, Math.min(vw - POPOVER_WIDTH - VIEWPORT_PAD, left));
		const top = useAbove ? 'auto' : `${y}px`;
		const bottom = useAbove ? `${vh - y}px` : 'auto';
		popoverStyle = `position:fixed;left:${left}px;width:${POPOVER_WIDTH}px;max-width:calc(100vw - ${VIEWPORT_PAD * 2}px);bottom:${bottom};top:${top};`;
	}

	$effect(() => {
		if (open && triggerEl) {
			tick().then(updatePosition);
		}
	});

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as Node;
		if (!open) return;
		if (triggerEl?.contains(target)) return;
		if (popoverEl?.contains(target)) return;
		open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}

	onMount(() => {
		document.addEventListener('click', handleClickOutside, true);
		document.addEventListener('keydown', handleKeydown);
	});
	onDestroy(() => {
		document.removeEventListener('click', handleClickOutside, true);
		document.removeEventListener('keydown', handleKeydown);
	});
</script>

<div
	class="relative inline-flex align-middle"
	onmouseenter={() => (open = true)}
	onmouseleave={() => (open = false)}
	role="group"
>
	<button
		bind:this={triggerEl}
		type="button"
		onclick={toggle}
		class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#969696] bg-[#f5f5f5] font-['Poppins'] text-xs font-medium text-[#808080] transition-colors hover:border-[#577AB7] hover:bg-[#ECF3FF] hover:text-[#577AB7] focus:outline-none focus:ring-2 focus:ring-[#577AB7] focus:ring-offset-1"
		aria-label="Help"
		title="Help"
	>
		?
	</button>
	{#if open}
		<div
			bind:this={popoverEl}
			role="tooltip"
			class="section-help-content z-50 rounded-md border border-[#969696] bg-white px-4 py-2.5 shadow-lg"
			style={popoverStyle}
		>
			<p class="font-['Poppins'] text-sm leading-snug text-[#808080]">{text}</p>
		</div>
	{/if}
</div>
