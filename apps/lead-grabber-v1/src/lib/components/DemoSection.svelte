<script lang="ts">
	const topRowDemos = [
		'ViewRoom Demo',
		'AI Chat Bot Demo',
		'AI Automation',
		'Conversational AI',
		'Communication Log'
	];

	const bottomRowDemos = [
		{ title: 'Founders Program', subtitle: 'Market Exclusivity' },
		'Marketing Demo',
		'Parsing Engine',
		'website'
	];
</script>

<div class="w-full bg-white py-8 md:py-16">
	<div class="mx-auto max-w-[1442px] px-4 md:px-8">
		<h2 class="mb-8 text-center font-sans text-black md:mb-12">Click to Demo</h2>

		<!-- Top Row -->
		<div
			class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:mb-8 md:grid-cols-3 md:gap-6 lg:grid-cols-5"
		>
			{#each topRowDemos as demo}
				<button
					class="flex h-40 w-full items-center justify-center rounded-lg bg-[#FFE5E5] text-center font-sans text-black transition-colors hover:bg-[#FFD5D5]"
				>
					{demo}
				</button>
			{/each}
		</div>

		<!-- Bottom Row -->
		<div class="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-5">
			<!-- Video Placeholder -->
			<div
				class="order-2 flex h-40 w-full items-center justify-center rounded-lg bg-[#D9D9D9] lg:order-1 lg:col-span-1"
			>
				<svg
					class="h-16 w-16 text-red-600"
					fill="currentColor"
					viewBox="0 0 24 24"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M8 5v14l11-7z"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</div>

			<!-- Bottom Row Cards -->
			<div
				class="order-1 grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:order-2 lg:col-span-4 lg:grid-cols-4"
			>
				{#each bottomRowDemos as demo}
					<button
						class="flex h-40 w-full flex-col items-center justify-center rounded-lg bg-[#FFE5E5] text-center font-sans text-black transition-colors hover:bg-[#FFD5D5]"
					>
						{#if typeof demo === 'object'}
							<span>{demo.title}</span>
							<span class="text-sm">{demo.subtitle}</span>
						{:else}
							<span>{demo}</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	</div>
</div>
