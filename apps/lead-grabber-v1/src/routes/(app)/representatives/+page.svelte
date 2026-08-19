<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { MoreHorizontal } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { Button } from '$lib/components/ui/button/index.js';

	let { data } = $props<{
		data: {
			representatives: Array<{
				id: string;
				name: string;
				email: string;
				phone: string;
				location: string;
				avatar?: string;
				schedule: Record<string, { start: string; end: string }>;
				rooms: Array<{ id: string; title: string; created: Date }>;
				isPending?: boolean;
			}>;
			pendingInvites: Array<{
				id: string;
				name: string;
				email: string;
				phone: string;
				location: string;
				avatar?: string;
				schedule: Record<string, { start: string; end: string }>;
				rooms: Array<{ id: string; title: string; created: Date }>;
				isPending?: boolean;
			}>;
		};
	}>();

	const representatives = $derived([...data.pendingInvites, ...data.representatives]);

	let expandedRep: string | null = $state(null);

	function handleAdd() {
		goto('/representatives/add');
	}

	function handleEdit(id: string) {
		goto(`/representatives/${id}/edit`);
	}

	let deletingId: string | null = $state(null);

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
					<div class="flex items-center gap-2 font-['Poppins'] text-[14px] text-[#737373]">
						{rep.name}
						{#if rep.isPending}
							<span class="rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">Pending</span>
						{/if}
					</div>
					<div class="font-['Poppins'] text-[14px] text-[#737373]">{rep.phone}</div>
					<div class="font-['Poppins'] text-[14px] text-[#737373]">{rep.email}</div>
					<div class="font-['Poppins'] text-[14px] text-[#737373]">{rep.location}</div>
					<div class="flex items-center justify-end gap-2">
						<button
							onclick={() => handleEdit(rep.id)}
							disabled={rep.isPending}
							title={rep.isPending
								? 'This is a legacy unaccepted invite — remove it and add the representative again'
								: undefined}
							class="rounded bg-[#EFEFEF] px-3 py-1 font-['Poppins'] text-sm text-[#726F6F] transition-colors hover:bg-[#E0E0E0] disabled:cursor-not-allowed disabled:opacity-50"
						>
							Edit
						</button>
						<form
							method="POST"
							action="?/deleteRepresentative"
							use:enhance={({ cancel }) => {
								if (!confirm(`Remove ${rep.name}? They will stop receiving callbacks.`)) {
									cancel();
									return;
								}
								deletingId = rep.id;
								return async ({ result }) => {
									deletingId = null;
									if (result.type === 'failure') {
										toast.error((result.data as any)?.error ?? 'Could not remove representative');
										return;
									}
									toast.success(`${rep.name} removed`);
									await invalidateAll();
								};
							}}
						>
							<input type="hidden" name="id" value={rep.id} />
							<input type="hidden" name="isPending" value={rep.isPending ? 'true' : 'false'} />
							<button
								type="submit"
								disabled={deletingId === rep.id}
								class="flex items-center gap-1 rounded bg-[#FFEBEE] px-3 py-1 font-['Poppins'] text-sm text-[#D32F2F] transition-colors hover:bg-[#FFCDD2] disabled:opacity-50"
							>
								{deletingId === rep.id ? 'Removing…' : 'Delete'}
							</button>
						</form>
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
											<div>{rep.schedule?.Monday?.start ? `${rep.schedule.Monday.start} - ${rep.schedule.Monday.end}` : 'Closed'}</div>
											<div>{rep.schedule?.Tuesday?.start ? `${rep.schedule.Tuesday.start} - ${rep.schedule.Tuesday.end}` : 'Closed'}</div>
											<div>{rep.schedule?.Wednesday?.start ? `${rep.schedule.Wednesday.start} - ${rep.schedule.Wednesday.end}` : 'Closed'}</div>
											<div>{rep.schedule?.Thursday?.start ? `${rep.schedule.Thursday.start} - ${rep.schedule.Thursday.end}` : 'Closed'}</div>
											<div>{rep.schedule?.Friday?.start ? `${rep.schedule.Friday.start} - ${rep.schedule.Friday.end}` : 'Closed'}</div>
											<div>{rep.schedule?.Saturday?.start ? `${rep.schedule.Saturday.start} - ${rep.schedule.Saturday.end}` : 'Closed'}</div>
											<div>{rep.schedule?.Sunday?.start ? `${rep.schedule.Sunday.start} - ${rep.schedule.Sunday.end}` : 'Closed'}</div>
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
													<div class="flex flex-col">
														<span class="font-['Poppins'] text-[14px] font-medium text-[#808080]">
															{room.title || `ViewRoom ${room.id.substring(0, 6)}`}
														</span>
														<span class="text-[12px] text-[#A0A0A0]">
															Created: {new Date(room.created).toLocaleDateString()}
														</span>
													</div>
													<Button
														variant="ghost"
														size="sm"
														onclick={() => goto(`/room/${room.id}/info`)}
													>
														View
													</Button>
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
