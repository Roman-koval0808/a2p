<script lang="ts">
	interface Feature {
		title: string;
		description: string;
	}

	interface ModuleData {
		module: string;
		trades: string;
		tourism: string;
		oem: string;
		services: string;
	}

	const operationsFeatures: Feature[] = [
		{
			title: 'Website + Conversion',
			description:
				'A high-speed, conversion-optimized redesign featuring modern UX and structured layouts. Engineered to turn more visitors into leads through proven CRO best practices.'
		},
		{
			title: 'SEO + GMB + Publishing',
			description:
				'Elevates local rankings via technical SEO, schema, and Google Business optimization. Drives high-intent traffic through FAQ publishing and increased brand trust.'
		},
		{
			title: 'Parsing Engine',
			description:
				'Automates industry-specific content using approved sources. Enhances EEAT signals and AI search rankings while keeping your site continuously updated and SEO-relevant.'
		}
	];

	const communicationFeatures: Feature[] = [
		{
			title: 'Instant Response',
			description:
				'AI responds to all inquiries—SMS, email, social, and missed calls—within five seconds. By eliminating slow response times, it maximizes revenue and converts more leads instantly.'
		},
		{
			title: 'AI Follow-up',
			description:
				'Automates multi-step outreach, reminders, and confirmations to ensure no lead is lost. Boosts engagement and show-up rates while significantly reducing staff workload.'
		},
		{
			title: 'Communications HUB',
			description:
				'Unifies messages & transcripts into 1 inbox. AI analyzes intent and urgency to draft accurate replies for approval, eliminating scattered communication and missed opportunities.'
		},
		{
			title: 'Conversational AI',
			description:
				'AI interprets context and drafts accurate responses using industry and business-specific knowledge. This ensures brand consistency while slashing manual typing for your team.'
		},
		{
			title: 'ViewRoom',
			description:
				'A virtual environment for guided walk-throughs and proposal reviews. Reduces uncertainty and accelerates decisions—high impact for trades, manufacturing, and tourism.'
		}
	];

	const revenueData: ModuleData[] = [
		{
			module: 'Instant Response',
			trades: '22.2%',
			tourism: '21.5%',
			oem: '21.4%',
			services: '27.8%'
		},
		{ module: 'AI Follow Up', trades: '15.1%', tourism: '13.8%', oem: '16.1%', services: '22.2%' },
		{
			module: 'Website rebuild',
			trades: '12.7%',
			tourism: '12.3%',
			oem: '17.9%',
			services: '25.0%'
		},
		{
			module: 'SEO + GBP Publishing',
			trades: '19.8%',
			tourism: '15.4%',
			oem: '12.5%',
			services: '22.2%'
		},
		{
			module: 'Conversational AI',
			trades: '11.1%',
			tourism: '6.2%',
			oem: '7.1%',
			services: '5.6%'
		},
		{ module: 'ViewRoom', trades: '7.9%', tourism: '13.8%', oem: '8.9%', services: '5.6%' },
		{ module: 'Parsing Engine', trades: '6.3%', tourism: '7.7%', oem: '10.7%', services: '11.1%' },
		{
			module: 'Operational Efficiency',
			trades: '7.1%',
			tourism: '9.2%',
			oem: '9.2%',
			services: '6.3%'
		}
	];
</script>

<div class="w-full bg-white py-4 md:py-16">
	<div class="mx-auto max-w-[1440px] px-0 md:px-8">
		<div class="grid grid-cols-1 gap-12 lg:grid-cols-2">
			<!-- Left Column: Revenue Growth Breakdown Table -->
			<div class="w-full">
				<div class="overflow-x-auto px-4 md:px-0">
					<table class="w-full min-w-[360px] border-separate border-spacing-1">
						<thead>
							<tr>
								<th
									class="bg-[#0F172B] px-2 py-3 text-center text-[14px] font-bold leading-5 text-white"
									style="width: 115px;"
								>
									Module
								</th>
								<th
									class="bg-[#0F172B] px-2 py-3 text-center text-[14px] font-bold leading-5 text-white"
									style="width: 53px;"
								>
									Trades
								</th>
								<th
									class="bg-[#0F172B] px-2 py-3 text-center text-[14px] font-bold leading-5 text-white"
									style="width: 53px;"
								>
									Tourism
								</th>
								<th
									class="bg-[#0F172B] px-2 py-3 text-center text-[14px] font-bold leading-5 text-white"
									style="width: 53px;"
								>
									OEM
								</th>
								<th
									class="bg-[#0F172B] px-2 py-3 text-center text-[14px] font-bold leading-5 text-white"
									style="width: 54px;"
								>
									Services
								</th>
							</tr>
						</thead>
						<tbody>
							{#each revenueData as row}
								<tr>
									<td
										class="bg-[#F66922] px-2 py-3 text-center text-[14px] font-bold leading-5 text-white"
										style="width: 115px;"
									>
										{row.module}
									</td>
									<td
										class="bg-[#D9D9D9] px-2 py-3 text-center text-[14px] font-bold leading-5 text-[#0F172B]"
										style="width: 53px;"
									>
										{row.trades}
									</td>
									<td
										class="bg-[#D9D9D9] px-2 py-3 text-center text-[14px] font-bold leading-5 text-[#0F172B]"
										style="width: 53px;"
									>
										{row.tourism}
									</td>
									<td
										class="bg-[#D9D9D9] px-2 py-3 text-center text-[14px] font-bold leading-5 text-[#0F172B]"
										style="width: 53px;"
									>
										{row.oem}
									</td>
									<td
										class="bg-[#D9D9D9] px-2 py-3 text-center text-[14px] font-bold leading-5 text-[#0F172B]"
										style="width: 54px;"
									>
										{row.services}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>

			<!-- Right Column: Engines (Hidden on mobile as per design image) -->
			<div class="hidden w-full flex-col gap-12 md:flex">
				<!-- Operations Engine -->
				<div class="w-full">
					<h3 class="mb-6 text-center text-xl font-bold leading-7 text-[#F66922]">
						OPERATIONS ENGINE
					</h3>
					<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
						{#each operationsFeatures as feature}
							<div class="flex flex-col">
								<h4 class="mb-2 text-sm font-bold leading-5 text-[#090F31]">{feature.title}</h4>
								<p class="text-xs font-medium leading-[17px] text-[#090F31]">
									{feature.description}
								</p>
							</div>
						{/each}
					</div>
				</div>

				<!-- Communication Engine -->
				<div class="w-full">
					<h3 class="mb-6 text-center text-xl font-bold leading-7 text-[#F66922]">
						COMMUNICATION ENGINE
					</h3>
					<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
						{#each communicationFeatures as feature}
							<div class="flex flex-col">
								<h4
									class="mb-2 text-sm font-bold leading-5 text-[#090F31] {feature.title ===
										'Conversational AI' || feature.title === 'ViewRoom'
										? 'text-center'
										: ''}"
								>
									{feature.title}
								</h4>
								<p class="text-xs font-medium leading-[17px] text-[#090F31]">
									{feature.description}
								</p>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	:global(body) {
		font-family:
			'Source Sans 3',
			system-ui,
			-apple-system,
			sans-serif;
	}

	/* Custom spacing to match design precisely if needed */
	td,
	th {
		white-space: nowrap;
	}
</style>
