<script lang="ts">
	import { goto } from '$app/navigation';
	import { Pencil, Trash2 } from 'lucide-svelte';
	import { page } from '$app/state';

	// Mock data - in real app, fetch based on page.params.id
	const representative = {
		id: '1',
		name: 'Sarah Lee',
		phone: '705-4123-6346',
		email: 'sarahlee@gmail.com',
		location: 'Thunder Bay Branch',
		schedule: {
			Monday: '8:00AM - 5:00PM',
			Tuesday: '8:00AM - 5:00PM',
			Wednesday: '8:00AM - 5:00PM',
			Thursday: '8:00AM - 5:00PM',
			Friday: '8:00AM - 5:00PM',
			Saturday: 'Closed',
			Sunday: 'Closed'
		},
		rooms: ['Test 2', 'Test 3']
	};

	const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

	function handleEdit() {
		goto(`/representatives/${representative.id}/edit`);
	}

	function handleDelete() {
		// TODO: Implement delete
		console.log('Delete:', representative.id);
	}

	function handleSave() {
		// TODO: Save changes
		console.log('Save changes');
	}
</script>

<div class="min-h-screen bg-[#ECEEF3] p-6">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between bg-white px-11 py-7">
		<h1 class="font-['Poppins'] text-2xl font-medium text-[#737373]">Representative</h1>
		<button
			onclick={handleSave}
			class="h-[41px] rounded-[5px] bg-[#4B77BE] px-4 font-['Poppins'] text-base font-normal leading-[21px] text-white transition-colors hover:bg-[#4B77BE]/90"
		>
			Save Changes
		</button>
	</div>

	<!-- Representative Summary Card -->
	<div class="mb-6 rounded-lg bg-white p-6 shadow">
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
			<div>
				<p class="mb-1 font-['Poppins'] text-lg font-medium leading-[23px] text-[#565656]">Name:</p>
				<p class="font-['Poppins'] text-lg font-normal leading-[23px] text-[rgba(86,86,86,0.78)]">
					{representative.name}
				</p>
			</div>
			<div>
				<p class="mb-1 font-['Poppins'] text-lg font-medium leading-[23px] text-[#565656]">
					Phone:
				</p>
				<p class="font-['Poppins'] text-lg font-normal leading-[23px] text-[rgba(86,86,86,0.78)]">
					{representative.phone}
				</p>
			</div>
			<div>
				<p class="mb-1 font-['Poppins'] text-lg font-medium leading-[23px] text-[#565656]">
					Email:
				</p>
				<p class="font-['Poppins'] text-lg font-normal leading-[23px] text-[rgba(86,86,86,0.78)]">
					{representative.email}
				</p>
			</div>
			<div>
				<p class="mb-1 font-['Poppins'] text-lg font-medium leading-[23px] text-[#565656]">
					Location:
				</p>
				<p
					class="mb-4 font-['Poppins'] text-lg font-normal leading-[23px] text-[rgba(86,86,86,0.78)]"
				>
					{representative.location}
				</p>
				<div class="flex items-center gap-3">
					<p class="font-['Poppins'] text-lg font-medium leading-[23px] text-[#565656]">Actions:</p>
					<button
						onclick={handleEdit}
						class="text-[#7B7B7B] transition-colors hover:text-[#577AB7]"
					>
						<Pencil class="h-[18px] w-[18px]" />
					</button>
					<button
						onclick={handleDelete}
						class="text-[#7B7B7B] transition-colors hover:text-red-500"
					>
						<Trash2 class="h-[18px] w-[18px]" />
					</button>
				</div>
			</div>
		</div>
	</div>

	<!-- Schedule and Rooms Cards -->
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
		<!-- Schedule Card -->
		<div class="rounded-lg bg-white p-6 shadow">
			<h2 class="mb-4 font-['Poppins'] text-[18px] font-semibold text-[#737373]">Schedule</h2>
			<div class="rounded-[3px] bg-[#E0E8F5] p-4">
				<div class="grid grid-cols-[auto_1fr] gap-x-4 text-[14px]">
					<div class="space-y-[10px] text-[#808080]">
						<div>Monday</div>
						<div>Tuesday</div>
						<div>Wednesday</div>
						<div>Thursday</div>
						<div>Friday</div>
						<div>Saturday</div>
						<div>Sunday</div>
					</div>
					<div class="space-y-[10px] text-[#808080]">
						<div>{representative.schedule.Monday}</div>
						<div>{representative.schedule.Tuesday}</div>
						<div>{representative.schedule.Wednesday}</div>
						<div>{representative.schedule.Thursday}</div>
						<div>{representative.schedule.Friday}</div>
						<div>{representative.schedule.Saturday}</div>
						<div>{representative.schedule.Sunday}</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Rooms Connected Card -->
		<div class="rounded-lg bg-white p-6 shadow">
			<h2 class="mb-4 font-['Poppins'] text-[18px] font-semibold text-[#737373]">
				Rooms Connected to:
			</h2>
			<div class="rounded-[3px] bg-[#E0E8F5] p-4">
				{#if representative.rooms.length > 0}
					<div class="space-y-[10px]">
						{#each representative.rooms as room}
							<div class="flex items-center gap-2">
								<input type="checkbox" checked class="h-5 w-5 rounded border border-[#848484]" />
								<span class="font-['Poppins'] text-[14px] text-[#808080]">{room}</span>
							</div>
						{/each}
					</div>
				{:else}
					<div class="py-4 text-center font-['Poppins'] text-[14px] text-[#808080]">
						No rooms connected to this representative
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
