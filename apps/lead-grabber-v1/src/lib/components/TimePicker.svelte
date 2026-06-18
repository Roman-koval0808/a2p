<script lang="ts">
	import { Clock } from 'lucide-svelte';

	interface Props {
		value: string;
		placeholder?: string;
		class?: string;
		disabled?: boolean;
	}
	let {
		value = $bindable(''),
		placeholder = '-- : --',
		class: className = '',
		disabled = false
	}: Props = $props();

	let open = $state(false);
	let hour = $state(9);
	let minute = $state(0);
	let pickerRoot: HTMLElement | undefined;

	$effect(() => {
		if (!open) return;
		const root = pickerRoot;
		const handler = (e: MouseEvent) => {
			if (root && !root.contains(e.target as Node)) open = false;
		};
		document.addEventListener('click', handler, true);
		return () => document.removeEventListener('click', handler, true);
	});

	function parseValue(v: string): { hour: number; minute: number } {
		if (!v || typeof v !== 'string') return { hour: 9, minute: 0 };
		const [h, m] = v.split(':').map((x) => parseInt(x, 10));
		return {
			hour: Number.isNaN(h) ? 9 : Math.max(0, Math.min(23, h)),
			minute: Number.isNaN(m) ? 0 : Math.max(0, Math.min(59, m))
		};
	}

	function toValue(h: number, m: number): string {
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
	}

	function openPicker() {
		if (disabled) return;
		const { hour: h, minute: m } = parseValue(value);
		hour = h;
		minute = m;
		open = true;
	}

	function apply() {
		value = toValue(hour, minute);
		open = false;
	}

	function displayVal(): string {
		if (!value || value === '-- : --') return '';
		const { hour: h, minute: m } = parseValue(value);
		return toValue(h, m);
	}

	const minutes = [0, 15, 30, 45];
	const hours = Array.from({ length: 24 }, (_, i) => i);
</script>

<div class="relative inline-block {className}" data-time-picker bind:this={pickerRoot}>
	<button
		type="button"
		class="flex h-[40px] w-full items-center gap-2 rounded-[3px] border border-black bg-white px-3 pr-10 font-['Poppins'] text-lg font-light leading-[21px] text-[#808080] outline-none transition-colors hover:border-[#577AB7] disabled:opacity-50 {!displayVal()
			? 'text-[#B6B6B6]'
			: ''}"
		{disabled}
		onclick={openPicker}
	>
		<span class="flex-1 text-left">{displayVal() || placeholder}</span>
		<Clock
			class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
		/>
	</button>
	{#if open}
		<div
			class="absolute left-0 top-full z-20 mt-1 min-w-[180px] rounded-lg border border-[#969696] bg-white p-3 shadow-lg"
			role="dialog"
			aria-label="Pick time"
		>
			<div class="flex gap-2">
				<select
					class="flex-1 rounded border border-[#969696] bg-white px-2 py-1.5 font-['Poppins'] text-sm text-[#808080] outline-none"
					bind:value={hour}
					onchange={() => (value = toValue(hour, minute))}
				>
					{#each hours as h}
						<option value={h}>{String(h).padStart(2, '0')}</option>
					{/each}
				</select>
				<span class="flex items-center font-['Poppins'] text-[#808080]">:</span>
				<select
					class="flex-1 rounded border border-[#969696] bg-white px-2 py-1.5 font-['Poppins'] text-sm text-[#808080] outline-none"
					bind:value={minute}
					onchange={() => (value = toValue(hour, minute))}
				>
					{#each minutes as m}
						<option value={m}>{String(m).padStart(2, '0')}</option>
					{/each}
				</select>
			</div>
			<button
				type="button"
				class="mt-2 w-full rounded bg-[#577AB7] py-1.5 font-['Poppins'] text-sm text-white hover:bg-[#4a6ba5]"
				onclick={apply}
			>
				Done
			</button>
		</div>
	{/if}
</div>
