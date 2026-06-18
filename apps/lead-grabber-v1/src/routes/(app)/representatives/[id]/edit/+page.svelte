<script lang="ts">
	import { goto } from '$app/navigation';

	const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

	let name = $state('Sarah Lee');
	let email = $state('sarahlee@gmail.com');
	let phoneNumber = $state('705-4123-6346');
	let location = $state('');
	let imageFile = $state<File | null>(null);
	let cellNumber = $state('');
	let department = $state('');

	// Schedule state for each day
	let schedule = $state<Record<string, { start: string; end: string }>>({
		Monday: { start: '08:00', end: '17:00' },
		Tuesday: { start: '08:00', end: '17:00' },
		Wednesday: { start: '08:00', end: '17:00' },
		Thursday: { start: '08:00', end: '17:00' },
		Friday: { start: '08:00', end: '17:00' },
		Saturday: { start: '09:00', end: '15:00' },
		Sunday: { start: '', end: '' }
	});

	function handleBack() {
		goto('/representatives');
	}

	function handleSave() {
		// TODO: Save changes
		console.log('Save changes');
	}

	function handleFileUpload(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (file) {
			imageFile = file;
		}
	}
</script>

<div class="min-h-screen bg-[#ECEEF3] p-6">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between bg-white px-11 py-7">
		<h1 class="font-['Poppins'] text-2xl font-medium text-[#737373]">Edit Representative</h1>
		<button
			onclick={handleSave}
			class="h-[41px] rounded-[5px] bg-[#4B77BE] px-4 font-['Poppins'] text-base font-normal leading-[21px] text-white transition-colors hover:bg-[#4B77BE]/90"
		>
			Update
		</button>
	</div>

	<!-- Main Content -->
	<div class="space-y-6">
		<!-- Form Section -->
		<div class="rounded-lg bg-white p-6 shadow">
			<div class="grid grid-cols-2 gap-6">
				<div class="space-y-4">
					<div>
						<label for="name" class="mb-2 block font-['Poppins'] text-[14px] text-[#737373]">
							Name
						</label>
						<input
							type="text"
							id="name"
							bind:value={name}
							placeholder="Enter name"
							class="h-[38px] w-full rounded-[5px] border border-[#9E9E9E] bg-white px-3 font-['Poppins'] text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#4B77BE] focus-visible:ring-offset-2"
						/>
					</div>
					<div>
						<label for="email" class="mb-2 block font-['Poppins'] text-[14px] text-[#737373]">
							Email
						</label>
						<input
							type="email"
							id="email"
							bind:value={email}
							placeholder="Enter email"
							class="h-[38px] w-full rounded-[5px] border border-[#9E9E9E] bg-white px-3 font-['Poppins'] text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#4B77BE] focus-visible:ring-offset-2"
						/>
					</div>
				</div>
				<div class="space-y-4">
					<div>
						<label for="phone" class="mb-2 block font-['Poppins'] text-[14px] text-[#737373]">
							Phone Number
						</label>
						<input
							type="tel"
							id="phone"
							bind:value={phoneNumber}
							placeholder="Enter phone number"
							class="h-[38px] w-full rounded-[5px] border border-[#9E9E9E] bg-white px-3 font-['Poppins'] text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#4B77BE] focus-visible:ring-offset-2"
						/>
					</div>
					<div>
						<label for="location" class="mb-2 block font-['Poppins'] text-[14px] text-[#737373]">
							Location
						</label>
						<select
							id="location"
							bind:value={location}
							class="h-[38px] w-full appearance-none rounded-[5px] border border-[#9E9E9E] bg-white px-3 font-['Poppins'] text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#4B77BE] focus-visible:ring-offset-2"
						>
							<option value="">Select a location</option>
							<option value="thunder-bay">Thunder Bay Branch</option>
						</select>
					</div>
				</div>
			</div>
		</div>

		<!-- Schedule and Image Section -->
		<div class="grid grid-cols-2 gap-6">
			<!-- Schedule -->
			<div class="rounded-lg bg-white p-6 shadow">
				<h2 class="mb-4 font-['Poppins'] text-[18px] font-semibold text-[#737373]">
					Schedule - Time Zone: EST (Eastern Standard Time)
				</h2>
				<div class="space-y-4">
					{#each days as day}
						<div class="flex items-center">
							<span class="w-24 font-['Poppins'] text-[14px] text-[#808080]">{day}</span>
							<div class="flex gap-4">
								<input
									type="time"
									bind:value={schedule[day].start}
									class="h-[26px] w-[120.24px] rounded-[3px] border-none bg-[#E0E8F5] px-2 font-['Poppins'] text-sm"
								/>
								<input
									type="time"
									bind:value={schedule[day].end}
									class="h-[26px] w-[120.24px] rounded-[3px] border-none bg-[#E0E8F5] px-2 font-['Poppins'] text-sm"
								/>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Representative Image -->
			<div class="rounded-lg bg-white p-6 shadow">
				<h2 class="mb-4 font-['Poppins'] text-[18px] font-semibold text-[#737373]">
					Representative Image
				</h2>
				<div>
					<p class="mb-2 font-['Poppins'] text-sm text-[#737373]">Upload New Image (Optional):</p>
					<input
						type="file"
						id="avatar"
						accept="image/*"
						onchange={handleFileUpload}
						class="w-full rounded-[5px] border border-dashed border-[#9E9E9E] bg-white px-3 py-6 font-['Poppins'] text-sm"
					/>
				</div>
				<div class="mt-6 space-y-4">
					<div>
						<label for="cellNumber" class="mb-2 block font-['Poppins'] text-[14px] text-[#737373]">
							Add Permission to call Cell Number
						</label>
						<input
							type="tel"
							id="cellNumber"
							bind:value={cellNumber}
							placeholder="Enter your cell number"
							class="h-[38px] w-full rounded-[5px] border border-[#9E9E9E] bg-white px-3 font-['Poppins'] text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#4B77BE] focus-visible:ring-offset-2"
						/>
					</div>
					<div>
						<label for="department" class="mb-2 block font-['Poppins'] text-[14px] text-[#737373]">
							Select Department
						</label>
						<select
							id="department"
							bind:value={department}
							class="h-[38px] w-full appearance-none rounded-[5px] border border-[#9E9E9E] bg-white px-3 font-['Poppins'] text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#4B77BE] focus-visible:ring-offset-2"
						>
							<option value="">Select department</option>
						</select>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
