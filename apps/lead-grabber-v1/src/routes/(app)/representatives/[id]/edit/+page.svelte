<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';

	let { data } = $props<{
		data: {
			rep: {
				id: string;
				name: string;
				email: string;
				avatar: string | null;
				phone: string;
				cell: string;
				location: string;
				department: string;
				schedule: Record<string, { start: string; end: string }>;
			};
			locations: { id: string; name: string }[];
		};
	}>();

	const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
	const departmentOptions = ['General', 'Sales', 'Support', 'Dispatch', 'Billing', 'Management'];

	let saving = $state(false);
	let name = $state(data.rep.name);
	let email = $state(data.rep.email);
	let phoneNumber = $state(data.rep.phone);
	let cellNumber = $state(data.rep.cell);
	let location = $state(data.rep.location);
	let department = $state(data.rep.department);
	let schedule = $state<Record<string, { start: string; end: string }>>(
		Object.fromEntries(
			days.map((d) => [
				d,
				{ start: data.rep.schedule?.[d]?.start ?? '', end: data.rep.schedule?.[d]?.end ?? '' }
			])
		)
	);

	// Keep the current saved value selectable even if it isn't in the company's location list.
	const locationOptions = $derived(
		location && !data.locations.some((l: { id: string; name: string }) => l.name === location)
			? [{ id: '_current', name: location }, ...data.locations]
			: data.locations
	);
	const departmentChoices = $derived(
		department && !departmentOptions.includes(department)
			? [department, ...departmentOptions]
			: departmentOptions
	);

	const initials = $derived(
		(name || email || '?')
			.trim()
			.charAt(0)
			.toUpperCase()
	);

	function handleBack() {
		goto('/representatives');
	}
</script>

<div class="min-h-screen bg-[#ECEEF3] p-6">
	<form
		method="POST"
		action="?/save"
		use:enhance={() => {
			saving = true;
			return async ({ result, update }) => {
				await update({ reset: false });
				saving = false;
				if (result.type === 'success') {
					toast.success('Representative updated');
				} else if (result.type === 'failure') {
					toast.error((result.data as { error?: string })?.error || 'Could not save changes');
				}
			};
		}}
	>
		<!-- Hidden field carrying the schedule as JSON. -->
		<input type="hidden" name="schedule" value={JSON.stringify(schedule)} />

		<!-- Header -->
		<div class="mb-6 flex items-center justify-between bg-white px-11 py-7">
			<div class="flex items-center gap-3">
				<button
					type="button"
					onclick={handleBack}
					class="font-['Poppins'] text-sm text-[#737373] hover:text-[#4B77BE]"
				>
					&larr; Back
				</button>
				<h1 class="font-['Poppins'] text-2xl font-medium text-[#737373]">Edit Representative</h1>
			</div>
			<button
				type="submit"
				disabled={saving}
				class="h-[41px] rounded-[5px] bg-[#4B77BE] px-4 font-['Poppins'] text-base font-normal leading-[21px] text-white transition-colors hover:bg-[#4B77BE]/90 disabled:cursor-not-allowed disabled:opacity-60"
			>
				{saving ? 'Saving…' : 'Update'}
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
								name="name"
								bind:value={name}
								placeholder="Enter name"
								class="h-[38px] w-full rounded-[5px] border border-[#9E9E9E] bg-white px-3 font-['Poppins'] text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#4B77BE] focus-visible:ring-offset-2"
							/>
						</div>
						<div>
							<label for="email" class="mb-2 block font-['Poppins'] text-[14px] text-[#737373]">
								Email <span class="text-xs text-gray-400">(read-only)</span>
							</label>
							<input
								type="email"
								id="email"
								bind:value={email}
								readonly
								class="h-[38px] w-full cursor-not-allowed rounded-[5px] border border-[#E0E0E0] bg-gray-50 px-3 font-['Poppins'] text-sm text-gray-500 outline-none"
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
								name="phone"
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
								{#each locationOptions as loc}
									<option value={loc.name}>{loc.name}</option>
								{/each}
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

				<!-- Representative Image + extra details -->
				<div class="rounded-lg bg-white p-6 shadow">
					<h2 class="mb-4 font-['Poppins'] text-[18px] font-semibold text-[#737373]">
						Representative
					</h2>
					<div class="flex items-center gap-4">
						{#if data.rep.avatar}
							<img
								src={data.rep.avatar}
								alt={name}
								class="h-16 w-16 rounded-full border border-[#E0E0E0] object-cover"
							/>
						{:else}
							<div
								class="flex h-16 w-16 items-center justify-center rounded-full border border-[#E0E0E0] bg-[#E0E8F5] font-['Poppins'] text-xl font-bold text-[#4B77BE]"
							>
								{initials}
							</div>
						{/if}
						<div class="min-w-0">
							<p class="truncate font-['Poppins'] text-sm font-medium text-[#565656]">{name || '—'}</p>
							<p class="truncate font-['Poppins'] text-xs text-[#808080]">{email}</p>
						</div>
					</div>
					<div class="mt-6 space-y-4">
						<div>
							<label for="cellNumber" class="mb-2 block font-['Poppins'] text-[14px] text-[#737373]">
								Cell Number
							</label>
							<input
								type="tel"
								id="cellNumber"
								name="cell"
								bind:value={cellNumber}
								placeholder="Enter cell number"
								class="h-[38px] w-full rounded-[5px] border border-[#9E9E9E] bg-white px-3 font-['Poppins'] text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#4B77BE] focus-visible:ring-offset-2"
							/>
						</div>
						<div>
							<label for="department" class="mb-2 block font-['Poppins'] text-[14px] text-[#737373]">
								Department
							</label>
							<select
								id="department"
								name="department"
								bind:value={department}
								class="h-[38px] w-full appearance-none rounded-[5px] border border-[#9E9E9E] bg-white px-3 font-['Poppins'] text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#4B77BE] focus-visible:ring-offset-2"
							>
								<option value="">Select department</option>
								{#each departmentChoices as dept}
									<option value={dept}>{dept}</option>
								{/each}
							</select>
						</div>
					</div>
				</div>
			</div>
		</div>
	</form>
</div>
