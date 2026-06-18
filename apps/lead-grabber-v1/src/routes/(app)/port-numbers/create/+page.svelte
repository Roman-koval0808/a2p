<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft, Info, ExternalLink, ChevronDown, X } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	let numbers = $state('');
	let currentStep = $state(1);
	let portabilityResults = $state<any[]>([]);
	let isLoading = $state(false);
	let orderFormData = $state<any>({
		end_user_name: '',
		authorized_person_name: '',
		account_number: '',
		billing_telephone_number: '',
		customer_reference: '',
		pin_passcode: '',
		customer_group_reference: '',
		service_address: {
			street_name: '',
			city: '',
			state: '',
			postal_code: '',
			country_code: 'US'
		},
		requested_foc_date: '',
		messaging_profile_id: '',
		connection_id: ''
	});

	$effect(() => {
		// Update progress bar based on current step (5 steps total)
		portabilityProgress = (currentStep / 5) * 100;
	});

	let portabilityProgress = $state(20); // Start at 20% for step 1

	function handleBack() {
		if (currentStep > 1) {
			currentStep--;
		} else {
			goto('/port-numbers');
		}
	}

	function handleCancel() {
		goto('/port-numbers');
	}

	async function handleCheckPortability() {
		if (!numbers.trim()) {
			toast.error('Please enter phone numbers');
			return;
		}

		isLoading = true;
		try {
			// Parse numbers from textarea (comma or newline separated)
			const phoneNumbers = numbers
				.split(/[,\n]/)
				.map((n) => n.trim())
				.filter((n) => n.length > 0);

			const response = await fetch('/api/telnyx/porting/check', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ phone_numbers: phoneNumbers })
			});

			const result = await response.json();

			if (result.success) {
				portabilityResults = result.results;
				toast.success(`Checked ${result.results.length} number(s)`);
				currentStep = 2;
			} else {
				toast.error(result.error || 'Failed to check portability');
			}
		} catch (error) {
			console.error('Portability check error:', error);
			toast.error('Error checking portability');
		} finally {
			isLoading = false;
		}
	}

	async function handleCreateOrder() {
		// Validate required fields
		if (
			!orderFormData.end_user_name ||
			!orderFormData.authorized_person_name ||
			!orderFormData.account_number ||
			!orderFormData.billing_telephone_number
		) {
			toast.error('Please fill in all required fields');
			return;
		}

		isLoading = true;
		try {
			const phoneNumbers = portabilityResults.filter((r) => r.portable).map((r) => r.number);

			if (phoneNumbers.length === 0) {
				toast.error('No portable numbers to port');
				return;
			}

			const response = await fetch('/api/telnyx/porting/orders', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					phone_numbers: phoneNumbers,
					...orderFormData
				})
			});

			const result = await response.json();

			if (result.success) {
				toast.success('Porting order created successfully');
				currentStep = 5; // Go to confirmation
			} else {
				toast.error(result.error || 'Failed to create porting order');
			}
		} catch (error) {
			console.error('Create order error:', error);
			toast.error('Error creating porting order');
		} finally {
			isLoading = false;
		}
	}

	function handleNext() {
		if (currentStep === 1) {
			handleCheckPortability();
		} else if (currentStep === 2) {
			currentStep = 3;
		} else if (currentStep === 3) {
			handleCreateOrder();
		} else if (currentStep < 5) {
			currentStep++;
		}
	}
</script>

<div class="min-h-screen bg-[#ECEEF3] p-4">
	<!-- Header -->
	<div class="mb-4 rounded-[3px] bg-white px-4 py-3">
		<div class="flex items-center justify-between">
			<h1 class="font-['Poppins'] text-[23px] font-semibold leading-[30px] text-[#747474]">
				Create Porting Request
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
	<div class="relative max-h-[calc(100vh-120px)] overflow-y-auto rounded-lg bg-white p-6">
		<div class="flex gap-8">
			<!-- Left Side - Form -->
			<div class="flex-1">
				{#if currentStep === 1}
					<!-- Step 1: Check Portability -->
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
							disabled={isLoading}
							class="h-[29px] rounded-[3px] border-[0.5px] border-[#577AB7] bg-[#577AB7] px-4 font-['Poppins'] text-lg font-medium leading-[21px] text-white transition-colors hover:bg-[#4a6ba5] disabled:opacity-50"
						>
							{isLoading ? 'Checking...' : 'Next'}
						</button>
					</div>
				{:else if currentStep === 2}
					<!-- Step 2: Create Order - Show Results Table -->
					<h2 class="mb-6 font-['Poppins'] text-lg font-semibold leading-[21px] text-[#777777]">
						Create Order
					</h2>

					<!-- Results Table -->
					<div class="mb-6 rounded-b border border-[#BEBEBE] bg-white">
						<!-- Table Headers -->
						<div class="border-b border-[#949494] px-4 py-3">
							<div
								class="grid grid-cols-4 gap-4 font-['Poppins'] text-[15px] font-medium leading-[18px] text-[#757575]"
							>
								<div>Number</div>
								<div>Status</div>
								<div>Carrier</div>
								<div>Number Type</div>
							</div>
						</div>

						<!-- Table Rows -->
						<div class="divide-y divide-[rgba(193,193,193,0.96)]">
							{#if portabilityResults.length === 0}
								<div class="px-4 py-8 text-center text-gray-500">
									No portability results. Click "Next" to check portability.
								</div>
							{:else}
								{#each portabilityResults as result}
									<div class="grid grid-cols-4 gap-4 px-4 py-3">
										<div class="font-['Poppins'] text-sm font-normal leading-[17px] text-[#808080]">
											{result.number}
										</div>
										<div class="flex items-center gap-2">
											<div class="h-[5px] w-[5px] rounded-full bg-[#04CB15]"></div>
											<span
												class="font-['Poppins'] text-sm font-normal leading-[17px] text-[#808080]"
											>
												{result.status}
											</span>
										</div>
										<div class="font-['Poppins'] text-sm font-normal leading-[17px] text-[#808080]">
											{result.carrier}
										</div>
										<div
											class="font-['Poppins'] text-[15px] font-normal leading-[18px] text-[#808080]"
										>
											{result.numberType}
										</div>
									</div>
								{/each}
							{/if}
						</div>
					</div>

					<!-- Action Buttons -->
					<div class="flex gap-3">
						<button
							onclick={handleBack}
							class="h-[39px] rounded-[3px] border-[0.5px] border-black bg-[#ECEFF3] px-4 font-['Poppins'] text-lg font-normal leading-[21px] text-[#757575] transition-colors hover:bg-[#E0E5EA]"
						>
							Back
						</button>
						<button
							onclick={handleNext}
							class="h-[39px] rounded-[3px] border-[0.5px] border-[#577AB7] bg-[#577AB7] px-4 font-['Poppins'] text-lg font-medium leading-[21px] text-white transition-colors hover:bg-[#4a6ba5]"
						>
							Create
						</button>
					</div>
				{:else if currentStep === 3}
					<!-- Step 3: Order Details -->
					<h2 class="mb-6 font-['Poppins'] text-lg font-semibold leading-[21px] text-[#777777]">
						Order Details
					</h2>

					<!-- Large Form Card -->
					<div class="mb-6 rounded-b border border-[#BEBEBE] bg-white p-6">
						<div class="space-y-8">
							<!-- End user account details -->
							<div class="space-y-4">
								<h3
									class="font-['Poppins'] text-[15px] font-semibold leading-[18px] text-[#757575]"
								>
									End user account details
								</h3>
								<p class="font-['Poppins'] text-sm font-normal leading-[17px] text-[#808080]">
									This information must match what is on file with existing carrier.
								</p>
								<div class="grid grid-cols-2 gap-4">
									<div class="space-y-2">
										<label
											class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
										>
											End user name (business name)
											<span class="ml-1 italic text-[#4F4F4F]">Required</span>
										</label>
										<input
											type="text"
											bind:value={orderFormData.end_user_name}
											class="h-[33px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none placeholder:text-[rgba(128,128,128,0.33)]"
										/>
									</div>
									<div class="space-y-2">
										<label
											class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
										>
											Authorized person name (billing contact)
											<span class="ml-1 italic text-[#4F4F4F]">Required</span>
										</label>
										<input
											type="text"
											bind:value={orderFormData.end_user_name}
											class="h-[33px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none placeholder:text-[rgba(128,128,128,0.33)]"
										/>
									</div>
									<div class="space-y-2">
										<label
											class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
										>
											Account number
											<span class="ml-1 italic text-[#4F4F4F]">Required</span>
										</label>
										<input
											type="text"
											bind:value={orderFormData.end_user_name}
											class="h-[33px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none placeholder:text-[rgba(128,128,128,0.33)]"
										/>
									</div>
									<div class="space-y-2">
										<label
											class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
										>
											Billing telephone number (BTN)
											<span class="ml-1 italic text-[#4F4F4F]">Required</span>
										</label>
										<input
											type="text"
											bind:value={orderFormData.end_user_name}
											class="h-[33px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none placeholder:text-[rgba(128,128,128,0.33)]"
										/>
									</div>
									<div class="space-y-2">
										<label
											class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
										>
											Customer reference
											<span class="ml-1 italic text-[#4F4F4F]">Required</span>
										</label>
										<input
											type="text"
											bind:value={orderFormData.end_user_name}
											class="h-[33px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none placeholder:text-[rgba(128,128,128,0.33)]"
										/>
									</div>
									<div class="space-y-2">
										<label
											class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
										>
											PIN/passcode
											<span class="ml-1 italic text-[#4F4F4F]">Required</span>
										</label>
										<input
											type="text"
											bind:value={orderFormData.end_user_name}
											class="h-[33px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none placeholder:text-[rgba(128,128,128,0.33)]"
										/>
									</div>
									<div class="space-y-2">
										<label
											class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
										>
											Customer group reference
											<span class="ml-1 italic text-[#4F4F4F]">Required</span>
										</label>
										<input
											type="text"
											bind:value={orderFormData.end_user_name}
											class="h-[33px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none placeholder:text-[rgba(128,128,128,0.33)]"
										/>
									</div>
								</div>
							</div>

							<!-- Pre-configure numbers -->
							<div class="space-y-4">
								<h3
									class="font-['Poppins'] text-[15px] font-semibold leading-[18px] text-[#757575]"
								>
									Pre-configure numbers
								</h3>
								<div class="space-y-2">
									<label
										class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
									>
										Default messaging profile
									</label>
									<div class="relative">
										<select
											class="h-[34px] w-full appearance-none rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 pr-10 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none"
										>
											<option>No profile selected</option>
										</select>
										<ChevronDown
											class="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
										/>
									</div>
									<p class="text-xs text-[#808080]">
										you can add and manage messaging profile here.
									</p>
								</div>
								<div class="space-y-2">
									<label
										class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
									>
										Default connection
									</label>
									<div class="relative">
										<select
											class="h-[34px] w-full appearance-none rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 pr-10 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none"
										>
											<option>No connection selected</option>
										</select>
										<ChevronDown
											class="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
										/>
									</div>
									<p class="text-xs text-[#808080]">you can add and manage connection here.</p>
								</div>
							</div>

							<!-- Service Address -->
							<div class="space-y-4">
								<h3
									class="font-['Poppins'] text-[15px] font-semibold leading-[18px] text-[#757575]"
								>
									Service Address
								</h3>
								<p class="font-['Poppins'] text-sm font-normal leading-[17px] text-[#808080]">
									The physical location of the phone number on record with current carrier. In the
									most cases it is not the same as the billing address.
								</p>
								<div class="grid grid-cols-2 gap-4">
									<div class="space-y-2">
										<label
											class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
										>
											Search for an address
										</label>
										<input
											type="text"
											placeholder="Enter a location"
											class="h-[33px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none placeholder:text-[rgba(128,128,128,0.33)]"
										/>
									</div>
									<div class="space-y-2">
										<label
											class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
										>
											City
										</label>
										<input
											type="text"
											placeholder="Enter a location"
											class="h-[33px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none placeholder:text-[rgba(128,128,128,0.33)]"
										/>
									</div>
									<div class="space-y-2">
										<label
											class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
										>
											State/Province/Region
										</label>
										<input
											type="text"
											placeholder="Enter a location"
											class="h-[33px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none placeholder:text-[rgba(128,128,128,0.33)]"
										/>
									</div>
									<div class="space-y-2">
										<label
											class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
										>
											ZIP/Postal Code
										</label>
										<input
											type="text"
											placeholder="Enter a location"
											class="h-[33px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none placeholder:text-[rgba(128,128,128,0.33)]"
										/>
									</div>
									<div class="space-y-2">
										<label
											class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
										>
											Country
										</label>
										<input
											type="text"
											placeholder="Enter a location"
											class="h-[33px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none placeholder:text-[rgba(128,128,128,0.33)]"
										/>
									</div>
								</div>
							</div>

							<!-- Activation Details -->
							<div class="space-y-4">
								<h3
									class="font-['Poppins'] text-[15px] font-semibold leading-[18px] text-[#757575]"
								>
									Activation Details
								</h3>
								<div class="space-y-4">
									<div>
										<p
											class="mb-2 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[#808080]"
										>
											When do you want this to activate? (Requested FOC Date)
										</p>
										<div class="flex items-center gap-4">
											<label class="flex items-center gap-2">
												<input
													type="radio"
													name="portType"
													value="full"
													class="h-[14px] w-[14px]"
												/>
												<span
													class="font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
													>Full Port</span
												>
											</label>
											<label class="flex items-center gap-2">
												<input
													type="radio"
													name="portType"
													value="partial"
													class="h-[14px] w-[14px]"
												/>
												<span
													class="font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
													>Partial Port</span
												>
											</label>
										</div>
										<p class="mt-2 text-sm text-[#808080]">Please select full or partial port</p>
									</div>
									<div class="grid grid-cols-2 gap-4">
										<div class="space-y-2">
											<label
												class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
											>
												Earliest available date
											</label>
											<input
												type="text"
												placeholder="Oct 16, 2025"
												class="h-[34px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none placeholder:text-[rgba(128,128,128,0.33)]"
											/>
										</div>
										<div class="space-y-2">
											<label
												class="block font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
											>
												Specified date
											</label>
											<input
												type="text"
												placeholder="10:00 (Local)"
												class="h-[34px] w-full rounded-[2px] border border-[#808080] bg-[#FCFDFF] px-3 font-['Poppins'] text-[15px] font-normal leading-[18px] text-[rgba(128,128,128,0.33)] outline-none placeholder:text-[rgba(128,128,128,0.33)]"
											/>
										</div>
									</div>
									<div class="space-y-2">
										<label class="flex items-center gap-2">
											<input
												type="checkbox"
												class="h-[14px] w-[14px] rounded border border-[#757575]"
											/>
											<span
												class="opacity-33 font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
											>
												I will activate the numbers myself (On Demand)
											</span>
										</label>
										<label class="flex items-center gap-2">
											<input
												type="checkbox"
												class="h-[14px] w-[14px] rounded border border-[#757575]"
											/>
											<span
												class="font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
											>
												On the confirmed activation date:
											</span>
										</label>
										<label class="flex items-center gap-2">
											<input
												type="checkbox"
												class="h-[14px] w-[14px] rounded border border-[#757575]"
											/>
											<span
												class="opacity-33 font-['Poppins'] text-sm font-medium leading-[17px] text-[#757575]"
											>
												Telnyx will activate the number automatically at the specified time
												(Schedule)
											</span>
										</label>
									</div>
								</div>
							</div>

							<!-- FastPort -->
							<div class="space-y-4">
								<h3
									class="font-['Poppins'] text-[15px] font-semibold leading-[18px] text-[#757575]"
								>
									FastPort
								</h3>
								<p class="font-['Poppins'] text-sm font-normal leading-[17px] text-[#757575]">
									This port is not eligible for the FastPort.
								</p>
							</div>
						</div>
					</div>

					<!-- Action Buttons -->
					<div class="flex gap-3">
						<button
							onclick={handleBack}
							class="h-[39px] rounded-[3px] border-[0.5px] border-black bg-[#ECEFF3] px-4 font-['Poppins'] text-lg font-normal leading-[21px] text-[#757575] transition-colors hover:bg-[#E0E5EA]"
						>
							Back
						</button>
						<button
							onclick={() => console.log('Save as draft')}
							class="h-[39px] rounded-[3px] border-[0.5px] border-[#577AB7] bg-[#577AB7] px-4 font-['Poppins'] text-lg font-medium leading-[21px] text-white transition-colors hover:bg-[#4a6ba5]"
						>
							Save as draft
						</button>
						<button
							onclick={handleNext}
							class="h-[39px] rounded-[3px] border-[0.5px] border-[#577AB7] bg-[#577AB7] px-4 font-['Poppins'] text-lg font-medium leading-[21px] text-white transition-colors hover:bg-[#4a6ba5]"
						>
							Next
						</button>
					</div>
				{:else}
					<!-- Steps 4 & 5 - Placeholder -->
					<h2 class="mb-6 font-['Poppins'] text-lg font-semibold leading-[21px] text-[#777777]">
						Step {currentStep}
					</h2>
					<p class="mb-6 text-gray-600">Content for step {currentStep} will be designed later.</p>
					<div class="flex gap-3">
						<button
							onclick={handleBack}
							class="h-[39px] rounded-[3px] border-[0.5px] border-black bg-[#ECEFF3] px-4 font-['Poppins'] text-lg font-normal leading-[21px] text-[#757575] transition-colors hover:bg-[#E0E5EA]"
						>
							Back
						</button>
						{#if currentStep < 5}
							<button
								onclick={handleNext}
								class="h-[39px] rounded-[3px] border-[0.5px] border-[#577AB7] bg-[#577AB7] px-4 font-['Poppins'] text-lg font-medium leading-[21px] text-white transition-colors hover:bg-[#4a6ba5]"
							>
								Next
							</button>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Right Side - Progress Indicator -->
			<div class="relative w-[250px] flex-shrink-0">
				<div class="relative flex gap-4">
					<!-- Single thin progress bar -->
					<div class="relative h-full w-[1px] bg-gray-200">
						<div
							class="absolute bottom-0 left-0 w-full bg-primary transition-all duration-300"
							style="height: {portabilityProgress}%"
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
								1. Check Portability
							</h3>
						</div>
						<div>
							<h3
								class="font-['Poppins'] text-lg font-semibold leading-[21px] {currentStep >= 2
									? 'text-[#626262]'
									: 'text-[#9A9A9A]'}"
							>
								2. Create Order
							</h3>
						</div>
						<div>
							<h3
								class="font-['Poppins'] text-lg font-semibold leading-[21px] {currentStep >= 3
									? 'text-[#626262]'
									: 'text-[#9A9A9A]'}"
							>
								3. Order Details
							</h3>
						</div>
						<div>
							<h3
								class="font-['Poppins'] text-lg font-semibold leading-[21px] {currentStep >= 4
									? 'text-[#626262]'
									: 'text-[#9A9A9A]'}"
							>
								4. Requirements
							</h3>
						</div>
						<div>
							<h3
								class="font-['Poppins'] text-lg font-semibold leading-[21px] {currentStep >= 5
									? 'text-[#626262]'
									: 'text-[#9A9A9A]'}"
							>
								5. Confirm Order Details
							</h3>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
