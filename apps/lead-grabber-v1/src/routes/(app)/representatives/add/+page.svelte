<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';

	const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

	let firstName = $state('');
	let lastName = $state('');
	let email = $state('');
	let phoneNumber = $state('');
	let location = $state('');
	let imageFile = $state<File | null>(null);

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

	function handleCancel() {
		goto('/representatives');
	}

	function handleFileUpload(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (file) {
			imageFile = file;
		}
	}
</script>

<form method="POST" action="?/addRepresentative" use:enhance class="min-h-screen bg-[#ECEEF3] p-6">
	<!-- Hidden input to send JSON schedule string -->
	<input type="hidden" name="schedule" value={JSON.stringify(schedule)} />

	<!-- Header -->
	<div class="mb-6 flex items-center justify-between bg-white px-11 py-7">
		<h1 class="font-['Poppins'] text-2xl font-medium text-[#737373]">Add Representatives</h1>
		<div class="flex gap-2">
			<button
				type="button"
				onclick={handleCancel}
				class="h-[41px] rounded-[5px] bg-[#E0E0E0] px-4 font-['Poppins'] text-base font-normal leading-[21px] text-[#737373] transition-colors hover:bg-[#D0D0D0]"
			>
				Cancel
			</button>
			<button
				type="submit"
				class="h-[41px] rounded-[5px] bg-[#4B77BE] px-4 font-['Poppins'] text-base font-normal leading-[21px] text-white transition-colors hover:bg-[#4B77BE]/90"
			>
				Save and Add
			</button>
		</div>
	</div>

	<!-- Main Content -->
	<div class="space-y-6">
		<!-- Form Section -->
		<div class="rounded-lg bg-white p-6 shadow">
			<div class="grid grid-cols-2 gap-6">
				<div class="space-y-4">
					<div>
						<label for="first_name" class="mb-2 block font-['Poppins'] text-[14px] text-[#737373]">
							First Name
						</label>
						<input
							type="text"
							id="first_name"
							name="firstName"
							bind:value={firstName}
							placeholder="Enter first name"
							class="h-[38px] w-full rounded-[5px] border border-[#9E9E9E] bg-white px-3 font-['Poppins'] text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#4B77BE] focus-visible:ring-offset-2"
						/>
					</div>
					<div>
						<label for="last_name" class="mb-2 block font-['Poppins'] text-[14px] text-[#737373]">
							Last Name
						</label>
						<input
							type="text"
							id="last_name"
							name="lastName"
							bind:value={lastName}
							placeholder="Enter last name"
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
							name="email"
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
							name="phoneNumber"
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
							name="location"
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

			<!-- Add Image -->
			<div class="rounded-lg bg-white p-6 shadow">
				<h2 class="mb-4 font-['Poppins'] text-[18px] font-semibold text-[#737373]">Add Image</h2>
				<input
					type="file"
					id="avatar"
					accept="image/*"
					onchange={handleFileUpload}
					class="w-full rounded-[5px] border border-dashed border-[#9E9E9E] bg-white px-3 py-6 font-['Poppins'] text-sm"
				/>
			</div>
		</div>
	</div>
</form>
