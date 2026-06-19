<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { MessageSquare, Phone, Server, ListFilter, Play, Database, FileText } from 'lucide-svelte';

	let { data, form } = $props();

	let activeTab = $state<'sms' | 'call'>('sms');

	let senderPhone = $state('+15550001111');
	let recipientPhone = $state('');
	let messageContent = $state('');

	let callerPhone = $state('+15550001111');
	let calledPhone = $state('');
	let callTranscript = $state('');

	let isSubmitting = $state(false);

	// Reactive synchronization of selected phone numbers
	$effect(() => {
		if (data.phoneNumbers && data.phoneNumbers.length > 0) {
			if (!recipientPhone) recipientPhone = data.phoneNumbers[0].phoneNumber;
			if (!calledPhone) calledPhone = data.phoneNumbers[0].phoneNumber;
		}
	});

	const presets = [
		{
			title: '🚨 Emergency Leak',
			comment: 'Emergency!, sam here, My roof is leaking after the repair they did last week. I have called 5 times and no one answers. Water is coming into my kitchen right now!',
			sender: '+15559988776'
		},
		{
			title: '💰 Price Quote Request',
			comment: 'Hi there, I am a new customer named John. I would like to get a price estimate or bid for a plumbing pipe renovation project.',
			sender: '+15556655443'
		},
		{
			title: '📞 Callback Request',
			comment: 'This is Jane here. I need someone to call me back as soon as possible to schedule my next maintenance appointment.',
			sender: '+15554433221'
		},
		{
			title: '💬 General Inquiry',
			comment: 'Hello, what are your standard office hours on Monday?',
			sender: '+15552211009'
		}
	];

	function applyPreset(preset: typeof presets[0]) {
		if (activeTab === 'sms') {
			senderPhone = preset.sender;
			messageContent = preset.comment;
		} else {
			callerPhone = preset.sender;
			callTranscript = preset.comment;
		}
		toast.success(`Preset "${preset.title}" applied!`);
	}

	// Dynamic logs color coder
	function getLogClass(line: string) {
		if (line.includes('🔴') || line.toUpperCase().includes('ERROR') || line.toUpperCase().includes('FAILED')) {
			return 'text-red-600 bg-red-50 border-l-4 border-red-500 px-3 py-1 my-1 rounded-r-md font-mono text-sm';
		}
		if (line.includes('🟡') || line.toUpperCase().includes('BLOCKED') || line.toUpperCase().includes('WARNING') || line.toUpperCase().includes('SUPPRESSED')) {
			return 'text-amber-700 bg-amber-50 border-l-4 border-amber-400 px-3 py-1 my-1 rounded-r-md font-mono text-sm';
		}
		if (line.includes('✅') || line.toUpperCase().includes('MATCHED') || line.toUpperCase().includes('SUCCESS') || line.toUpperCase().includes('COMPLETED')) {
			return 'text-emerald-700 bg-emerald-50 border-l-4 border-emerald-500 px-3 py-1 my-1 rounded-r-md font-mono text-sm';
		}
		return 'text-slate-700 hover:bg-slate-50 px-3 py-0.5 font-mono text-xs';
	}
</script>

<div class="space-y-6 pb-12">
	<!-- Page Header -->
	<div class="flex flex-col gap-1 border-b border-slate-100 pb-4">
		<h1 class="text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-3">
			<Server class="h-8 w-8 text-primary" />
			Pipeline Test Console
		</h1>
		<p class="text-slate-500 max-w-2xl">
			Simulate live incoming SMS messages and calls to trigger the Svelte AI Signals Pipeline. Real database events, signals, and actions will be created.
		</p>
	</div>

	<!-- Main Two Column Layout -->
	<div class="grid grid-cols-1 gap-8 lg:grid-cols-12">
		<!-- Left Panel: Trigger Forms -->
		<div class="lg:col-span-5 space-y-6">
			<!-- tab selector wrapper -->
			<div class="bg-slate-100 p-1.5 rounded-xl flex gap-2">
				<button
					type="button"
					class="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all
						{activeTab === 'sms' 
						? 'bg-white text-slate-900 shadow-sm' 
						: 'text-slate-600 hover:text-slate-900'}"
					onclick={() => activeTab = 'sms'}
				>
					<MessageSquare class="h-4 w-4" />
					SMS Simulation
				</button>
				<button
					type="button"
					class="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all
						{activeTab === 'call' 
						? 'bg-white text-slate-900 shadow-sm' 
						: 'text-slate-600 hover:text-slate-900'}"
					onclick={() => activeTab = 'call'}
				>
					<Phone class="h-4 w-4" />
					Call Simulation
				</button>
			</div>

			<!-- Preset Templates Card -->
			<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
				<h3 class="text-sm font-bold text-slate-700 flex items-center gap-2">
					<ListFilter class="h-4 w-4 text-slate-500" />
					Quick Preset Templates
				</h3>
				<div class="grid grid-cols-2 gap-2">
					{#each presets as preset}
						<button
							type="button"
							class="text-left p-3 text-xs bg-slate-50 hover:bg-slate-100 active:bg-slate-200 border border-slate-100 rounded-xl transition-all font-semibold text-slate-700 flex flex-col gap-1"
							onclick={() => applyPreset(preset)}
						>
							<span>{preset.title}</span>
							<span class="text-[10px] text-slate-400 font-normal truncate w-full">{preset.comment}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- Active simulation form -->
			<div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-md space-y-6">
				{#if activeTab === 'sms'}
					<form
						method="POST"
						action="?/triggerSms"
						use:enhance={() => {
							isSubmitting = true;
							return async ({ update }) => {
								isSubmitting = false;
								await update({ reset: false });
								if (form?.success) {
									toast.success('Simulation SMS processed successfully!');
								} else if (form?.error) {
									toast.error(`Simulation failed: ${form.error}`);
								}
							};
						}}
						class="space-y-4"
					>
						<h3 class="text-base font-bold text-slate-900 flex items-center gap-2">
							<Play class="h-5 w-5 text-emerald-500" />
							Trigger Inbound SMS
						</h3>

						<div class="space-y-1.5">
							<label for="sms-sender" class="text-xs font-bold text-slate-500 uppercase tracking-wider">Sender Number (Customer)</label>
							<input
								id="sms-sender"
								name="sender"
								type="text"
								bind:value={senderPhone}
								class="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
								placeholder="+15550001111"
								required
							/>
						</div>

						<div class="space-y-1.5">
							<label for="sms-recipient" class="text-xs font-bold text-slate-500 uppercase tracking-wider">Recipient Number (Your Line)</label>
							<select
								id="sms-recipient"
								name="recipient"
								bind:value={recipientPhone}
								class="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm bg-white"
							>
								{#each data.phoneNumbers as num}
									<option value={num.phoneNumber}>{num.connectionLabel || 'Company Line'} ({num.phoneNumber})</option>
								{/each}
							</select>
						</div>

						<div class="space-y-1.5">
							<label for="sms-comment" class="text-xs font-bold text-slate-500 uppercase tracking-wider">SMS Message Content</label>
							<textarea
								id="sms-comment"
								name="comment"
								rows="5"
								bind:value={messageContent}
								class="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm resize-none"
								placeholder="Type message here or click a preset above..."
								required
							></textarea>
						</div>

						<button
							type="submit"
							disabled={isSubmitting}
							class="w-full py-3 px-4 bg-primary hover:bg-primary/95 disabled:bg-slate-300 text-white font-semibold rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
						>
							{isSubmitting ? 'Processing...' : 'Send Test SMS'}
						</button>
					</form>
				{:else}
					<form
						method="POST"
						action="?/triggerCall"
						use:enhance={() => {
							isSubmitting = true;
							return async ({ update }) => {
								isSubmitting = false;
								await update({ reset: false });
								if (form?.success) {
									toast.success('Simulation Call processed successfully!');
								} else if (form?.error) {
									toast.error(`Simulation failed: ${form.error}`);
								}
							};
						}}
						class="space-y-4"
					>
						<h3 class="text-base font-bold text-slate-900 flex items-center gap-2">
							<Play class="h-5 w-5 text-indigo-500" />
							Trigger Voicemail Call
						</h3>

						<div class="space-y-1.5">
							<label for="call-caller" class="text-xs font-bold text-slate-500 uppercase tracking-wider">Caller Number (Customer)</label>
							<input
								id="call-caller"
								name="caller"
								type="text"
								bind:value={callerPhone}
								class="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
								placeholder="+15550001111"
								required
							/>
						</div>

						<div class="space-y-1.5">
							<label for="call-called" class="text-xs font-bold text-slate-500 uppercase tracking-wider">Called Number (Company Line)</label>
							<select
								id="call-called"
								name="called"
								bind:value={calledPhone}
								class="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm bg-white"
							>
								{#each data.phoneNumbers as num}
									<option value={num.phoneNumber}>{num.connectionLabel || 'Company Line'} ({num.phoneNumber})</option>
								{/each}
							</select>
						</div>

						<div class="space-y-1.5">
							<label for="call-comment" class="text-xs font-bold text-slate-500 uppercase tracking-wider">Voicemail Transcript text</label>
							<textarea
								id="call-comment"
								name="comment"
								rows="5"
								bind:value={callTranscript}
								class="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm resize-none"
								placeholder="Type call transcription text here or click a preset..."
								required
							></textarea>
						</div>

						<button
							type="submit"
							disabled={isSubmitting}
							class="w-full py-3 px-4 bg-primary hover:bg-primary/95 disabled:bg-slate-300 text-white font-semibold rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
						>
							{isSubmitting ? 'Processing...' : 'Simulate Voicemail Event'}
						</button>
					</form>
				{/if}
			</div>
		</div>

		<!-- Right Panel: Logs & JSON Inspector -->
		<div class="lg:col-span-7 space-y-6">
			<!-- Result Status card -->
			{#if form}
				<div class="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
					<div class="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
						<h2 class="text-base font-bold text-slate-800 flex items-center gap-2">
							<FileText class="h-5 w-5 text-primary" />
							Pipeline Run Results
						</h2>
						<span class="text-xs font-bold uppercase px-3 py-1 rounded-full 
							{form.success ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}">
							{form.success ? 'Success' : 'Failed'}
						</span>
					</div>

					<div class="p-6 space-y-6">
						<!-- logs terminal -->
						<div class="space-y-2">
							<h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider">Execution Logs</h3>
							<div class="bg-slate-900 rounded-xl p-4 overflow-y-auto max-h-[300px] border border-slate-950 font-mono text-[11px] leading-relaxed shadow-inner">
								{#if form.logs && form.logs.length > 0}
									{#each form.logs as line}
										<div class={getLogClass(line)}>{line}</div>
									{/each}
								{:else}
									<div class="text-slate-500">No trace logs available.</div>
								{/if}
							</div>
						</div>

						<!-- database objects inspector -->
						{#if form.dbRecord}
							<div class="space-y-3">
								<h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
									<Database class="h-4 w-4 text-slate-400" />
									Database Records Created / Modified
								</h3>
								<div class="space-y-2">
									<!-- Event and Enrichment -->
									<details class="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden group">
										<summary class="px-4 py-3 text-xs font-bold text-slate-700 cursor-pointer hover:bg-slate-100/50 flex items-center justify-between">
											<span>Pipeline Event & Enrichment</span>
											<span class="text-slate-400 group-open:rotate-180 transition-transform">▼</span>
										</summary>
										<div class="p-4 border-t border-slate-200 bg-white">
											<pre class="text-[10px] bg-slate-50 p-3 rounded-lg overflow-x-auto text-slate-700 border border-slate-100">{JSON.stringify({
												id: form.dbRecord.id,
												eventId: form.dbRecord.eventId,
												provider: form.dbRecord.provider,
												eventType: form.dbRecord.eventType,
												processingStatus: form.dbRecord.processingStatus,
												enrichment: form.dbRecord.enrichments?.[0]
											}, null, 2)}</pre>
										</div>
									</details>

									<!-- Signals candidates -->
									<details class="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden group">
										<summary class="px-4 py-3 text-xs font-bold text-slate-700 cursor-pointer hover:bg-slate-100/50 flex items-center justify-between">
											<span>Signals Detected ({form.dbRecord.signals?.length || 0})</span>
											<span class="text-slate-400 group-open:rotate-180 transition-transform">▼</span>
										</summary>
										<div class="p-4 border-t border-slate-200 bg-white">
											<pre class="text-[10px] bg-slate-50 p-3 rounded-lg overflow-x-auto text-slate-700 border border-slate-100">{JSON.stringify(form.dbRecord.signals, null, 2)}</pre>
										</div>
									</details>

									<!-- Decisions and Action Queue -->
									<details class="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden group">
										<summary class="px-4 py-3 text-xs font-bold text-slate-700 cursor-pointer hover:bg-slate-100/50 flex items-center justify-between">
											<span>Decisions & Action Lanes ({form.dbRecord.decisions?.length || 0})</span>
											<span class="text-slate-400 group-open:rotate-180 transition-transform">▼</span>
										</summary>
										<div class="p-4 border-t border-slate-200 bg-white">
											<pre class="text-[10px] bg-slate-50 p-3 rounded-lg overflow-x-auto text-slate-700 border border-slate-100">{JSON.stringify(form.dbRecord.decisions, null, 2)}</pre>
										</div>
									</details>
								</div>
							</div>
						{/if}
					</div>
				</div>
			{:else}
				<div class="bg-slate-50/50 rounded-2xl border border-dashed border-slate-300 p-12 text-center flex flex-col items-center justify-center gap-3">
					<Server class="h-10 w-10 text-slate-400" />
					<h3 class="text-sm font-bold text-slate-700">Test console ready</h3>
					<p class="text-xs text-slate-500 max-w-sm">
						Simulate an incoming communication on the left, and click submit. The results of the AI Signals Pipeline run will be output here.
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>
