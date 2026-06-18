<script lang="ts">
	import { goto } from '$app/navigation';
	import { MoreHorizontal } from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	// Mock data for representatives
	const representatives = [
		{
			id: '1',
			name: 'Sarah Lee',
			phone: '705-4123-6346',
			email: 'sarahlee@gmail.com',
			location: 'Thunder Bay Branch',
			schedule: {
				monday: '8:00AM - 5:00PM',
				tuesday: '8:00AM - 5:00PM',
				wednesday: '8:00AM - 5:00PM',
				thursday: '8:00AM - 5:00PM',
				friday: '8:00AM - 5:00PM',
				saturday: '9:00AM - 3:00PM',
				sunday: 'Closed'
			},
			rooms: ['Test 2', 'Test 3']
		},
		{
			id: '2',
			name: 'Peter Griffin',
			phone: '705-6433-2564',
			email: 'petergriffin@gmail.com',
			location: 'Thunder Bay Branch',
			schedule: {
				monday: '8:00AM - 5:00PM',
				tuesday: '8:00AM - 5:00PM',
				wednesday: '8:00AM - 5:00PM',
				thursday: '8:00AM - 5:00PM',
				friday: '8:00AM - 5:00PM',
				saturday: '9:00AM - 3:00PM',
				sunday: 'Closed'
			},
			rooms: []
		},
		{
			id: '3',
			name: 'Michael Scofield',
			phone: '705-9755-1953',
			email: 'michaelscofield@gmail.com',
			location: 'Thunder Bay Branch',
			schedule: {
				monday: '8:00AM - 5:00PM',
				tuesday: '8:00AM - 5:00PM',
				wednesday: '8:00AM - 5:00PM',
				thursday: '8:00AM - 5:00PM',
				friday: '8:00AM - 5:00PM',
				saturday: '9:00AM - 3:00PM',
				sunday: 'Closed'
			},
			rooms: []
		},
		{
			id: '4',
			name: 'Joe Swanson',
			phone: '705-9012-0124',
			email: 'joeswanson@gmail.com',
			location: 'Thunder Bay Branch',
			schedule: {
				monday: '8:00AM - 5:00PM',
				tuesday: '8:00AM - 5:00PM',
				wednesday: '8:00AM - 5:00PM',
				thursday: '8:00AM - 5:00PM',
				friday: '8:00AM - 5:00PM',
				saturday: '9:00AM - 3:00PM',
				sunday: 'Closed'
			},
			rooms: []
		},
		{
			id: '5',
			name: 'Adam West',
			phone: '705-7812-3321',
			email: 'adamwest@gmail.com',
			location: 'Thunder Bay Branch',
			schedule: {
				monday: '8:00AM - 5:00PM',
				tuesday: '8:00AM - 5:00PM',
				wednesday: '8:00AM - 5:00PM',
				thursday: '8:00AM - 5:00PM',
				friday: '8:00AM - 5:00PM',
				saturday: '9:00AM - 3:00PM',
				sunday: 'Closed'
			},
			rooms: []
		},
		{
			id: '6',
			name: 'Cleveland Brown',
			phone: '705-0091-7542',
			email: 'clevelandbrown@gmail.com',
			location: 'Thunder Bay Branch',
			schedule: {
				monday: '8:00AM - 5:00PM',
				tuesday: '8:00AM - 5:00PM',
				wednesday: '8:00AM - 5:00PM',
				thursday: '8:00AM - 5:00PM',
				friday: '8:00AM - 5:00PM',
				saturday: '9:00AM - 3:00PM',
				sunday: 'Closed'
			},
			rooms: []
		}
	];

	let expandedRep: string | null = $state(null);

	function handleAdd() {
		goto('/representatives/add');
	}

	function handleEdit(id: string) {
		goto(`/representatives/${id}/edit`);
	}

	function handleDelete(id: string) {
		// TODO: Implement delete
		console.log('Delete:', id);
	}

	function toggleExpand(id: string) {
		expandedRep = expandedRep === id ? null : id;
	}
</script>

<div class="min-h-screen bg-[#ECEEF3] p-6">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between rounded-lg bg-white p-4">
		<h1 class="font-['Poppins'] text-2xl font-medium text-[#737373]">Representatives</h1>
		<button
			onclick={handleAdd}
			class="h-[41px] rounded-[5px] bg-[#4B77BE] px-4 font-['Poppins'] text-base font-normal leading-[21px] text-white transition-colors hover:bg-[#4B77BE]/90"
		>
			Add Representative
		</button>
	</div>

	<!-- Table -->
	<div class="rounded-lg">
		<!-- Table Header -->
		<div
			class="mb-5 grid grid-cols-[80px_1fr_1fr_1fr_1fr_100px] gap-4 rounded-lg border-b border-[#BEBEBE] bg-white p-4 text-sm font-bold text-[#737373]"
		>
			<div>Icon</div>
			<div>Name</div>
			<div>Phone</div>
			<div>Email</div>
			<div>Location</div>
			<div></div>
		</div>

		<!-- Table Body -->
		{#each representatives as rep}
			<div class="mb-4 rounded-lg bg-white">
				<!-- Main Row -->
				<div class="grid grid-cols-[80px_1fr_1fr_1fr_1fr_100px] items-center gap-4 p-4">
					<div>
						<div class="flex h-10 w-10 items-center justify-center rounded-full bg-[#E0E8F5]">
							<span class="font-['Poppins'] text-lg text-[#737373]">
								{rep.name[0].toUpperCase()}
							</span>
						</div>
					</div>
					<div class="font-['Poppins'] text-[14px] text-[#737373]">{rep.name}</div>
					<div class="font-['Poppins'] text-[14px] text-[#737373]">{rep.phone}</div>
					<div class="font-['Poppins'] text-[14px] text-[#737373]">{rep.email}</div>
					<div class="font-['Poppins'] text-[14px] text-[#737373]">{rep.location}</div>
					<div class="flex items-center justify-end gap-2">
						<button
							onclick={() => handleEdit(rep.id)}
							class="rounded bg-[#EFEFEF] px-3 py-1 font-['Poppins'] text-sm text-[#726F6F] transition-colors hover:bg-[#E0E0E0]"
						>
							Edit
						</button>
						<button
							onclick={() => handleDelete(rep.id)}
							class="flex items-center gap-1 rounded bg-[#FFEBEE] px-3 py-1 font-['Poppins'] text-sm text-[#D32F2F] transition-colors hover:bg-[#FFCDD2]"
						>
							Delete
						</button>
						<button
							onclick={() => toggleExpand(rep.id)}
							class="flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-gray-100"
						>
							<MoreHorizontal class="h-4 w-4" />
						</button>
					</div>
				</div>

				<!-- Expanded Content -->
				{#if expandedRep === rep.id}
					<div
						class="px-4 pb-4"
						transition:slide={{ delay: 250, duration: 300, easing: quintOut, axis: 'y' }}
					>
						<div class="grid grid-cols-2 gap-6">
							<!-- Schedule -->
							<div class="rounded-lg bg-white p-6">
								<h3 class="mb-4 font-['Poppins'] text-[18px] font-semibold text-[#737373]">
									Schedule
								</h3>
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
											<div>{rep.schedule.monday}</div>
											<div>{rep.schedule.tuesday}</div>
											<div>{rep.schedule.wednesday}</div>
											<div>{rep.schedule.thursday}</div>
											<div>{rep.schedule.friday}</div>
											<div>{rep.schedule.saturday}</div>
											<div>{rep.schedule.sunday}</div>
										</div>
									</div>
								</div>
							</div>

							<!-- Connected Rooms -->
							<div class="rounded-lg bg-white p-6">
								<h3 class="mb-4 font-['Poppins'] text-[18px] font-semibold text-[#737373]">
									Rooms Connected to:
								</h3>
								<div class="rounded-[3px] bg-[#E0E8F5] p-4">
									{#if rep.rooms.length > 0}
										<div class="space-y-[10px]">
											{#each rep.rooms as room}
												<div class="flex items-center justify-between">
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
				{/if}
			</div>
		{/each}
	</div>
</div>
