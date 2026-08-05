<script lang="ts">
	import { goto } from '$app/navigation';
	import { invalidateAll } from '$app/navigation';
	import {
		ArrowLeft,
		Calendar,
		Save,
		X,
		Pencil,
		Trash2
	} from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { toast } from 'svelte-sonner';

	let { data } = $props();
	let editingId = $state<string | null>(null);
	let editDraft = $state<{
		status?: ScheduledIntent['status'];
		dueAt?: string;
		expiresAt?: string | null;
		payload?: Record<string, any>;
	}>({});

	interface ScheduledIntent {
		id: string;
		intentType: string;
		status: 'PENDING' | 'DONE' | 'SKIPPED' | 'CANCELLED' | 'EXPIRED';
		actor: 'CUSTOMER' | 'BUSINESS';
		dueAt: Date;
		expiresAt: Date | null;
		payload: Record<string, any>;
		createdAt: Date;
		updatedAt: Date;
	}

	let scheduledIntents = $derived(
		(data.scheduledIntents as any[]).map((si) => ({
			...si,
			payload: (si.payload as Record<string, any>) || {}
		})) as ScheduledIntent[]
	);

	const STATUS_OPTIONS: { value: ScheduledIntent['status']; label: string }[] = [
		{ value: 'PENDING', label: 'Pending' },
		{ value: 'DONE', label: 'Done' },
		{ value: 'SKIPPED', label: 'Skipped' },
		{ value: 'CANCELLED', label: 'Cancelled' },
		{ value: 'EXPIRED', label: 'Expired' }
	];

	const ACTOR_LABELS = {
		CUSTOMER: 'They act',
		BUSINESS: 'We act'
	};

	function formatDate(d: string | Date | null): string {
		if (!d) return '—';
		const date = new Date(d);
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatDateInput(d: string | Date | null): string {
		if (!d) return '';
		const date = new Date(d);
		date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
		return date.toISOString().slice(0, 16);
	}

	function summaryText(si: ScheduledIntent): string {
		const p = si.payload || {};
		const parts = [p.whatHeWants || '—'].filter(Boolean);
		if (p.rawTimeframe) parts.push(`(said: "${p.rawTimeframe}")`);
		return parts.join(' ');
	}

	function startEdit(si: ScheduledIntent) {
		editingId = si.id;
		editDraft = {
			status: si.status,
			dueAt: formatDateInput(si.dueAt),
			expiresAt: formatDateInput(si.expiresAt),
			payload: { ...si.payload }
		};
	}

	function cancelEdit() {
		editingId = null;
		editDraft = {};
	}

	async function saveEdit(id: string) {
		const loadingId = toast.loading('Saving commitment...');
		try {
			const res = await fetch(`/api/a2p/schedule/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					status: editDraft.status,
					dueAt: editDraft.dueAt,
					expiresAt: editDraft.expiresAt
				})
			});
			const result = await res.json();
			if (result.ok) {
				toast.success('Commitment updated', { id: loadingId });
				editingId = null;
				await invalidateAll();
			} else {
				toast.error(result.error || 'Failed to update', { id: loadingId });
			}
		} catch (e) {
			console.error(e);
			toast.error('Failed to update commitment', { id: loadingId });
		}
	}

	async function quickStatus(id: string, status: ScheduledIntent['status']) {
		const loadingId = toast.loading('Updating status...');
		try {
			const res = await fetch(`/api/a2p/schedule/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status })
			});
			const result = await res.json();
			if (result.ok) {
				toast.success(`Marked ${status.toLowerCase()}`, { id: loadingId });
				await invalidateAll();
			} else {
				toast.error(result.error || 'Failed to update', { id: loadingId });
			}
		} catch (e) {
			console.error(e);
			toast.error('Failed to update commitment', { id: loadingId });
		}
	}
</script>

<div class="min-h-screen bg-[#f4f6f9]">
	<div class="mx-auto max-w-7xl p-6">
		<!-- Header -->
		<div class="mb-6 flex items-center justify-between">
			<div class="flex items-center gap-4">
				<Button variant="outline" size="sm" onclick={() => goto(`/profiles/${data.profile.id}`)}>
					<ArrowLeft class="mr-2 h-4 w-4" />
					Back to Profile
				</Button>
				<div>
					<h1 class="font-sans text-2xl font-semibold text-[#555555]">Scheduled Commitments</h1>
					<p class="font-sans text-sm text-gray-500">
						{data.profile.name} — plans that can be moved or cancelled. The customer's words stay on the profile.
					</p>
				</div>
			</div>
		</div>

		<!-- Cards -->
		{#if scheduledIntents.length === 0}
			<div class="rounded-lg bg-white p-12 text-center shadow-[0px_0px_4px_rgba(0,0,0,0.41)]">
				<Calendar class="mx-auto mb-4 h-12 w-12 text-gray-300" />
				<h3 class="mb-2 font-sans text-lg font-semibold text-[#555555]">No scheduled commitments</h3>
				<p class="font-sans text-sm text-gray-400">
					Nothing planned for this customer yet. When they say "I'll call in a couple of weeks", it will appear here.
				</p>
			</div>
		{:else}
			<div class="space-y-4">
				{#each scheduledIntents as si (si.id)}
					<div class="rounded-lg bg-white p-5 shadow-[0px_0px_4px_rgba(0,0,0,0.41)]">
						{#if editingId === si.id}
							<!-- Edit mode -->
							<div class="grid grid-cols-1 gap-5 md:grid-cols-3">
								<div>
									<Label for="due-{si.id}">Due</Label>
										<Input
											id="due-{si.id}"
											type="datetime-local"
											bind:value={editDraft.dueAt}
										/>
									</div>
									<div>
										<Label for="exp-{si.id}">Expires</Label>
										<Input
											id="exp-{si.id}"
											type="datetime-local"
											bind:value={editDraft.expiresAt}
										/>
								</div>
								<div>
									<Label for="status-{si.id}">Status</Label>
									<select
										id="status-{si.id}"
										bind:value={editDraft.status}
										class="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
									>
										{#each STATUS_OPTIONS as opt}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								</div>
							</div>
							<div class="mt-4 flex items-center justify-end gap-2">
								<Button variant="ghost" size="sm" onclick={cancelEdit}>
									<X class="mr-2 h-4 w-4" />
									Cancel
								</Button>
								<Button size="sm" onclick={() => saveEdit(si.id)}>
									<Save class="mr-2 h-4 w-4" />
									Save
								</Button>
							</div>
							{:else}
								<!-- View mode -->
								<div class="flex items-start justify-between gap-4">
									<div class="flex items-start gap-4">
										<div class="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-[#f0f4fb]">
											<Calendar class="h-5 w-5 text-[#577AB7]" />
										</div>
									<div>
										<div class="mb-1 flex items-center gap-3">
											<span
												class="font-sans text-base font-semibold {new Date(si.dueAt) < new Date() && si.status === 'PENDING'
													? 'text-red-600'
													: 'text-[#555555]'}"
											>
												{formatDate(si.dueAt)}
											</span>
											<span
												class="rounded px-2 py-0.5 text-xs font-semibold {si.status === 'PENDING'
													? 'bg-blue-100 text-blue-800'
													: si.status === 'DONE'
														? 'bg-emerald-100 text-emerald-800'
														: 'bg-gray-200 text-gray-600'}"
											>
												{si.status}
											</span>
											<span class="font-sans text-xs text-gray-400">{si.intentType}</span>
											<span class="font-sans text-xs text-gray-500">{ACTOR_LABELS[si.actor]}</span>
										</div>
										<p class="max-w-2xl font-sans text-sm text-[#555555]">
											{summaryText(si)}
										</p>
										<p class="mt-1 font-sans text-xs text-gray-400">
											ID {si.id.slice(0, 8)}… · Created {formatDate(si.createdAt)}
											{#if si.expiresAt}
												· Expires {formatDate(si.expiresAt)}
											{/if}
										</p>
									</div>
								</div>
								<div class="flex items-center gap-2">
									{#if si.status === 'PENDING'}
										<Button variant="ghost" size="sm" onclick={() => quickStatus(si.id, 'CANCELLED')}>
											<Trash2 class="mr-2 h-4 w-4" />
											Cancel
										</Button>
									{/if}
									<Button variant="outline" size="sm" onclick={() => startEdit(si)}>
										<Pencil class="mr-2 h-4 w-4" />
										Edit
									</Button>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
