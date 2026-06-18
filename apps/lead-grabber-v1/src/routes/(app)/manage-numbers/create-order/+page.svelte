<script lang="ts">
	import { goto } from '$app/navigation';
	import { Info, ExternalLink } from 'lucide-svelte';

	let numbers = $state('');
	let currentStep = $state(1);

	// Calculate progress based on current step (each step is 25% of total)
	let eligibilityProgress = $state(25);

	$effect(() => {
		eligibilityProgress = (currentStep / 4) * 100;
	});

	function handleCancel() {
		goto('/manage-numbers');
	}

	function handleNext() {
		// TODO: Validate and proceed to next step
		if (currentStep < 4) {
			currentStep++;
		}
	}
</script>

<div class="min-h-screen bg-[#ECEEF3] p-4">
	<!-- Header -->
	<div class="mb-4 rounded-[3px] bg-white px-4 py-3">
		<h1 class="font-['Poppins'] text-[23px] font-semibold leading-[30px] text-[#747474]">
			Create Hosted SMS Order
		</h1>
	</div>

	<!-- Main Content Card -->
	<div class="relative rounded-lg bg-white p-6">
		<div class="flex gap-8">
			<!-- Left Side - Form -->
			<div class="flex-1">
				<!-- Step Heading -->
				<h2 class="mb-6 font-['Poppins'] text-lg font-semibold leading-[21px] text-[#777777]">
					Check Portability
				</h2>

				<!-- Form Section -->
				<div class="mb-6 space-y-4">
					<label
						class="block font-['Poppins'] text-[15px] font-semibold leading-[18px] text-[#757575]"
					>
						Paste Numbers
					</label>
					<textarea
						bind:value={numbers}
						placeholder="312 555 11112, +44 1111 1111 1111"
						class="h-[112px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 py-2 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[#BBBBBB] outline-none placeholder:text-[#BBBBBB]"
					></textarea>

					<!-- Information Text -->
					<div class="flex items-start gap-2">
						<Info class="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" />
						<p class="font-['Poppins'] text-sm leading-relaxed text-gray-700">
							Numbers must be separated by either commas or line breaks, and in
							<a href="#" class="inline-flex items-center gap-1 text-blue-600 hover:underline">
								E.164 format
								<ExternalLink class="h-3 w-3" />
							</a>
							if outside North America.
						</p>
					</div>
				</div>

				<!-- Action Buttons -->
				<div class="flex gap-3">
					<button
						onclick={handleCancel}
						class="h-[29px] rounded-[3px] border-[0.5px] border-black bg-[#ECEFF3] px-4 font-['Poppins'] text-lg font-normal leading-[21px] text-[#757575] transition-colors hover:bg-[#E0E5EA]"
					>
						Cancel
					</button>
					<button
						onclick={handleNext}
						class="h-[29px] rounded-[3px] border-[0.5px] border-[#577AB7] bg-[#577AB7] px-4 font-['Poppins'] text-lg font-medium leading-[21px] text-white transition-colors hover:bg-[#4a6ba5]"
					>
						Next
					</button>
				</div>
			</div>

			<!-- Right Side - Progress Indicator -->
			<div class="relative w-[250px] flex-shrink-0">
				<div class="relative flex gap-4">
					<!-- Single thin progress bar -->
					<div class="relative h-full w-[1px] bg-gray-200">
						<div
							class="absolute bottom-0 left-0 w-full bg-primary transition-all duration-300"
							style="height: {eligibilityProgress}%"
						></div>
					</div>

					<!-- Steps -->
					<div class="flex-1 space-y-8 py-2">
						<div>
							<h3
								class="font-['Poppins'] text-lg font-semibold leading-[21px] {currentStep >= 1
									? 'text-[#626262]'
									: 'text-[#9A9A9A]'}"
							>
								1. Check Eligibility
							</h3>
						</div>
						<div>
							<h3
								class="font-['Poppins'] text-lg font-semibold leading-[21px] {currentStep >= 2
									? 'text-[#626262]'
									: 'text-[#9A9A9A]'}"
							>
								2. Review Numbers
							</h3>
						</div>
						<div>
							<h3
								class="font-['Poppins'] text-lg font-semibold leading-[21px] {currentStep >= 3
									? 'text-[#626262]'
									: 'text-[#9A9A9A]'}"
							>
								3. Select Messaging Profile
							</h3>
						</div>
						<div>
							<h3
								class="font-['Poppins'] text-lg font-semibold leading-[21px] {currentStep >= 4
									? 'text-[#626262]'
									: 'text-[#9A9A9A]'}"
							>
								4. Submit Order
							</h3>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
