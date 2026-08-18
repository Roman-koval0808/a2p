<script lang="ts">
	import { Clock, X } from 'lucide-svelte';
	import { parseTime24, toTime24, formatTime12 } from '$lib/utils/time';

	let {
		value = $bindable(''),
		placeholder = '--:--',
		disabled = false,
		invalid = false,
		ariaLabel = 'Time'
	}: {
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		invalid?: boolean;
		ariaLabel?: string;
	} = $props();

	let open = $state(false);
	// Draft state, seeded from `value` each time the dialog opens. Kept as editable state (not
	// derived) so the AM/PM toggle can be changed without committing/ closing the dialog.
	let hour12 = $state(9);
	let minute = $state(0);
	let period = $state<'AM' | 'PM'>('AM');
	// Viewport-anchored position for the popover, so it escapes any `overflow`/scroll container it
	// is nested in (e.g. the auto-replies half-height column). Recomputed each time it opens.
	let pos = $state({ top: 0, left: 0 });

	const POPUP_WIDTH = 256;
	const POPUP_HEIGHT = 240;

	const display = $derived(formatTime24Display(value));

	const hours = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
	const minuteOptions = $derived.by(() => {
		const base = Array.from({ length: 12 }, (_, i) => i * 5);
		if (!base.includes(minute)) base.push(minute);
		return base.sort((a, b) => a - b);
	});

	function formatTime24Display(v: string): string {
		return formatTime12(v) ?? '';
	}

	function computePosition(trigger: HTMLElement | null) {
		if (!trigger) return { top: 0, left: 0 };
		const r = trigger.getBoundingClientRect();
		let left = r.left;
		if (left + POPUP_WIDTH > window.innerWidth - 8) {
			left = Math.max(8, window.innerWidth - POPUP_WIDTH - 8);
		}
		let top = r.bottom + 4;
		if (top + POPUP_HEIGHT > window.innerHeight - 8) {
			top = Math.max(8, r.top - POPUP_HEIGHT - 4);
		}
		return { top, left };
	}

	function openPicker(trigger?: HTMLElement) {
		const p = parseTime24(value);
		if (p) {
			hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
			minute = p.minute;
			period = p.hour >= 12 ? 'PM' : 'AM';
		}
		pos = computePosition(trigger ?? null);
		open = true;
	}

	function toggle(e: MouseEvent) {
		if (disabled) return;
		if (open) {
			open = false;
			return;
		}
		openPicker(e.currentTarget as HTMLElement);
	}

	function select(h: number, m: number) {
		hour12 = h;
		minute = m;
		value = toTime24(h, m, period);
		open = false;
	}

	function setPeriod(p: 'AM' | 'PM') {
		period = p;
		value = toTime24(hour12, minute, p);
		// Keep the dialog open so the user can keep adjusting.
	}

	function clear() {
		value = '';
		open = false;
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="relative inline-block">
	<button
		type="button"
		class="inline-flex h-9 min-w-[7.5rem] items-center justify-between gap-2 rounded-md border px-3 text-sm transition-colors {invalid
			? 'border-red-400 text-red-600'
			: 'border-gray-300 text-gray-800 hover:border-gray-400'} {disabled ? 'cursor-not-allowed bg-gray-50 text-gray-400' : 'bg-white'}"
		{disabled}
		aria-label={ariaLabel}
		onclick={toggle}
	>
		<span class={display ? '' : 'text-gray-400'}>{display || placeholder}</span>
		<Clock class="h-4 w-4 opacity-60" />
	</button>

	{#if open}
		<button
			type="button"
			class="fixed inset-0 z-40 cursor-default"
			aria-label="Close time picker"
			onclick={() => (open = false)}
		></button>

		<div
			class="fixed z-50 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
			style={`top: ${pos.top}px; left: ${pos.left}px;`}
			role="dialog"
			aria-label="Choose a time"
		>
			<div class="mb-2 flex items-center justify-between">
				<span class="text-xs font-semibold uppercase tracking-wide text-gray-500">Time</span>
				<button
					type="button"
					class="text-gray-400 hover:text-gray-600"
					aria-label="Clear time"
					onclick={clear}
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="mb-2 grid grid-cols-2 gap-1 rounded-md bg-gray-100 p-1">
				<button
					type="button"
					class="rounded px-2 py-1 text-xs font-semibold {period === 'AM' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}"
					onclick={() => setPeriod('AM')}
				>
					AM
				</button>
				<button
					type="button"
					class="rounded px-2 py-1 text-xs font-semibold {period === 'PM' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}"
					onclick={() => setPeriod('PM')}
				>
					PM
				</button>
			</div>

			<div class="flex gap-2">
				<div class="flex-1">
					<div class="mb-1 text-xs text-gray-500">Hour</div>
					<div class="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto">
						{#each hours as h (h)}
							<button
								type="button"
								class="rounded px-1 py-1 text-sm {h === hour12 ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'}"
								onclick={() => select(h, minute)}
							>
								{h}
							</button>
						{/each}
					</div>
				</div>
				<div class="flex-1">
					<div class="mb-1 text-xs text-gray-500">Minute</div>
					<div class="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto">
						{#each minuteOptions as m (m)}
							<button
								type="button"
								class="rounded px-1 py-1 text-sm {m === minute ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'}"
								onclick={() => select(hour12, m)}
							>
								{String(m).padStart(2, '0')}
							</button>
						{/each}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
