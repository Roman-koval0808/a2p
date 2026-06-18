<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft } from 'lucide-svelte';
	import AudioUpload from '$lib/components/AudioUpload.svelte';
	import SectionHelp from '$lib/components/SectionHelp.svelte';

	type FlowData = {
		id?: string;
		title?: string;
		greetingAudioUrl?: string | null;
		queueHoldAudioUrl?: string | null;
		allUnavailableAudioUrl?: string | null;
		backupCellAudioUrl?: string | null;
	};
	let { data }: { data: { flow?: FlowData } } = $props();
	const flow = $derived(data?.flow ?? null);
	const flowId = $derived(flow?.id ?? '');

	let callFlowTitle = $state('');
	let greetingFile = $state<File | null>(null);
	let allOnCallFile = $state<File | null>(null);
	let unavailableFile = $state<File | null>(null);
	let backupCellFile = $state<File | null>(null);
	let saving = $state(false);
	let error = $state('');
	let fieldErrors = $state<Record<string, string>>({});

	$effect(() => {
		const f = data?.flow;
		if (f) {
			if (f.title != null) callFlowTitle = f.title;
		}
	});

	async function uploadFile(file: File, type: string): Promise<string | null> {
		const form = new FormData();
		form.set('file', file);
		form.set('type', type);
		const res = await fetch('/api/upload/ivr', { method: 'POST', body: form });
		if (!res.ok) throw new Error('Upload failed');
		const data = await res.json();
		return data.url ?? null;
	}

	function handleBack() {
		goto(`/ivr/${flowId}`);
	}

	async function handleSave() {
		error = '';
		fieldErrors = {};
		if (!callFlowTitle.trim()) {
			fieldErrors = { callFlowTitle: 'Call Flow Title is required' };
			error = fieldErrors.callFlowTitle;
			return;
		}
		saving = true;
		try {
			const body: Record<string, unknown> = { title: callFlowTitle.trim() };
			if (greetingFile) body.greetingAudioUrl = await uploadFile(greetingFile, 'greeting');
			if (allOnCallFile) body.queueHoldAudioUrl = await uploadFile(allOnCallFile, 'queue');
			if (unavailableFile)
				body.allUnavailableAudioUrl = await uploadFile(unavailableFile, 'unavailable');
			if (backupCellFile) body.backupCellAudioUrl = await uploadFile(backupCellFile, 'backup');
			const res = await fetch(`/api/ivr/flows/${flowId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Failed to update');
			goto(`/ivr/${flowId}`, { invalidateAll: true });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save';
		} finally {
			saving = false;
		}
	}
</script>

<div class="min-h-screen bg-[#ECEEF3] p-4">
	<div class="mb-4 rounded-[3px] bg-white px-4 py-3">
		<div class="flex items-center justify-between">
			<h1 class="font-['Poppins'] text-[23px] font-semibold leading-[30px] text-[#747474]">
				Edit Call Flow
			</h1>
			<button
				onclick={handleBack}
				class="flex items-center gap-2 font-['Poppins'] text-base font-medium leading-[19px] text-[#757575] transition-colors hover:text-[#577AB7]"
			>
				<ArrowLeft class="h-4 w-4" />
				Back
			</button>
		</div>
	</div>
	<div class="max-h-[calc(100vh-120px)] overflow-y-auto rounded-lg bg-white p-6">
		<div class="space-y-8">
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<label
						for="edit-flow-title"
						class="block font-['Poppins'] text-lg font-semibold leading-[21px] text-[#808080]"
						>Call Flow Title:</label
					>
					<SectionHelp text="A name for this call flow so you can identify it later." />
				</div>
				<input
					id="edit-flow-title"
					type="text"
					bind:value={callFlowTitle}
					placeholder="Enter your Call Flow Title"
					class="h-[56px] w-full rounded-[2px] border bg-white px-3 font-['Poppins'] text-base font-medium leading-[19px] text-[#808080] outline-none {fieldErrors.callFlowTitle
						? 'border-red-500'
						: 'border-[#969696]'}"
				/>
				{#if fieldErrors.callFlowTitle}
					<p class="font-['Poppins'] text-sm text-red-600">{fieldErrors.callFlowTitle}</p>
				{/if}
			</div>
			<AudioUpload
				label="Greeting:"
				bind:file={greetingFile}
				existingUrl={flow?.greetingAudioUrl ?? null}
			/>
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<p class="font-['Poppins'] text-lg font-semibold text-[#808080]">
						All representatives on call (hold music):
					</p>
					<SectionHelp text="Hold music or message played while the caller waits in the queue." />
				</div>
				<AudioUpload bind:file={allOnCallFile} existingUrl={flow?.queueHoldAudioUrl ?? null} />
			</div>
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<p class="font-['Poppins'] text-lg font-semibold text-[#808080]">All unavailable:</p>
					<SectionHelp text="Message played when no one can take the call." />
				</div>
				<AudioUpload
					bind:file={unavailableFile}
					existingUrl={flow?.allUnavailableAudioUrl ?? null}
				/>
			</div>
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<p class="font-['Poppins'] text-lg font-semibold text-[#808080]">Backup cell audio:</p>
					<SectionHelp text="Audio played when the system is trying to reach your backup number." />
				</div>
				<AudioUpload bind:file={backupCellFile} existingUrl={flow?.backupCellAudioUrl ?? null} />
			</div>
			{#if error}
				<p class="font-['Poppins'] text-base text-red-600">{error}</p>
			{/if}
			<div class="flex justify-end gap-3">
				<button
					onclick={handleBack}
					disabled={saving}
					class="h-[39px] rounded-[3px] border border-black bg-[#ECEFF3] px-4 font-['Poppins'] text-lg text-[#757575] disabled:opacity-50"
				>
					Cancel
				</button>
				<button
					onclick={handleSave}
					disabled={saving}
					class="h-[39px] rounded-[3px] border border-[#577AB7] bg-[#577AB7] px-4 font-['Poppins'] text-lg font-medium text-white disabled:opacity-50"
				>
					{saving ? 'Saving…' : 'Save'}
				</button>
			</div>
		</div>
	</div>
</div>
