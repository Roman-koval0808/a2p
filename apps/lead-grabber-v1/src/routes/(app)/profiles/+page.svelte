<script lang="ts">
	import { Search, Mic, MoreVertical, Pencil, Trash2 } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { invalidateAll } from '$app/navigation';
	import { filterContacts } from '$lib/utils/contacts-filter';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { toast } from 'svelte-sonner';

	let { data } = $props();
	let searchQuery = $state('');
	let selectedBucket = $state('');

	const profiles = $derived(data.profiles || []);
	const filteredProfiles = $derived(
		profiles.filter((p: any) => {
			if (selectedBucket && p.intentBucket !== selectedBucket) return false;
			if (searchQuery) {
				const query = searchQuery.toLowerCase();
				const name = (p.name || '').toLowerCase();
				const phone = (p.phone || p.clearPhone || '').toLowerCase();
				const email = (p.email || p.clearEmail || '').toLowerCase();
				const id = (p.id || '').toLowerCase();
				return name.includes(query) || phone.includes(query) || email.includes(query) || id.includes(query);
			}
			return true;
		})
	);

	let showEditDialog = $state(false);
	let editingProfile = $state({ id: '', name: '', email: '', phone: '', avatarUrl: '' });
	let selectedAvatarFile = $state<File | null>(null);

	function handleProfileClick(profile: { id: string }) {
		goto(`/profiles/${profile.id}`);
	}

	function handleEditProfile(
		profile: {
			id: string;
			name?: string | null;
			email?: string | null;
			phone?: string | null;
			avatarUrl?: string | null;
		},
		e: Event
	) {
		e.stopPropagation();
		editingProfile = {
			id: profile.id,
			name: profile.name ?? '',
			email: profile.email ?? '',
			phone: profile.phone ?? ''
		};
		showEditDialog = true;
	}

	async function handleUpdateProfile() {
		const form = new FormData();
		form.set('profileId', editingProfile.id);
		form.set('name', editingProfile.name);
		form.set('email', editingProfile.email);
		form.set('phone', editingProfile.phone);

		if (selectedAvatarFile) {
			const uploadForm = new FormData();
			uploadForm.append('avatar', selectedAvatarFile);
			const uploadRes = await fetch('/api/upload/avatar', { method: 'POST', body: uploadForm });
			if (uploadRes.ok) {
				const uploadData = await uploadRes.json();
				if (uploadData.success && uploadData.data?.url) {
					form.set('avatarUrl', uploadData.data.url);
				}
			}
		} else {
			form.set('avatarUrl', editingProfile.avatarUrl);
		}

		const res = await fetch('?/updateProfile', { method: 'POST', body: form });
		if (res.ok) {
			showEditDialog = false;
			toast.success('Profile updated');
			await invalidateAll();
		} else {
			toast.error('Failed to update profile');
		}
	}

	async function handleDelete(profileId: string, e: Event) {
		e.stopPropagation();
		if (!confirm('Are you sure you want to delete this profile?')) return;
		const form = new FormData();
		form.set('profileId', profileId);
		const res = await fetch('?/deleteProfile', { method: 'POST', body: form });
		if (res.ok) {
			toast.success('Profile deleted');
			await invalidateAll();
		} else {
			toast.error('Failed to delete profile');
		}
	}
</script>

<div class="w-full min-w-0 p-4">
	<h1 class="mb-5 font-sans text-xl font-semibold leading-[1.29] text-[#747474]">Profiles</h1>

	<div class="mb-5 flex flex-wrap items-center gap-4">
		<!-- Search -->
		<div class="flex h-10 w-80 items-center gap-3 rounded bg-white px-4 border border-gray-200 shadow-sm">
			<Search class="h-4 w-4 text-[#577AB7]" />
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search name, phone, email..."
				class="flex-1 font-sans text-sm font-normal text-gray-700 outline-none placeholder:text-gray-400 bg-transparent"
			/>
		</div>

		<!-- Bucket filter dropdown -->
		<div class="flex h-10 items-center gap-2 rounded bg-white px-3 border border-gray-200 shadow-sm">
			<span class="text-xs text-gray-500 font-medium">Filter Bucket:</span>
			<select bind:value={selectedBucket} class="font-sans text-sm text-gray-700 outline-none bg-transparent cursor-pointer border-0 p-0 pr-6">
				<option value="">All Buckets</option>
				<option value="emergency">Emergency</option>
				<option value="active">Active Project</option>
				<option value="comparison">Comparison</option>
				<option value="research">Research</option>
				<option value="unclassified">Unclassified</option>
			</select>
		</div>
	</div>

	<div class="overflow-hidden rounded-lg bg-white border border-gray-200 shadow-sm">
		<div class="flex h-12 items-center rounded-t-lg border-b border-gray-200 bg-gray-50 px-4">
			<div class="w-[200px] font-sans text-sm font-semibold text-gray-600">Name / ID</div>
			<div class="w-[250px] font-sans text-sm font-semibold text-gray-600">Contact Info</div>
			<div class="w-[120px] font-sans text-sm font-semibold text-gray-600">Identity Tier</div>
			<div class="w-[120px] font-sans text-sm font-semibold text-gray-600">Live Score</div>
			<div class="w-[160px] font-sans text-sm font-semibold text-gray-600">Intent Bucket</div>
			<div class="flex-1 font-sans text-sm font-semibold text-gray-600">Last Active</div>
		</div>

		<div class="overflow-y-auto">
			{#each filteredProfiles as profile, index}
				{@const displayName = profile.isAnonymous ? (profile.clearPhone !== '—' ? 'Caller (' + profile.clearPhone + ')' : 'Anonymous Lead') : profile.name}
				{@const clearPhone = profile.clearPhone || '—'}
				{@const clearEmail = profile.clearEmail || '—'}
				<div
					role="button"
					tabindex="0"
					class="flex h-16 cursor-pointer items-center border-b border-gray-100 bg-[#FFFEFE] px-4 transition-colors hover:bg-gray-50 {index === filteredProfiles.length - 1 ? 'rounded-b-lg border-b-0' : ''}"
					onclick={() => handleProfileClick(profile)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							handleProfileClick(profile);
						}
					}}
				>
					<!-- Name / ID -->
					<div class="w-[200px] pr-2">
						<div class="font-sans text-sm font-bold text-gray-800 truncate">{displayName}</div>
						<div class="font-mono text-[10px] text-gray-400 truncate">{profile.id}</div>
					</div>

					<!-- Contact Info -->
					<div class="w-[250px] pr-2 font-mono text-xs">
						<div class="text-indigo-600 truncate">{clearEmail}</div>
						<div class="text-teal-600 font-semibold mt-0.5">{clearPhone}</div>
					</div>

					<!-- Identity Tier -->
					<div class="w-[120px]">
						{#if profile.tier === 'T1' || profile.tier === 'Tier 1'}
							<span class="inline-flex items-center font-mono text-[9px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Tier 1</span>
						{:else if profile.tier === 'T2' || profile.tier === 'Tier 2'}
							<span class="inline-flex items-center font-mono text-[9px] font-bold px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">Tier 2</span>
						{:else if profile.tier === 'T2B' || profile.tier === 'Tier 2B'}
							<span class="inline-flex items-center font-mono text-[9px] font-bold px-2 py-0.5 rounded bg-pink-50 text-pink-700 border border-pink-200">Tier 2B</span>
						{:else}
							<span class="inline-flex items-center font-mono text-[9px] font-bold px-2 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-200">Tier 3</span>
						{/if}
					</div>

					<!-- Live Score -->
					<div class="w-[120px] font-mono text-sm">
						<strong class="text-indigo-600 text-base font-bold">{profile.scoreLive}</strong>
						<span class="text-[10px] text-gray-400">/100</span>
					</div>

					<!-- Intent Bucket -->
					<div class="w-[160px]">
						{#if profile.intentBucket === 'emergency'}
							<span class="inline-flex items-center font-mono text-[9px] font-bold px-2 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">EMERGENCY</span>
						{:else if profile.intentBucket === 'active'}
							<span class="inline-flex items-center font-mono text-[9px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">ACTIVE PROJ</span>
						{:else if profile.intentBucket === 'comparison'}
							<span class="inline-flex items-center font-mono text-[9px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">COMPARISON</span>
						{:else if profile.intentBucket === 'research'}
							<span class="inline-flex items-center font-mono text-[9px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">RESEARCH</span>
						{:else}
							<span class="inline-flex items-center font-mono text-[9px] font-bold px-2 py-0.5 rounded bg-gray-50 text-gray-400 border border-gray-200">UNCLASSIFIED</span>
						{/if}
					</div>

					<!-- Last Active -->
					<div class="flex-1 font-mono text-xs text-gray-500">
						{new Date(profile.lastSeen).toLocaleString()}
					</div>
				</div>
			{/each}
			{#if filteredProfiles.length === 0}
				<div class="text-center py-12 text-gray-400 text-sm font-sans">
					No profiles match the filter criteria.
				</div>
			{/if}
		</div>
	</div>
</div>

<Dialog.Root bind:open={showEditDialog}>
	<Dialog.Content class="sm:max-w-[425px]">
		<Dialog.Header>
			<Dialog.Title>Edit Profile</Dialog.Title>
		</Dialog.Header>
		<div class="grid gap-4 py-4">
			<div class="grid gap-2">
				<Label for="edit-name">Name</Label>
				<Input id="edit-name" bind:value={editingProfile.name} />
			</div>
			<div class="grid gap-2">
				<Label for="edit-email">Email</Label>
				<Input id="edit-email" type="email" bind:value={editingProfile.email} />
			</div>
			<div class="grid gap-2">
				<Label for="edit-phone">Phone</Label>
				<Input id="edit-phone" type="tel" bind:value={editingProfile.phone} />
			</div>
			<div class="grid gap-2">
				<Label for="edit-avatar">Avatar</Label>
				{#if editingProfile.avatarUrl && !selectedAvatarFile}
					<div class="mb-2">
						<img
							src={editingProfile.avatarUrl}
							alt="Avatar"
							class="h-16 w-16 rounded-full object-cover"
						/>
					</div>
				{/if}
				<Input
					id="edit-avatar"
					type="file"
					accept="image/*"
					onchange={(e) => {
						const target = e.target as HTMLInputElement;
						if (target.files && target.files.length > 0) {
							selectedAvatarFile = target.files[0];
						}
					}}
				/>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (showEditDialog = false)}>Cancel</Button>
			<Button onclick={handleUpdateProfile}>Save changes</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
