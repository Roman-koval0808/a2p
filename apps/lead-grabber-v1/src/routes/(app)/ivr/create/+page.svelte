<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft, ChevronDown } from 'lucide-svelte';
	import DialerDialog from '$lib/components/DialerDialog.svelte';
	import AudioUpload from '$lib/components/AudioUpload.svelte';
	import SectionHelp from '$lib/components/SectionHelp.svelte';

	let callFlowTitle = $state('');
	let greetingFile = $state<File | null>(null);
	let scheduleRule = $state('noRules');
	let addFailover = $state(false);
	let failoverKey = $state('');
	let failoverDialerOpen = $state(false);
	let failoverName = $state('');
	let failoverDuration = $state('');
	let failoverFile = $state<File | null>(null);
	let saving = $state(false);
	let error = $state('');
	let fieldErrors = $state<Record<string, string>>({});

	let allOnCallFile = $state<File | null>(null);
	let unavailableFile = $state<File | null>(null);
	let backupCellFile = $state<File | null>(null);

	async function uploadFile(file: File, type: string): Promise<string | null> {
		const form = new FormData();
		form.set('file', file);
		form.set('type', type);
		const res = await fetch('/api/upload/ivr', { method: 'POST', body: form });
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			throw new Error(data.error || 'Upload failed');
		}
		const data = await res.json();
		return data.url ?? null;
	}

	function handleScheduleRuleChange(event: Event) {
		const target = event.target as HTMLSelectElement;
		if (target.value === 'createNew') {
			// After saving, user will be redirected to rule builder; keep selection for UX
			scheduleRule = 'createNew';
		}
	}

	function handleBack() {
		goto('/ivr');
	}

	async function handleSave() {
		error = '';
		fieldErrors = {};
		const err: Record<string, string> = {};
		if (!callFlowTitle.trim()) err.callFlowTitle = 'Call Flow Title is required';
		if (addFailover && !failoverFile)
			err.failover = 'Please upload failover audio when Add Failover is enabled.';
		if (Object.keys(err).length > 0) {
			fieldErrors = err;
			error = Object.values(err)[0];
			return;
		}
		saving = true;
		try {
			let greetingAudioUrl: string | null = null;
			let queueHoldAudioUrl: string | null = null;
			let allUnavailableAudioUrl: string | null = null;
			let backupCellAudioUrl: string | null = null;
			let failoverConfig: unknown = undefined;
			if (greetingFile) greetingAudioUrl = await uploadFile(greetingFile, 'greeting');
			if (allOnCallFile) queueHoldAudioUrl = await uploadFile(allOnCallFile, 'queue');
			if (unavailableFile)
				allUnavailableAudioUrl = await uploadFile(unavailableFile, 'unavailable');
			if (backupCellFile) backupCellAudioUrl = await uploadFile(backupCellFile, 'backup');
			if (addFailover && failoverFile) {
				const url = await uploadFile(failoverFile, 'failover');
				if (url)
					failoverConfig = [
						{ key: failoverKey || '4', name: failoverName, durationSec: 30, audioUrl: url }
					];
			}
			const res = await fetch('/api/ivr/flows', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: callFlowTitle.trim(),
					greetingAudioUrl,
					queueHoldAudioUrl,
					allUnavailableAudioUrl,
					backupCellAudioUrl,
					failoverConfig
				})
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Failed to create call flow');
			const flowId = data.flow?.id;
			if (flowId && scheduleRule === 'createNew') {
				goto(`/ivr/${flowId}/edit`);
			} else if (flowId) {
				goto('/ivr', { invalidateAll: true });
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save';
		} finally {
			saving = false;
		}
	}
</script>

<div class="min-h-screen bg-[#ECEEF3] p-4">
	<!-- Header -->
	<div class="mb-4 rounded-[3px] bg-white px-4 py-3">
		<div class="flex items-center justify-between">
			<h1 class="font-['Poppins'] text-[23px] font-semibold leading-[30px] text-[#747474]">
				Create Call Flow
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

	<!-- Main Content Card -->
	<div class="max-h-[calc(100vh-120px)] overflow-y-auto rounded-lg bg-white p-6">
		<div class="space-y-8">
			<!-- Call Flow Title -->
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<label class="block font-['Poppins'] text-lg font-semibold leading-[21px] text-[#808080]">
						Call Flow Title:
					</label>
					<SectionHelp
						text="A name for this call flow so you can identify it later (e.g. Main Line, Support)."
					/>
				</div>
				<input
					type="text"
					bind:value={callFlowTitle}
					placeholder="Enter your Call Flow Title"
					class="h-[56px] w-full rounded-[2px] border bg-white px-3 font-['Poppins'] text-base font-medium leading-[19px] text-[rgba(128,128,128,0.54)] outline-none placeholder:text-[rgba(128,128,128,0.54)] {fieldErrors.callFlowTitle
						? 'border-red-500'
						: 'border-[#969696]'}"
				/>
				{#if fieldErrors.callFlowTitle}
					<p class="font-['Poppins'] text-sm text-red-600">{fieldErrors.callFlowTitle}</p>
				{/if}
			</div>

			<!-- Greeting -->
			<AudioUpload label="Greeting:" bind:file={greetingFile} />

			<!-- Call Flow / Schedule Rule -->
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<label class="block font-['Poppins'] text-lg font-semibold leading-[21px] text-[#808080]">
						Call Flow / Schedule Rule:
					</label>
					<SectionHelp
						text="Choose No Rules for a simple flow, or Create New Set Rule to define when this flow is active (e.g. business hours)."
					/>
				</div>
				<div class="relative">
					<select
						bind:value={scheduleRule}
						onchange={handleScheduleRuleChange}
						class="h-[56px] w-full appearance-none rounded-[2px] border border-[#969696] bg-white px-3 pr-10 font-['Poppins'] text-base font-medium leading-[19px] text-[rgba(128,128,128,0.54)] outline-none"
					>
						<option value="noRules">No Rules</option>
						<option value="createNew">Create New Set Rule</option>
					</select>
					<ChevronDown
						class="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
					/>
				</div>
			</div>

			<!-- General Call Flow Rules -->
			<div class="space-y-6">
				<div class="flex items-center gap-2">
					<h2 class="font-['Poppins'] text-2xl font-semibold leading-[28px] text-[#808080]">
						General Call Flow Rules
					</h2>
					<SectionHelp
						text="Audio played in different scenarios: when all reps are on a call, when all are unavailable, and when forwarding to a backup number."
					/>
				</div>

				<!-- All representatives are currently on call -->
				<div class="space-y-2">
					<div class="flex items-center gap-2">
						<p class="font-['Poppins'] text-lg font-semibold leading-[21px] text-[#808080]">
							All representatives are currently on call.
						</p>
						<SectionHelp
							text="Hold music or message played to the caller while they wait in the queue."
						/>
					</div>
					<AudioUpload bind:file={allOnCallFile} />
				</div>

				<!-- All representatives are currently unavailable -->
				<div class="space-y-2">
					<div class="flex items-center gap-2">
						<p class="font-['Poppins'] text-lg font-semibold leading-[21px] text-[#808080]">
							All representatives are currently unavailable (offline or no active forwarding
							number).
						</p>
						<SectionHelp
							text="Message played when no one can take the call (e.g. “We’re closed” or “Leave a message”)."
						/>
					</div>
					<AudioUpload bind:file={unavailableFile} />
				</div>

				<!-- Add Failover -->
				<div class="space-y-4">
					<div class="flex items-center gap-2">
						<input
							type="checkbox"
							bind:checked={addFailover}
							class="h-5 w-5 rounded border border-[#757575]"
						/>
						<label class="font-['Poppins'] text-lg font-semibold leading-[26px] text-[#808080]">
							Add Failover
						</label>
						<SectionHelp
							text="Optional: let callers press a key (e.g. 4) to leave a voicemail or hear a message when no one is available."
						/>
					</div>

					{#if addFailover}
						<div
							class="space-y-4 rounded border bg-white p-4 {fieldErrors.failover
								? 'border-red-500'
								: 'border-[#808080]'}"
						>
							<div class="grid grid-cols-3 gap-4">
								<div class="space-y-2">
									<label
										class="block font-['Poppins'] text-lg font-semibold leading-[26px] text-[#808080]"
									>
										Select one key (4-9)
									</label>
									<button
										type="button"
										onclick={() => (failoverDialerOpen = true)}
										class="flex h-[45px] w-full items-center rounded-[2px] border border-[#969696] bg-white px-3 font-['Poppins'] text-base text-[#808080] outline-none transition-colors hover:border-[#577AB7] hover:bg-[#ECF3FF]"
									>
										{failoverKey || 'Select key'}
									</button>
								</div>
								<DialerDialog
									bind:open={failoverDialerOpen}
									title="Select one key (4-9)"
									keys={['4', '5', '6', '7', '8', '9']}
									onSelect={(k) => (failoverKey = k)}
								/>
								<div class="space-y-2">
									<label
										class="block font-['Poppins'] text-lg font-semibold leading-[26px] text-[#808080]"
									>
										Give a Name
									</label>
									<input
										type="text"
										bind:value={failoverName}
										placeholder="Enter Name Key"
										class="h-[45px] w-full rounded-[2px] border border-[#969696] bg-white px-3 font-['Poppins'] text-base font-normal leading-[19px] text-[rgba(128,128,128,0.47)] outline-none placeholder:text-[rgba(128,128,128,0.47)]"
									/>
								</div>
								<div class="space-y-2">
									<label
										class="block font-['Poppins'] text-lg font-semibold leading-[26px] text-[#808080]"
									>
										Voice Message
									</label>
									<input
										type="text"
										bind:value={failoverDuration}
										placeholder="Duration 30s max"
										class="h-[45px] w-full rounded-[2px] border border-[#969696] bg-white px-3 font-['Poppins'] text-base font-light leading-[19px] text-[rgba(128,128,128,0.47)] outline-none placeholder:text-[rgba(128,128,128,0.47)]"
									/>
								</div>
							</div>
							<div>
								<p class="mb-2 font-['Poppins'] text-lg font-normal leading-[21px] text-[#808080]">
									Upload your audio file below.
								</p>
								<AudioUpload bind:file={failoverFile} />
								{#if fieldErrors.failover}
									<p class="mt-1 font-['Poppins'] text-sm text-red-600">{fieldErrors.failover}</p>
								{/if}
							</div>
						</div>
					{/if}
				</div>

				<!-- All representatives unavailable — forward calls to backup cell number -->
				<div class="space-y-4">
					<div class="flex items-center gap-2">
						<p class="font-['Poppins'] text-lg font-semibold leading-[21px] text-[#808080]">
							All representatives unavailable — forward calls to backup cell number
						</p>
						<SectionHelp
							text="Audio played when the system tries to reach your backup number. The call will ring that number; if no answer, the flow continues (e.g. to voicemail)."
						/>
					</div>
					<!-- Flow Diagram -->
					<div class="flex items-center gap-4">
						<div class="flex flex-col items-center gap-2">
							<span class="font-['Poppins'] text-lg font-medium leading-[26px] text-[#808080]">
								Forward to available cell number
							</span>
							<div class="h-[2px] w-[93px] bg-[#577AB7]"></div>
							<span class="font-['Poppins'] text-lg font-medium leading-[26px] text-[#808080]"
								>Connects</span
							>
						</div>
						<div class="flex flex-col items-center gap-2">
							<span class="font-['Poppins'] text-lg font-medium leading-[26px] text-[#808080]">
								Attempt 5 Rings
							</span>
							<div class="h-[2px] w-[93px] bg-[#577AB7]"></div>
							<span class="font-['Poppins'] text-lg font-medium leading-[26px] text-[#808080]"
								>No Answer</span
							>
						</div>
					</div>
					<div>
						<p class="mb-2 font-['Poppins'] text-base font-normal leading-[19px] text-[#808080]">
							Upload your audio file below.
						</p>
						<div class="rounded border border-[#808080] bg-white p-4">
							<AudioUpload bind:file={backupCellFile} />
						</div>
					</div>
				</div>
			</div>

			{#if error}
				<p class="font-['Poppins'] text-base text-red-600">{error}</p>
			{/if}
			<!-- Action Buttons -->
			<div class="flex justify-end gap-3">
				<button
					onclick={handleBack}
					disabled={saving}
					class="h-[39px] rounded-[3px] border-[0.5px] border-black bg-[#ECEFF3] px-4 font-['Poppins'] text-lg font-normal leading-[21px] text-[#757575] transition-colors hover:bg-[#E0E5EA] disabled:opacity-50"
				>
					Cancel
				</button>
				<button
					onclick={handleSave}
					disabled={saving}
					class="h-[39px] rounded-[3px] border-[0.5px] border-[#577AB7] bg-[#577AB7] px-4 font-['Poppins'] text-lg font-medium leading-[21px] text-white transition-colors hover:bg-[#4a6ba5] disabled:opacity-50"
				>
					{saving ? 'Saving…' : 'Save'}
				</button>
			</div>
		</div>
	</div>
</div>
