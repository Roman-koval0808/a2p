<script lang="ts">
	import { goto } from '$app/navigation';

	const topRowDemos = [
		{ title: 'ViewRoom Demo', url: '/dashboard' },
		{ title: 'AI Chat Bot Demo', url: '/inbox' },
		{ title: 'AI Automation', url: '/test' },
		{ title: 'Conversational AI', url: '/dialer' },
		{ title: 'Communication Log', url: '/communication-log' }
	];

	const bottomRowDemos = [
		{ title: 'Founders Program', subtitle: 'Market Exclusivity', url: '/signup' },
		{ title: 'Marketing Demo', url: '/marketing' },
		{ title: 'Parsing Engine', url: '/test' },
		{ title: 'website', url: '/website' }
	];

	function navigateToDemo(url: string) {
		goto(url);
	}
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
					onclick={() => navigateToDemo(demo.url)}
					class="flex h-40 w-full items-center justify-center rounded-lg bg-[#FFE5E5] hover:bg-[#F66922]/20 hover:text-[#F66922] font-semibold text-center font-sans text-black transition-all hover:scale-102 hover:shadow-md cursor-pointer border border-[#ffe5e5]"
				>
					{demo.title}
				</button>
			{/each}
		</div>

		<!-- Bottom Row -->
		<div class="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-5">
			<!-- Video Embed / Product Preview -->
			<div
				class="order-2 flex h-40 w-full flex-col items-center justify-center rounded-lg bg-slate-900 border border-slate-800 text-white relative overflow-hidden group cursor-pointer lg:order-1 lg:col-span-1"
				onclick={() => navigateToDemo('/signup')}
				onkeydown={(e) => e.key === 'Enter' && navigateToDemo('/signup')}
				role="button"
				tabindex="0"
			>
				<div class="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-40 hover:opacity-50 transition-opacity" style="background-image: url('/img/login.png')"></div>
				<div class="z-10 flex flex-col items-center gap-2">
					<svg
						class="h-12 w-12 text-[#F66922] drop-shadow-md group-hover:scale-110 transition-transform"
						fill="currentColor"
						viewBox="0 0 24 24"
					>
						<path d="M8 5v14l11-7z" />
					</svg>
					<span class="text-[10px] font-bold uppercase tracking-wider text-white">Watch Product Walkthrough</span>
				</div>
			</div>

			<!-- Bottom Row Cards -->
			<div
				class="order-1 grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:order-2 lg:col-span-4 lg:grid-cols-4"
			>
				{#each bottomRowDemos as demo}
					<button
						onclick={() => navigateToDemo(demo.url)}
						class="flex h-40 w-full flex-col items-center justify-center rounded-lg bg-[#FFE5E5] hover:bg-[#F66922]/20 hover:text-[#F66922] font-semibold text-center font-sans text-black transition-all hover:scale-102 hover:shadow-md cursor-pointer border border-[#ffe5e5]"
					>
						{#if 'subtitle' in demo}
							<span>{demo.title}</span>
							<span class="text-xs font-normal text-gray-500 mt-1">{demo.subtitle}</span>
						{:else}
							<span>{demo.title}</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	</div>
</div>
