<script lang="ts">
	import EnginesSection from '$lib/components/EnginesSection.svelte';
	import DemoSection from '$lib/components/DemoSection.svelte';
</script>

<div class="min-h-screen bg-white text-[#0F172B]">
	<!-- ============================================= -->
	<!-- DESKTOP VIEW (Previous Design) -->
	<!-- ============================================= -->
	<div class="hidden md:block">
		<!-- Top Left Logo -->
		<div class="absolute left-8 top-8">
			<img src="/img/clearsky-orange.png" alt="ClearSky Logo" class="h-24 w-auto object-contain" />
		</div>

		<div class="mx-auto max-w-[1400px] px-8 py-12">
			<!-- Main Header -->
			<div class="mb-16 flex flex-col items-center text-center">
				<h1 class="text-4xl font-black tracking-tight text-[#F66922] lg:text-5xl">
					ClearSky Business Platform
				</h1>
				<p class="mt-4 text-lg font-bold text-[#0F172B]">
					Grow Revenue by 72-118% using ClearSky's Playbook
				</p>
			</div>

			<div class="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-8">
				<!-- Left Column - Chart & Description (7 columns) -->
				<div class="lg:col-span-7">
					<div class="flex flex-col md:flex-row md:items-start md:gap-8">
						<!-- Chart -->
						<div class="w-full md:w-3/4">
							<img src="/img/home-graph.png" alt="Revenue Lift Graph" class="h-auto w-full" />
						</div>
					</div>

					<!-- Description Paragraph -->
					<div class="mt-10 max-w-2xl">
						<p class="text-lg font-semibold leading-[1.6] text-[#0F172B]">
							72–118% revenue lift doesn't come from harder work—it comes from removing human
							constraints. AI answers instantly, follows up flawlessly, and never drops a message,
							accounting for nearly half the gains. The rest comes from strengthening website
							performance, SEO, visibility, and content. Below is a conservative breakdown of how
							the 8 modules in your license contribute to this outcome.
						</p>
					</div>
				</div>

				<!-- Right Column - Character & Overlay (5 columns) -->
				<div class="relative flex justify-end lg:col-span-5">
					<div class="relative w-full max-w-[550px]">
						<img
							src="/img/home-img.png"
							alt="ClearSky Platform Illustration"
							class="h-auto w-full object-contain"
						/>
					</div>
				</div>
			</div>
		</div>

		<!-- Shared Sections for Desktop -->
		<EnginesSection />
		<DemoSection />
	</div>

	<!-- ============================================= -->
	<!-- MOBILE VIEW (New Fixed Design) -->
	<!-- ============================================= -->
	<div class="md:hidden">
		<!-- Mobile/Responsive Container -->
		<div class="mx-auto w-full">
			<!-- 1. Header Section -->
			<header class="relative px-4 py-4">
				<div class="flex items-center justify-between">
					<img
						src="/img/clearsky-orange.png"
						alt="ClearSky Logo"
						class="h-10 w-auto object-contain"
					/>
					<!-- Play Button Placeholder -->
					<div class="mr-4">
						<svg
							width="48"
							height="34"
							viewBox="0 0 48 34"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
							class="h-auto w-12"
						>
							<rect width="48" height="34" rx="8" fill="#FF0000" />
							<path d="M31 17L20 23.9282V10.0718L31 17Z" fill="white" />
						</svg>
					</div>
				</div>
			</header>

			<!-- 2. Main Title Section -->
			<div class="px-4 py-2 text-center">
				<h1 class="text-3xl font-black uppercase tracking-tight text-[#F66922]">
					ClearSky Business PLatform
				</h1>
			</div>

			<!-- 3. Banner Block -->
			<div class="bg-[#0F172B] px-4 py-4 text-center">
				<h2 class="text-xl font-bold text-white">AI helps lift Revenue Growth</h2>
				<p class="text-lg font-medium text-white/90">by 72-118%</p>
			</div>

			<!-- 4. Hero Illustration Section -->
			<div class="relative flex justify-center px-4 py-4">
				<div class="relative w-full max-w-[600px]">
					<img
						src="/img/home-img.png"
						alt="ClearSky Platform Illustration"
						class="h-auto w-full object-contain"
					/>
				</div>
			</div>

			<!-- Divider 1 -->
			<div class="mx-auto my-4 h-[1px] w-[90%] bg-[#D0D0D0] shadow-sm"></div>

			<!-- 5. Sector Revenue Growth Section -->
			<section class="px-4 py-8">
				<div class="mb-6">
					<h3 class="text-2xl font-bold uppercase text-[#090F31]">SECTOR REVENUE GROWTH</h3>
				</div>

				<div class="flex flex-col gap-8">
					<!-- Bar Charts -->
					<div class="flex flex-1 flex-col gap-3">
						<div class="flex h-10 w-full">
							<div
								class="flex items-center bg-[#1F77B4] px-4 font-bold text-white"
								style="width: 61%;"
							>
								Services 72%
							</div>
						</div>
						<div class="flex h-10 w-full">
							<div
								class="flex items-center bg-[#FF7F0E] px-4 font-bold text-white"
								style="width: 68%;"
							>
								OEM 80%
							</div>
						</div>
						<div class="flex h-10 w-full">
							<div
								class="flex items-center bg-[#14AA14] px-4 font-bold text-white"
								style="width: 68%;"
							>
								Tourism 80%
							</div>
						</div>
						<div class="flex h-10 w-full">
							<div
								class="flex items-center bg-[#847C7C] px-4 font-bold text-white"
								style="width: 100%;"
							>
								Trades 118%
							</div>
						</div>
					</div>

					<!-- Source Text Box -->
					<div class="bg-[#23232A] p-6 text-center text-white">
						<p class="text-sm font-medium leading-relaxed">
							Lift projection based on research from Harvard, Hubspot, Salesforce, Google, Nielsen,
							Moz Gartner, Mckinsey,
						</p>
					</div>
				</div>
			</section>

			<!-- 6. Explanation Block -->
			<div class="bg-[#0F172B] px-4 py-8 text-center text-white">
				<p class="mx-auto max-w-3xl text-lg font-bold leading-relaxed">
					Let's be honest 72–118% growth isn't humanly possible, most of growth results comes from
					using AI. Instant replies, perfect follow-up, no missed messages. The rest comes from
					better website, SEO, and visibility. See breakdown below.
				</p>
			</div>

			<!-- 7 & 8. Drive Growth Table Section -->
			<section class="bg-white py-12">
				<h4 class="mb-8 text-center text-xl font-bold">How we Drive Growth 72 – 118%</h4>
				<EnginesSection />
			</section>

			<!-- Divider 2 -->
			<div class="mx-auto my-8 h-[1px] w-[90%] bg-[#D0D0D0] shadow-sm"></div>

			<!-- 9. Questions Section -->
			<section class="px-4 py-12">
				<h3 class="mb-8 text-center text-2xl font-bold text-[#F66922]">
					2 questions you should be asking?
				</h3>

				<div class="mx-auto flex max-w-3xl flex-col gap-12">
					<div class="flex flex-col gap-4">
						<p class="text-lg font-semibold text-[#001F3C]">
							1st Question: What if the projections we use in our model materialize?
						</p>
						<div class="rounded-[20px] border border-[#5E5858] bg-white p-6 shadow-sm">
							<p class="font-semibold italic text-[#001F3C]">
								Answer: Your companies revenue jumps, you dominate your market, ensure business
								continuity, and reap the rewards of an early adopter.
							</p>
						</div>
					</div>

					<div class="flex flex-col gap-4">
						<p class="text-lg font-semibold text-[#001F3C]">
							2nd Question: What if the projections are completely false?
						</p>
						<div class="rounded-[20px] border border-[#5E5858] bg-white p-6 shadow-sm">
							<p class="font-semibold italic text-[#001F3C]">
								Answer: You remain exactly where you are today—while gaining valuable strategic
								information about AI readiness, operational gaps, and future competitiveness
							</p>
						</div>
					</div>
				</div>
			</section>

			<!-- 10. Phase Summary Section -->
			<section class="bg-white px-4 py-8">
				<div class="mx-auto max-w-3xl">
					<p class="text-base font-bold leading-relaxed text-[#001F3C]">
						A quick summary, transformation of your business starts with Phase 1. Cost is $75.00/mo
						(first 40) includes a website and 4 hours of support. Phase 2 includes AI modules
						(Communication Log, AI Assistant, AI automation, View Room) costs $75.00/mo. Phase 3
						sector specific modules, Founders will be able to add one additional module without
						cost.
					</p>
				</div>
			</section>

			<!-- 11. Buttons Section -->
			<section class="flex flex-col items-center gap-4 px-4 py-12">
				<button
					class="w-full max-w-sm rounded-[18px] bg-[#F54900] py-4 text-center text-sm font-extrabold uppercase text-white shadow-lg transition-transform hover:scale-105"
				>
					CHECK AVAILABILITY
				</button>
				<button
					class="w-full max-w-sm rounded-[18px] bg-[#F54900] py-4 text-center text-sm font-extrabold uppercase text-white shadow-lg transition-transform hover:scale-105"
				>
					PDF
				</button>
				<button
					class="w-full max-w-sm rounded-[18px] bg-[#14AA14] py-4 text-center text-sm font-extrabold uppercase text-white shadow-lg transition-transform hover:scale-105"
				>
					Book a demo
				</button>
			</section>

			<!-- 12. Footer / Contact -->
			<footer class="relative px-4 py-8 text-center text-[#090F31]">
				<p class="mb-4 text-[10px] font-bold leading-relaxed">
					If you have any questions, please reach out to +1 705-274-9564 or email:
					r.dredhart@clearskysoftware.net
				</p>
			</footer>
		</div>
	</div>
</div>

<style>
	:global(html) {
		background-color: white;
	}
	:global(body) {
		margin: 0;
		padding: 0;
		overflow-x: hidden;
		font-family: 'Source Sans 3', sans-serif;
	}
</style>
