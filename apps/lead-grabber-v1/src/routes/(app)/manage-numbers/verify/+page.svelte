<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft, Globe, ChevronDown, MessageSquare, Phone } from 'lucide-svelte';

	let phoneNumber = $state('');
	let extension = $state('');
	let countryCode = $state('+1');
	let verificationMethod = $state<'sms' | 'call' | null>(null);

	function handleBack() {
		goto('/manage-numbers');
	}

	function handleVerify() {
		// TODO: Implement verification logic
		console.log('Verify:', { phoneNumber, extension, countryCode, verificationMethod });
	}
</script>

<div class="min-h-screen bg-[#ECEEF3] p-4">
	<!-- Header -->
	<div class="mb-4 rounded-[3px] bg-white px-4 py-3">
		<div class="flex items-center justify-between">
			<h1 class="font-['Poppins'] text-[23px] font-semibold leading-[30px] text-[#747474]">
				Verified Numbers
			</h1>
			<button
				onclick={handleBack}
				class="flex items-center gap-2 font-['Poppins'] text-base font-medium leading-[19px] text-[#757575] transition-colors hover:text-[#577AB7]"
			>
				<ArrowLeft class="h-4 w-4" />
				Back to Porting Request
			</button>
		</div>
	</div>

	<!-- Main Content Card -->
	<div class="rounded-lg bg-white p-6">
		<!-- Title and Description -->
		<div class="mb-6 space-y-2">
			<h2 class="font-['Poppins'] text-lg font-semibold leading-[21px] text-[#777777]">
				Verification
			</h2>
			<p class="font-['Poppins'] text-lg font-light leading-[24px] text-[#808080]">
				Confirm the ownership of your phone numbers from other providers, authenticating them
				towards Telnyx
			</p>
		</div>

		<!-- Form Card -->
		<div class="rounded-b border border-[#BEBEBE] bg-white p-6">
			<!-- Step 1: Enter Phone Number -->
			<div class="mb-8 space-y-4">
				<div class="flex items-start gap-3">
					<div
						class="mt-1 flex h-[10px] w-[10px] items-center justify-center rounded-full bg-[#D9D9D9]"
					>
						<span class="font-['Poppins'] text-xs font-semibold leading-[14px] text-[#757575]"
							>1</span
						>
					</div>
					<div class="flex-1">
						<p class="mb-4 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[#757575]">
							Enter a valid phone number you want to verify and you have access to so you can
							receive your code via SMS or phone call
						</p>

						<!-- Non-Telnyx Number -->
						<div class="mb-4 space-y-2">
							<label
								class="block font-['Poppins'] text-[15px] font-normal leading-[18px] text-[#808080]"
							>
								Non-Telnyx Number
							</label>
							<div class="flex gap-0">
								<!-- Country Code Selector -->
								<div
									class="relative flex items-center rounded-l-[2px] border border-r-0 border-[#808080] bg-[#FCFDFF] px-2"
								>
									<Globe class="h-3 w-3 text-[#757575]" />
									<select
										bind:value={countryCode}
										class="appearance-none border-none bg-transparent px-2 py-1 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[#757575] outline-none"
									>
										<option value="+1">+1</option>
										<option value="+44">+44</option>
										<option value="+33">+33</option>
									</select>
									<ChevronDown class="h-4 w-4 text-[#757575]" />
								</div>
								<!-- Phone Number Input -->
								<input
									type="text"
									bind:value={phoneNumber}
									placeholder="Your Phone Number"
									class="h-[27px] flex-1 rounded-r-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(117,117,117,0.33)] outline-none placeholder:text-[rgba(117,117,117,0.33)]"
								/>
							</div>
							<span
								class="ml-auto block text-right font-['Poppins'] text-[15px] font-normal italic leading-[18px] text-[#4F4F4F]"
							>
								Required
							</span>
						</div>

						<!-- Extension -->
						<div class="mb-4 space-y-2">
							<label
								class="block font-['Poppins'] text-base font-normal leading-[19px] text-[#808080]"
							>
								Extension
							</label>
							<input
								type="text"
								bind:value={extension}
								placeholder="www2www4w53ww3"
								class="h-[27px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(117,117,117,0.33)] outline-none placeholder:text-[rgba(117,117,117,0.33)]"
							/>
						</div>

						<!-- Consent Message -->
						<p class="font-['Poppins'] text-[15px] font-normal leading-[22px] text-[#757575]">
							You consent to receive a one time verification code from Telnyx. Standard message and
							data rates may apply. Reply STOP to opt out. For help please contact
							<a href="mailto:support@telnyx.com" class="text-[#577AB7] hover:underline">
								support@telnyx.com
							</a>
							.
						</p>
					</div>
				</div>
			</div>

			<!-- Step 2: Select Verification Method -->
			<div class="space-y-4">
				<div class="flex items-start gap-3">
					<div
						class="mt-1 flex h-[10px] w-[10px] items-center justify-center rounded-full bg-[#D9D9D9]"
					>
						<span class="font-['Poppins'] text-xs font-semibold leading-[14px] text-[#757575]"
							>2</span
						>
					</div>
					<div class="flex-1">
						<p class="mb-4 font-['Poppins'] text-lg font-normal leading-[21px] text-[#757575]">
							Select a verification method
						</p>

						<!-- Verification Method Buttons -->
						<div class="flex gap-4">
							<button
								onclick={() => (verificationMethod = 'sms')}
								class="flex h-[101px] w-[193px] flex-col items-center justify-center gap-2 rounded-[2px] border border-[#808080] bg-[#FCFDFF] transition-colors {verificationMethod ===
								'sms'
									? 'border-[#577AB7] bg-blue-50'
									: 'hover:bg-gray-50'}"
							>
								<MessageSquare class="h-6 w-6 text-[#757575]" />
								<span class="font-['Poppins'] text-xl font-normal leading-[24px] text-[#757575]"
									>SMS</span
								>
							</button>
							<button
								onclick={() => (verificationMethod = 'call')}
								class="flex h-[101px] w-[193px] flex-col items-center justify-center gap-2 rounded-[2px] border border-[#808080] bg-[#FCFDFF] transition-colors {verificationMethod ===
								'call'
									? 'border-[#577AB7] bg-blue-50'
									: 'hover:bg-gray-50'}"
							>
								<Phone class="h-6 w-6 text-[#757575]" />
								<span class="font-['Poppins'] text-xl font-normal leading-[24px] text-[#757575]"
									>Call</span
								>
							</button>
						</div>
					</div>
				</div>
			</div>

			<!-- Action Buttons -->
			<div class="mt-8 flex justify-end gap-3">
				<button
					onclick={handleBack}
					class="h-[29px] rounded-[3px] border-[0.5px] border-black bg-[#ECEFF3] px-4 font-['Poppins'] text-lg font-normal leading-[21px] text-[#757575] transition-colors hover:bg-[#E0E5EA]"
				>
					Cancel
				</button>
				<button
					onclick={handleVerify}
					disabled={!phoneNumber || !verificationMethod}
					class="h-[29px] rounded-[3px] border-[0.5px] border-[#577AB7] bg-[#577AB7] px-4 font-['Poppins'] text-lg font-medium leading-[21px] text-white transition-colors hover:bg-[#4a6ba5] disabled:cursor-not-allowed disabled:opacity-50"
				>
					Verify
				</button>
			</div>
		</div>
	</div>
</div>
