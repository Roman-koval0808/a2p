<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index';

	type VoiceLog = {
		id: string;
		direction: string;
		source: string | null;
		destination: string | null;
		created: Date;
		summary: string | null;
		content: string | null;
		duration: number | null;
		metadata: Record<string, unknown> | null;
		callTrackingCategory: { id: string; name: string } | null;
		customer: { id: string; name: string | null; phone: string | null } | null;
	};

	let { open = $bindable(false), call = null as VoiceLog | null } = $props();

	function formatDate(d: Date) {
		return new Date(d).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatDuration(seconds: number) {
		if (seconds < 60) return `${Math.round(seconds)}s`;
		const m = Math.floor(seconds / 60);
		const s = Math.round(seconds % 60);
		return s > 0 ? `${m}m ${s}s` : `${m}m`;
	}

	function getRecordingUrl(c: VoiceLog | null): string | null {
		if (!c?.id) return null;
		const meta = c.metadata ?? {};
		if (meta.recording_id) return `/api/recording/${c.id}`;
		const urls = meta.recording_urls as Record<string, string> | undefined;
		if (urls && typeof urls === 'object') {
			const u =
				urls.mp3 ??
				urls.m4a ??
				Object.values(urls).find((v) => typeof v === 'string' && v.startsWith('http'));
			return (u as string) ?? null;
		}
		return null;
	}

	const recUrl = $derived(call ? getRecordingUrl(call) : null);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[90vh] max-w-lg flex-col overflow-hidden">
		<Dialog.Header>
			<Dialog.Title>Call details</Dialog.Title>
			<Dialog.Description>View call information and recording</Dialog.Description>
		</Dialog.Header>
		{#if call}
			<div class="flex-1 space-y-4 overflow-y-auto pr-2">
				<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
					<dt class="text-gray-500">Date & time</dt>
					<dd class="text-gray-900">{formatDate(call.created)}</dd>

					<dt class="text-gray-500">Direction</dt>
					<dd>
						<span
							class="rounded px-1.5 py-0.5 text-xs font-medium {call.direction === 'inbound'
								? 'bg-green-100 text-green-800'
								: 'bg-blue-100 text-blue-800'}"
						>
							{call.direction === 'inbound' ? 'Inbound' : 'Outbound'}
						</span>
					</dd>

					<dt class="text-gray-500">Category</dt>
					<dd class="text-gray-900">{call.callTrackingCategory?.name ?? '—'}</dd>

					<dt class="text-gray-500">From</dt>
					<dd class="text-gray-900">
						{call.direction === 'inbound' ? call.source : call.destination}
					</dd>

					<dt class="text-gray-500">To</dt>
					<dd class="text-gray-900">
						{call.direction === 'inbound' ? call.destination : call.source}
					</dd>

					<dt class="text-gray-500">Contact</dt>
					<dd class="text-gray-900">{call.customer?.name || call.customer?.phone || '—'}</dd>

					{#if call.duration != null}
						<dt class="text-gray-500">Duration</dt>
						<dd class="text-gray-900">{formatDuration(call.duration)}</dd>
					{/if}
				</dl>

				{#if call.summary}
					<div>
						<h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
							Summary
						</h4>
						<p class="whitespace-pre-wrap text-sm text-gray-700">{call.summary}</p>
					</div>
				{/if}

				{#if call.content}
					<div>
						<h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
							Transcript
						</h4>
						<p class="whitespace-pre-wrap text-sm text-gray-700">{call.content}</p>
					</div>
				{/if}

				{#if recUrl}
					<div>
						<h4 class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
							Recording
						</h4>
						<audio controls class="h-9 w-full" src={recUrl} preload="metadata">
							Your browser does not support the audio element.
						</audio>
					</div>
				{:else}
					<p class="text-xs text-gray-400">No recording available for this call.</p>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
