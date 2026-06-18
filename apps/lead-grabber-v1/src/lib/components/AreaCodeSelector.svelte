<script lang="ts">
	import { ChevronDown } from 'lucide-svelte';

	interface Props {
		value: string;
		country: string;
		disabled?: boolean;
		placeholder?: string;
		onchange?: (value: string) => void;
	}

	let {
		value = $bindable(''),
		country,
		disabled = false,
		placeholder = 'Select area code...',
		onchange
	}: Props = $props();

	let areaCodes = $state<Array<{ code: string; location: string }>>([]);
	let loading = $state(false);
	let searchTerm = $state('');
	let isOpen = $state(false);
	let inputRef = $state<HTMLInputElement>();

	// Filtered area codes based on search
	let filteredCodes = $derived(
		searchTerm.trim()
			? areaCodes.filter(
					(ac) =>
						ac.code.includes(searchTerm) ||
						ac.location.toLowerCase().includes(searchTerm.toLowerCase())
				)
			: areaCodes
	);

	// Load area codes when country changes
	async function loadAreaCodes() {
		if (country !== 'US' && country !== 'CA') {
			areaCodes = [];
			return;
		}

		loading = true;
		try {
			const response = await fetch(`/api/area-codes?country=${country}`);
			const result = await response.json();
			if (result.success) {
				areaCodes = result.areaCodes;
			}
		} catch (error) {
			console.error('Error loading area codes:', error);
			areaCodes = [];
		} finally {
			loading = false;
		}
	}

	// Load area codes when country changes
	$effect(() => {
		loadAreaCodes();
		value = ''; // Reset selection when country changes
	});

	function selectCode(code: string) {
		value = code;
		isOpen = false;
		searchTerm = '';
		onchange?.(code);
	}

	function handleInputClick() {
		if (!disabled && !loading) {
			isOpen = !isOpen;
		}
	}

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (inputRef && !inputRef.contains(target) && !target.closest('.area-code-dropdown')) {
			isOpen = false;
			searchTerm = '';
		}
	}

	$effect(() => {
		if (isOpen) {
			document.addEventListener('click', handleClickOutside);
			return () => document.removeEventListener('click', handleClickOutside);
		}
	});

	// Display value: show code + location if selected, otherwise placeholder
	let displayValue = $derived.by(() => {
		if (value) {
			const selected = areaCodes.find((ac) => ac.code === value);
			return selected ? `${selected.code} - ${selected.location}` : value;
		}
		return '';
	});

	// Input value for binding
	let inputValue = $state('');
	$effect(() => {
		inputValue = isOpen ? searchTerm : displayValue;
	});
</script>

<div class="relative">
	<!-- Input field -->
	<div class="relative">
		<input
			bind:this={inputRef}
			bind:value={inputValue}
			type="text"
			readonly={!isOpen}
			oninput={(e) => {
				if (isOpen) {
					searchTerm = (e.target as HTMLInputElement).value;
				}
			}}
			onclick={handleInputClick}
			placeholder={loading ? 'Loading...' : placeholder}
			{disabled}
			class="h-[47px] w-full cursor-pointer rounded-[2px] border border-[#969696] bg-white px-3 pr-10 font-['Poppins'] text-sm font-normal leading-[17px] text-[#808080] outline-none placeholder:text-[rgba(128,128,128,0.47)] disabled:opacity-50"
			class:cursor-not-allowed={disabled || loading}
		/>
		<ChevronDown
			class="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#808080] transition-transform duration-200 {isOpen
				? 'rotate-180'
				: ''}"
		/>
	</div>

	<!-- Dropdown -->
	{#if isOpen && !loading && areaCodes.length > 0}
		<div
			class="area-code-dropdown absolute z-50 mt-1 max-h-[300px] w-full overflow-y-auto rounded-[2px] border border-[#969696] bg-white shadow-lg"
		>
			{#if filteredCodes.length === 0}
				<div class="px-3 py-2 text-center text-sm text-gray-500">No area codes found</div>
			{:else}
				{#each filteredCodes as ac}
					<button
						type="button"
						onclick={() => selectCode(ac.code)}
						class="w-full px-3 py-2 text-left font-['Poppins'] text-sm text-[#808080] transition-colors hover:bg-[#F5F5F5] focus:bg-[#F5F5F5] focus:outline-none"
						class:bg-[#E8F0FE]={value === ac.code}
					>
						<span class="font-medium">{ac.code}</span>
						<span class="text-[#A0A0A0]"> - {ac.location}</span>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>
