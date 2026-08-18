<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';

	let { data } = $props();

	// Which side the reviewer chose to keep, per candidate. Defaults to the primary.
	let survivorChoice = $state<Record<string, string>>({});
	let busyId = $state<string | null>(null);

	function survivorFor(c: any): string {
		return survivorChoice[c.id] || c.primaryProfileId;
	}

	function label(p: any): string {
		return p?.displayName || [p?.firstName, p?.lastName].filter(Boolean).join(' ') || p?.email || p?.phoneNumber || 'Unnamed profile';
	}

	function attrCount(p: any): number {
		return p?.attributes && typeof p.attributes === 'object' ? Object.keys(p.attributes).length : 0;
	}

	async function resolve(candidate: any, action: 'merge' | 'dismiss') {
		busyId = candidate.id;
		try {
			const res = await fetch(`/api/profiles/merge-candidates/${candidate.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, survivorId: survivorFor(candidate) })
			});
			const body = await res.json();
			if (!res.ok || !body.success) {
				toast.error(body.error || 'Action failed');
				return;
			}
			toast.success(action === 'merge' ? 'Profiles merged' : 'Candidate dismissed');
			await invalidateAll();
		} catch (err) {
			toast.error('Request failed');
		} finally {
			busyId = null;
		}
	}
</script>

<div class="mx-auto max-w-5xl px-4 py-8">
	<header class="mb-6">
		<h1 class="text-2xl font-semibold text-gray-900">Duplicate profiles</h1>
		<p class="mt-1 text-sm text-gray-600">
			Raised automatically when the same phone number or email turns up on two profiles. Nothing is
			merged until you say so — pick which record to keep.
		</p>
	</header>

	{#if data.candidates.length === 0}
		<div class="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
			No duplicate profiles to review.
		</div>
	{:else}
		<div class="space-y-4">
			{#each data.candidates as c (c.id)}
				{@const chosen = survivorFor(c)}
				<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
					<div class="mb-3 flex items-center justify-between">
						<span class="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
							{c.reason}
						</span>
						<span class="text-xs text-gray-500">
							detected {new Date(c.createdAt).toLocaleString()}
						</span>
					</div>

					<div class="grid gap-3 sm:grid-cols-2">
						{#each [c.primary, c.duplicate] as p (p.id)}
							<button
								type="button"
								class="rounded-lg border-2 p-3 text-left transition {chosen === p.id
									? 'border-green-500 bg-green-50'
									: 'border-gray-200 hover:border-gray-300'}"
								onclick={() => (survivorChoice = { ...survivorChoice, [c.id]: p.id })}
							>
								<div class="flex items-center justify-between">
									<span class="font-semibold text-gray-900">{label(p)}</span>
									{#if chosen === p.id}
										<span class="text-[10px] font-bold uppercase text-green-700">Keep</span>
									{/if}
								</div>
								<dl class="mt-2 space-y-0.5 text-xs text-gray-600">
									<div>Email: {p.email || '—'}</div>
									<div>Phone: {p.phoneNumber || '—'}</div>
									<div>Status: {p.status || 'unknown'}</div>
									<div>
										{p._count.commContainers} conversations · {p._count.events} events · {attrCount(p)} fields
									</div>
									<div>Created {new Date(p.createdAt).toLocaleDateString()}</div>
								</dl>
							</button>
						{/each}
					</div>

					<p class="mt-3 text-xs text-gray-500">
						The other profile's conversations, events and identifiers move onto the one you keep. It
						is kept as a tombstone, not deleted.
					</p>

					<div class="mt-3 flex justify-end gap-2">
						<button
							type="button"
							class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
							disabled={busyId === c.id}
							onclick={() => resolve(c, 'dismiss')}
						>
							Not a duplicate
						</button>
						<button
							type="button"
							class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
							disabled={busyId === c.id}
							onclick={() => resolve(c, 'merge')}
						>
							{busyId === c.id ? 'Merging…' : 'Merge'}
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if data.recentlyMerged.length > 0}
		<h2 class="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">
			Recently merged
		</h2>
		<ul class="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white text-sm">
			{#each data.recentlyMerged as m (m.id)}
				<li class="flex items-center justify-between px-4 py-2">
					<span class="text-gray-700">{label(m.duplicate)} → {label(m.primary)}</span>
					<span class="text-xs text-gray-500">
						{m.resolvedAt ? new Date(m.resolvedAt).toLocaleString() : ''}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
