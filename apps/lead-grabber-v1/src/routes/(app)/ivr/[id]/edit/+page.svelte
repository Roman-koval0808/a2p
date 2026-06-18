<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft, ChevronDown, Pencil } from 'lucide-svelte';
	import DialerDialog from '$lib/components/DialerDialog.svelte';
	import TimePicker from '$lib/components/TimePicker.svelte';
	import AudioUpload from '$lib/components/AudioUpload.svelte';
	import SectionHelp from '$lib/components/SectionHelp.svelte';

	let { data }: { data: { flow?: { id: string; title?: string }; flowId?: string } } = $props();
	const flowId = $derived(data?.flowId ?? data?.flow?.id ?? '');
	const flow = $derived(data?.flow ?? null);
	const flowTitle = $derived(flow?.title ?? 'Call Flow');

	const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	let callFlowRuleTitle = $state('Call Flow Rule when Open');
	let promptsFile = $state<File | null>(null);
	let failoverFile = $state<File | null>(null);
	let hangupFile = $state<File | null>(null);
	let saving = $state(false);
	let error = $state('');
	let fieldErrors = $state<Record<string, string>>({});

	let schedule = $state<
		Record<string, { start1: string; end1: string; start2: string; end2: string }>
	>({
		Mon: { start1: '09:00', end1: '17:00', start2: '', end2: '' },
		Tue: { start1: '09:00', end1: '17:00', start2: '', end2: '' },
		Wed: { start1: '09:00', end1: '17:00', start2: '', end2: '' },
		Thu: { start1: '09:00', end1: '17:00', start2: '', end2: '' },
		Fri: { start1: '09:00', end1: '17:00', start2: '', end2: '' },
		Sat: { start1: '', end1: '', start2: '', end2: '' },
		Sun: { start1: '', end1: '', start2: '', end2: '' }
	});

	let keyPrompts = $state<
		{ key: string; name: string; extension: string; transferAudioUrl?: string; editing?: boolean }[]
	>([
		{ key: '1', name: 'Sales', extension: '0001' },
		{ key: '2', name: 'Support', extension: '0002' },
		{ key: '3', name: 'Repeat Option', extension: '0003' }
	]);
	// Per-key transfer message audio (file picked, not yet uploaded)
	let promptTransferFiles = $state<(File | null)[]>([null, null, null]);

	let failoverCount = $state(2);
	let failoverDelayMinutes = $state(30);
	let backDigit = $state('');
	let backDigitDialerOpen = $state(false);
	let dialerOpen = $state(false);
	let dialerEditingIndex = $state(0);

	async function uploadFile(file: File, type: string): Promise<string | null> {
		const form = new FormData();
		form.set('file', file);
		form.set('type', type);
		const res = await fetch('/api/upload/ivr', { method: 'POST', body: form });
		if (!res.ok) throw new Error('Upload failed');
		const data = await res.json();
		return data.url ?? null;
	}

	function timeToMinutes(s: string): number | null {
		if (!s?.trim() || s === '-- : --') return null;
		const parts = s.trim().split(':');
		const h = parseInt(parts[0], 10);
		const m = parseInt(parts[1] ?? '0', 10);
		if (Number.isNaN(h) || Number.isNaN(m)) return null;
		return h * 60 + m;
	}

	function validateSchedule(): string | null {
		for (const d of days) {
			const s = schedule[d];
			if (!s?.start1?.trim() || s.start1 === '-- : --') continue;
			const startM = timeToMinutes(s.start1);
			const endRaw = s.end1?.trim() ? s.end1 : s.start1;
			const endM = timeToMinutes(endRaw);
			if (startM != null && endM != null && endM <= startM)
				return `${d}: Close must be after Open.`;
		}
		return null;
	}

	function scheduleToPayload(): Record<string, { start: string; end: string } | null> {
		const out: Record<string, { start: string; end: string } | null> = {};
		for (const d of days) {
			const s = schedule[d];
			if (!s?.start1?.trim() || s.start1 === '-- : --') {
				out[d] = null;
				continue;
			}
			out[d] = { start: s.start1.trim(), end: (s.end1 || s.start1).trim() };
		}
		return out;
	}

	function handleBack() {
		goto(`/ivr/${flowId}`);
	}

	function toggleEdit(index: number) {
		const next = [...keyPrompts];
		next[index] = { ...next[index], editing: !next[index].editing };
		keyPrompts = next;
	}

	function addKeyPrompt() {
		keyPrompts = [...keyPrompts, { key: '', name: '', extension: '' }];
		promptTransferFiles = [...promptTransferFiles, null];
	}

	function handlePromptTransferFile(event: Event, index: number) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		promptTransferFiles = promptTransferFiles.slice();
		promptTransferFiles[index] = file ?? null;
		if (promptTransferFiles.length < keyPrompts.length) {
			while (promptTransferFiles.length < keyPrompts.length) promptTransferFiles.push(null);
		}
	}

	async function handleSave() {
		error = '';
		fieldErrors = {};
		const err: Record<string, string> = {};
		if (!callFlowRuleTitle.trim()) err.callFlowRuleTitle = 'Rule title is required';
		const scheduleErr = validateSchedule();
		if (scheduleErr) err.schedule = scheduleErr;
		if (!flowId) {
			err.flow = 'Missing flow. Go back and try again.';
		} else {
			const hasCompletePrompt = keyPrompts.some(
				(p) => p.key.trim() && p.name.trim() && p.extension.trim()
			);
			if (!hasCompletePrompt)
				err.keyPrompts = 'At least one key prompt must have Key, Name, and Extension filled.';
		}
		if (Object.keys(err).length > 0) {
			fieldErrors = err;
			error = Object.values(err)[0];
			return;
		}
		saving = true;
		try {
			let promptsAudioUrl: string | null = null;
			let failoverAudioUrl: string | null = null;
			let hangupAudioUrl: string | null = null;
			if (promptsFile) promptsAudioUrl = await uploadFile(promptsFile, 'prompts');
			if (failoverFile) failoverAudioUrl = await uploadFile(failoverFile, 'failover');
			if (hangupFile) hangupAudioUrl = await uploadFile(hangupFile, 'hangup');
			const keyPromptsPayload = await Promise.all(
				keyPrompts.map(async (p, i) => {
					if (!p.key.trim()) return null;
					const transferFile = promptTransferFiles[i] ?? null;
					const transferAudioUrl = transferFile
						? await uploadFile(transferFile, `transfer-${p.key}`)
						: (p.transferAudioUrl ?? undefined);
					return {
						key: p.key.trim(),
						name: p.name.trim(),
						extension: p.extension.trim(),
						...(transferAudioUrl && { transferAudioUrl })
					};
				})
			).then(
				(arr) =>
					arr.filter(Boolean) as {
						key: string;
						name: string;
						extension: string;
						transferAudioUrl?: string;
					}[]
			);
			const res = await fetch(`/api/ivr/flows/${flowId}/rules`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					ruleTitle: callFlowRuleTitle.trim(),
					schedule: scheduleToPayload(),
					promptsAudioUrl,
					keyPrompts: keyPromptsPayload,
					failoverCount,
					failoverDelayMinutes,
					backDigit: backDigit.trim() || null,
					failoverAudioUrl,
					hangupAudioUrl,
					leaveMessageOnHash: true
				})
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Failed to save rule');
			goto(`/ivr/${flowId}`, { invalidateAll: true });
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
				{flowTitle}
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
			<!-- Call Flow Rule Title -->
			<div class="space-y-2">
				<p class="font-['Poppins'] text-xl font-normal leading-[24px] text-[#808080]">
					Building the rules for this call flow IVR
				</p>
				<div class="flex items-center gap-2">
					<label class="block font-['Poppins'] text-xl font-semibold leading-[26px] text-[#808080]">
						Call Flow Rule Title:
					</label>
					<SectionHelp
						text="A name for this rule (e.g. Business Hours, After Hours) so you can tell it apart from other rules."
					/>
				</div>
				<input
					type="text"
					bind:value={callFlowRuleTitle}
					placeholder="Enter Call Rule Title"
					class="h-[46px] w-full rounded-[2px] border bg-white px-3 font-['Poppins'] text-lg font-medium leading-[24px] text-[rgba(128,128,128,0.54)] outline-none placeholder:text-[rgba(128,128,128,0.54)] {fieldErrors.callFlowRuleTitle
						? 'border-red-500'
						: 'border-[#969696]'}"
				/>
				{#if fieldErrors.callFlowRuleTitle}
					<p class="font-['Poppins'] text-sm text-red-600">{fieldErrors.callFlowRuleTitle}</p>
				{/if}
			</div>

			<!-- Set Schedule Rule -->
			<div class="space-y-4">
				<div class="flex items-center gap-2">
					<h2 class="font-['Poppins'] text-xl font-semibold leading-[26px] text-[#808080]">
						Set Schedule Rule
					</h2>
					<SectionHelp
						text="When this rule is active: set Open and Close for each day. Leave empty for closed."
					/>
				</div>
				<p class="font-['Poppins'] text-sm text-[#808080]">
					When this rule is active: set Open and Close for each day. Leave empty for closed. Close
					must be after Open.
				</p>
				{#if fieldErrors.schedule}
					<p class="font-['Poppins'] text-sm text-red-600">{fieldErrors.schedule}</p>
				{/if}
				<div class="grid grid-cols-7 gap-4">
					{#each days as day}
						<div class="space-y-2">
							<div class="font-['Poppins'] text-[22px] font-semibold leading-[26px] text-[#808080]">
								{day}
							</div>
							<div class="space-y-2">
								<div>
									<label class="mb-0.5 block font-['Poppins'] text-xs text-[#808080]">Open</label>
									<TimePicker bind:value={schedule[day].start1} class="w-full" />
								</div>
								<div>
									<label class="mb-0.5 block font-['Poppins'] text-xs text-[#808080]">Close</label>
									<TimePicker bind:value={schedule[day].end1} class="w-full" />
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Upload your audio file for prompts -->
			<div class="space-y-4">
				<div class="flex items-center gap-2">
					<h2 class="font-['Poppins'] text-xl font-semibold leading-[26px] text-[#808080]">
						Upload your audio file for prompts
					</h2>
					<SectionHelp
						text="Main menu message callers hear (e.g. “Press 1 for Sales, 2 for Support”). One file for the whole menu."
					/>
				</div>
				<AudioUpload bind:file={promptsFile} />
			</div>
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<label class="block font-['Poppins'] text-lg font-semibold text-[#808080]"
						>Back / repeat menu digit</label
					>
					<SectionHelp text="Key (e.g. * or #) that replays the menu. Leave unset to disable." />
				</div>
				<button
					type="button"
					onclick={() => (backDigitDialerOpen = true)}
					class="flex h-[45px] w-24 items-center rounded-[2px] border border-[#969696] bg-white px-3 font-['Poppins'] text-base text-[#808080] outline-none transition-colors hover:border-[#577AB7] hover:bg-[#ECF3FF]"
				>
					{backDigit || '—'}
				</button>
				<DialerDialog
					bind:open={backDigitDialerOpen}
					title="Back / repeat menu digit"
					keys={['*', '#']}
					disabledKeys={keyPrompts.map((p) => p.key).filter((k) => k && ['*', '#'].includes(k))}
					onSelect={(k) => (backDigit = k)}
				/>
				<p class="font-['Poppins'] text-sm text-[#808080]">
					When the caller presses this key, the menu prompts are replayed. Leave unset to disable.
				</p>
			</div>
			<!-- Configure your prompts base on audio file -->
			<div class="space-y-4">
				<div class="flex items-center gap-2">
					<h2 class="font-['Poppins'] text-xl font-semibold leading-[26px] text-[#808080]">
						Configure your prompts base on audio file
					</h2>
					<SectionHelp
						text="Map keys (0–9) to options: name, extension to dial, and optional per-key audio (e.g. “Transferring to Sales”)."
					/>
				</div>
				{#if fieldErrors.keyPrompts}
					<p class="font-['Poppins'] text-sm text-red-600">{fieldErrors.keyPrompts}</p>
				{/if}
				<div class="space-y-4">
					{#each keyPrompts as prompt, index}
						<div class="rounded border border-[#969696] bg-white p-4">
							<div class="mb-4 grid grid-cols-3 gap-4">
								<div class="space-y-2">
									<label
										class="block font-['Poppins'] text-lg font-normal leading-[29px] text-[#808080]"
									>
										Select one key (0-9)
									</label>
									<button
										type="button"
										onclick={() => {
											dialerEditingIndex = index;
											dialerOpen = true;
										}}
										class="flex h-[45px] w-full items-center rounded-[2px] border border-[#969696] bg-white px-3 font-['Poppins'] text-base text-[#808080] outline-none transition-colors hover:border-[#577AB7] hover:bg-[#ECF3FF]"
									>
										{prompt.key || 'Select key'}
									</button>
								</div>
								<div class="space-y-2">
									<label
										class="block font-['Poppins'] text-lg font-semibold leading-[29px] text-[#808080]"
									>
										Give a Name
									</label>
									<input
										type="text"
										bind:value={prompt.name}
										placeholder="Enter Name Key"
										class="h-[45px] w-full rounded-[2px] border border-[#969696] bg-white px-3 font-['Poppins'] text-base font-normal leading-[19px] text-[rgba(128,128,128,0.47)] outline-none placeholder:text-[rgba(128,128,128,0.47)]"
									/>
								</div>
								<div class="space-y-2">
									<label
										class="block font-['Poppins'] text-lg font-normal leading-[29px] text-[#808080]"
									>
										Auto generate ext. number
									</label>
									<input
										type="text"
										bind:value={prompt.extension}
										class="h-[45px] w-full rounded-[2px] border border-[#969696] bg-white px-3 font-['Poppins'] text-base font-normal leading-[19px] text-[#808080] outline-none"
									/>
								</div>
							</div>
							<div class="mb-2 font-['Poppins'] text-sm text-[#808080]">
								Pre-recorded message for this key (optional, e.g. “Your call is being transferred to
								[name]…”)
							</div>
							<div class="mb-4">
								<label class="inline-block cursor-pointer">
									<input
										type="file"
										accept="audio/*"
										onchange={(e) => handlePromptTransferFile(e, index)}
										class="hidden"
									/>
									<span
										class="inline-block h-[32px] rounded border border-[#577AB7] bg-white px-3 font-['Poppins'] text-sm text-[#577AB7]"
										role="button"
										tabindex="0"
										onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLElement).click()}
									>
										{promptTransferFiles[index]
											? (promptTransferFiles[index]?.name ?? 'Change')
											: 'Upload audio'}
									</span>
								</label>
							</div>
							<button
								onclick={() => toggleEdit(index)}
								class="mt-4 flex items-center gap-2 font-['Poppins'] text-lg font-normal leading-[21px] text-[#808080]"
							>
								<Pencil class="h-4 w-4" />
								Edit Key {prompt.key}
							</button>
						</div>
					{/each}
					<DialerDialog
						bind:open={dialerOpen}
						title="Select one key (0-9)"
						disabledKeys={[
							...keyPrompts
								.filter((_, i) => i !== dialerEditingIndex)
								.map((p) => p.key)
								.filter(Boolean),
							...(backDigit.trim() ? [backDigit.trim()] : [])
						]}
						onSelect={(k) => {
							const next = [...keyPrompts];
							if (next[dialerEditingIndex])
								next[dialerEditingIndex] = { ...next[dialerEditingIndex], key: k };
							keyPrompts = next;
						}}
					/>
					<button
						onclick={addKeyPrompt}
						class="h-[45px] rounded-[4px] border border-[#577AB7] bg-[#577AB7] px-4 font-['Poppins'] text-base font-semibold leading-[19px] text-white transition-colors hover:bg-[#4a6ba5]"
					>
						Add Another Key Prompts
					</button>
				</div>
			</div>

			<!-- No Response Fail Over -->
			<div class="space-y-4">
				<div class="flex items-center gap-2">
					<h2 class="font-['Poppins'] text-xl font-semibold leading-[26px] text-[#808080]">
						No Response Fail Over
					</h2>
					<SectionHelp
						text="If the call isn’t answered after the set number of rings and delay, this audio is played (e.g. “Please leave a message”)."
					/>
				</div>
				<div class="space-y-4">
					<p class="font-['Poppins'] text-lg font-normal leading-[21px] text-[#808080]">
						Upload Failover audio file below.
					</p>
					<AudioUpload bind:file={failoverFile} />
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<label
								class="block font-['Poppins'] text-xl font-normal leading-[24px] text-[#808080]"
							>
								How many times Failover
							</label>
							<input
								type="number"
								min="1"
								max="5"
								bind:value={failoverCount}
								class="h-[29px] w-full rounded-[2px] border border-[#969696] bg-white px-3 font-['Poppins'] text-xl font-normal leading-[29px] text-[rgba(63,63,63,0.22)] outline-none"
							/>
						</div>
						<div class="space-y-2">
							<label
								class="block font-['Poppins'] text-xl font-normal leading-[24px] text-[#808080]"
							>
								Time before failovers (seconds)
							</label>
							<input
								type="number"
								min="1"
								bind:value={failoverDelayMinutes}
								class="h-[29px] w-full rounded-[2px] border border-[#969696] bg-white px-3 font-['Poppins'] text-xl font-normal leading-[29px] text-[rgba(63,63,63,0.22)] outline-none"
							/>
						</div>
					</div>
				</div>
			</div>

			<!-- Hang Up Audio -->
			<div class="space-y-4">
				<div class="flex items-center gap-2">
					<h2 class="font-['Poppins'] text-xl font-semibold leading-[26px] text-[#808080]">
						Hang Up Audio
					</h2>
					<SectionHelp
						text="Short message played right before the call ends (e.g. “Thank you for calling”)."
					/>
				</div>
				<div>
					<p class="mb-2 font-['Poppins'] text-lg font-normal leading-[21px] text-[#808080]">
						Upload Hangup audio file below.
					</p>
					<AudioUpload bind:file={hangupFile} />
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
					class="h-[52px] rounded-[2px] border border-[#577AB7] bg-[#577AB7] px-4 font-['Poppins'] text-xl font-medium leading-[24px] text-white transition-colors hover:bg-[#4a6ba5] disabled:opacity-50"
				>
					Cancel
				</button>
				<button
					onclick={handleSave}
					disabled={saving}
					class="h-[52px] rounded-[2px] border border-[#577AB7] bg-[#577AB7] px-4 font-['Poppins'] text-xl font-medium leading-[24px] text-white transition-colors hover:bg-[#4a6ba5] disabled:opacity-50"
				>
					{saving ? 'Saving…' : 'Save All Changes'}
				</button>
			</div>
		</div>
	</div>
</div>
