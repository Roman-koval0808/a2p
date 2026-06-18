<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Plus } from 'lucide-svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';

	type Location = {
		id?: string;
		name: string;
		address: string;
		city: string;
		phone: string;
		hours: Record<string, string>;
		created?: string;
	};

	let { data } = $props();

	const locations = $derived(data.locations ?? []);

	let currentLocation: Location = $state({
		name: '',
		address: '',
		city: '',
		phone: '',
		hours: {
			Mon: '',
			Tue: '',
			Wed: '',
			Thurs: '',
			Fri: '',
			Sat: '',
			Sun: ''
		}
	});

	let showAddLocationDialog = $state(false);
	let editingLocation: (Location & { id: string }) | null = $state(null);

	const HOURS_DAYS = ['Mon', 'Tue', 'Wed', 'Thurs', 'Fri', 'Sat', 'Sun'] as const;
	const commonHours = [
		{ label: '9-5', value: '9:00 am - 5:00 pm' },
		{ label: '8-4', value: '8:00 am - 4:00 pm' },
		{ label: '10-6', value: '10:00 am - 6:00 pm' },
		{ label: '11-7', value: '11:00 am - 7:00 pm' },
		{ label: '12-8', value: '12:00 pm - 8:00 pm' },
		{ label: 'Closed', value: 'Closed' }
	];

	function setHours(day: string, hours: string) {
		currentLocation.hours[day] = hours;
		currentLocation = { ...currentLocation };
	}

	function resetForm() {
		currentLocation = {
			name: '',
			address: '',
			city: '',
			phone: '',
			hours: {
				Mon: '',
				Tue: '',
				Wed: '',
				Thurs: '',
				Fri: '',
				Sat: '',
				Sun: ''
			}
		};
		editingLocation = null;
	}

	function formatDate(date: string | undefined) {
		if (!date) return '';
		return new Date(date).toLocaleDateString('en-US', {
			month: '2-digit',
			day: '2-digit',
			year: '2-digit'
		});
	}

	function editLocation(location: Location & { id: string }) {
		editingLocation = location;
		currentLocation = {
			name: location.name,
			address: location.address,
			city: location.city,
			phone: location.phone,
			hours: { ...location.hours }
		};
		showAddLocationDialog = true;
	}

	function buildFormData(): FormData {
		const form = new FormData();
		form.set('name', currentLocation.name);
		form.set('address', currentLocation.address);
		form.set('city', currentLocation.city);
		form.set('phone', currentLocation.phone);
		for (const [day, val] of Object.entries(currentLocation.hours)) {
			form.set(`hours_${day}`, val);
		}
		return form;
	}

	async function handleSave() {
		if (editingLocation?.id) {
			const form = buildFormData();
			form.set('locationId', editingLocation.id);
			const res = await fetch('?/updateLocation', { method: 'POST', body: form });
			if (res.ok) {
				toast.success('Location updated');
				resetForm();
				showAddLocationDialog = false;
				await invalidateAll();
			} else {
				toast.error('Failed to update location');
			}
		} else {
			const form = buildFormData();
			const res = await fetch('?/createLocation', { method: 'POST', body: form });
			if (res.ok) {
				toast.success('Location added');
				resetForm();
				showAddLocationDialog = false;
				await invalidateAll();
			} else {
				toast.error('Failed to add location');
			}
		}
	}

	async function handleDelete(loc: { id: string } | number) {
		const id = typeof loc === 'object' ? loc.id : (locations[loc as number] as { id: string })?.id;
		if (!id) return;
		if (!confirm('Delete this location?')) return;
		const form = new FormData();
		form.set('locationId', id);
		const res = await fetch('?/deleteLocation', { method: 'POST', body: form });
		if (res.ok) {
			toast.success('Location deleted');
			if (editingLocation?.id === id) {
				resetForm();
				showAddLocationDialog = false;
			}
			await invalidateAll();
		} else {
			toast.error('Failed to delete location');
		}
	}
</script>

<div class="min-h-screen bg-[#ECEEF3] p-6">
	<div class="mb-6 flex items-center justify-between">
		<h1 class="font-['Poppins'] text-2xl font-bold text-[#737373]">Locations</h1>
		<Button
			variant="default"
			onclick={() => {
				resetForm();
				showAddLocationDialog = true;
			}}
			class="bg-[#4B77BE] font-['Poppins'] text-white hover:bg-[#4B77BE]/90"
		>
			<Plus class="mr-2 h-4 w-4" />
			Add Location
		</Button>
	</div>

	<div class="mb-2 rounded-[8px] bg-[#F0F4FA] px-6 py-4">
		<div class="grid grid-cols-5 gap-4">
			<div class="text-center font-['Poppins'] text-[16px] font-semibold text-[#737373]">
				Date Added
			</div>
			<div class="text-center font-['Poppins'] text-[16px] font-semibold text-[#737373]">
				Location Name
			</div>
			<div class="text-center font-['Poppins'] text-[16px] font-semibold text-[#737373]">
				Address
			</div>
			<div class="text-center font-['Poppins'] text-[16px] font-semibold text-[#737373]">City</div>
			<div class="text-center font-['Poppins'] text-[16px] font-semibold text-[#737373]">
				Delete
			</div>
		</div>
	</div>

	{#if locations.length > 0}
		{#each locations as location, index}
			<div class="mb-2 flex h-[73px] items-center rounded-[8px] bg-white px-6">
				<div class="grid w-full grid-cols-5 gap-4">
					<div class="text-center font-['Poppins'] text-[16px] font-normal text-[#808080]">
						{formatDate(location.created)}
					</div>
					<div class="text-center font-['Poppins'] text-[16px] font-medium text-[#7798D2]">
						<button type="button" class="hover:underline" onclick={() => editLocation(location)}>
							{location.name}
						</button>
					</div>
					<div class="text-center font-['Poppins'] text-[16px] font-normal text-[#808080]">
						{location.address}
					</div>
					<div class="text-center font-['Poppins'] text-[16px] font-normal text-[#808080]">
						{location.city}
					</div>
					<div class="flex items-center justify-center">
						<Button
							variant="ghost"
							size="sm"
							class="text-red-500 hover:text-red-700"
							onclick={() => handleDelete(location)}
						>
							Delete
						</Button>
					</div>
				</div>
			</div>
		{/each}
	{:else}
		<div class="rounded-[8px] bg-white p-8 text-center text-gray-500">
			No locations found. Click "Add Location" to create one.
		</div>
	{/if}
</div>

<Dialog.Root bind:open={showAddLocationDialog}>
	<Dialog.Content class="flex max-h-[80vh] max-w-5xl flex-col overflow-hidden p-0">
		<Dialog.Header class="flex-shrink-0 px-6 pb-4 pt-6">
			<Dialog.Title class="font-['Poppins'] text-2xl font-bold text-[#808080]">
				{editingLocation ? 'Edit Location' : 'Add Location'}
			</Dialog.Title>
		</Dialog.Header>

		<div class="min-h-0 flex-1 overflow-y-auto px-6">
			<div class="space-y-6 pb-4">
				<div class="grid gap-4">
					<div class="flex items-center justify-between gap-8">
						<div class="grid w-full gap-2">
							<Label for="locationName" class="font-['Poppins'] text-lg font-medium text-[#808080]">
								Name of Location
							</Label>
							<Input
								id="locationName"
								bind:value={currentLocation.name}
								placeholder="e.g. Timmins Branch"
								required
								class="h-10 rounded-lg bg-[#ECEFF3]"
							/>
						</div>
						<div class="grid w-full gap-2">
							<Label for="address" class="font-['Poppins'] text-lg font-medium text-[#808080]">
								Address
							</Label>
							<Input
								id="address"
								bind:value={currentLocation.address}
								placeholder="123 Street Name"
								class="h-10 rounded-lg bg-[#ECEFF3]"
							/>
						</div>
					</div>

					<div class="flex items-center justify-between gap-8">
						<div class="grid w-full gap-2">
							<Label for="city" class="font-['Poppins'] text-lg font-medium text-[#808080]"
								>City</Label
							>
							<Input
								id="city"
								bind:value={currentLocation.city}
								placeholder="Timmins"
								class="h-10 rounded-lg bg-[#ECEFF3]"
							/>
						</div>
						<div class="grid w-full gap-2">
							<Label for="phone" class="font-['Poppins'] text-lg font-medium text-[#808080]">
								Phone Number
							</Label>
							<Input
								id="phone"
								bind:value={currentLocation.phone}
								placeholder="705-123-1234"
								type="tel"
								class="h-10 rounded-lg bg-[#ECEFF3]"
							/>
						</div>
					</div>

					<div class="grid gap-4">
						<Label class="font-['Poppins'] text-lg font-medium text-[#808080]"
							>Hours of Operation</Label
						>
						<div class="flex gap-6">
							<div class="flex w-1/2 flex-col gap-2 space-y-4 pt-1">
								{#each HOURS_DAYS as day}
									<div class="flex items-start justify-between">
										<span class="font-['Poppins'] text-sm">{day}</span>
										<div class="flex flex-col gap-2">
											<Input
												id={day}
												bind:value={currentLocation.hours[day]}
												placeholder="9:00 am - 5:00 pm"
												class="h-6 rounded bg-[#E0E8F5] py-1 font-['Poppins'] text-sm text-[#777574]"
											/>
											<div class="flex flex-wrap gap-1">
												{#each commonHours as timeOption}
													<button
														type="button"
														onclick={() => setHours(day, timeOption.value)}
														class="rounded border border-gray-200 bg-white px-1 py-0.5 text-[10px] hover:bg-gray-50"
													>
														{timeOption.label}
													</button>
												{/each}
											</div>
										</div>
									</div>
								{/each}
							</div>
							<div class="flex w-1/2 items-center justify-center rounded p-4 text-xl"></div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<Dialog.Footer
			class="flex flex-shrink-0 justify-between gap-4 border-t border-gray-200 px-6 pb-6 pt-4"
		>
			<div>
				<Button
					variant="outline"
					class="border-gray-300 text-gray-500"
					onclick={() => {
						resetForm();
						showAddLocationDialog = false;
					}}
				>
					Cancel
				</Button>
			</div>
			<div class="flex gap-2">
				{#if editingLocation}
					<Button
						class="bg-red-500 font-medium text-white hover:bg-red-600"
						onclick={() => handleDelete(editingLocation)}
					>
						Delete
					</Button>
				{/if}
				<Button
					class="bg-[#4B77BE] font-medium text-white hover:bg-[#4B77BE]/80"
					onclick={handleSave}
				>
					{editingLocation ? 'Update' : 'Save'}
				</Button>
				{#if !editingLocation}
					<Button
						class="bg-[#4B77BE] font-medium text-white hover:bg-[#4B77BE]/80"
						onclick={async () => {
							await handleSave();
							if (showAddLocationDialog === false) {
								setTimeout(() => {
									resetForm();
									showAddLocationDialog = true;
								}, 100);
							}
						}}
					>
						Add Another Location
					</Button>
				{/if}
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
