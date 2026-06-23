<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	let { companyId } = $props<{ companyId: string }>();

	let activeEmergencyProfile: { id: string; closed: boolean } | null = null;
	let lastKnownEventId: string | null = null;
	let currentWidgetProfileId: string | null = null;
	let currentWidgetPhone = '';
	
	let widgetName = $state('Emergency Customer');
	let widgetPhone = $state('—');
	let widgetAvatar = $state('E');
	let widgetTranscript = $state('Emergency situation detected.');
	let widgetTimelineEvents: any[] = $state([]);

	let showWidget = $state(false);
	
	let hasUnansweredSms = $state(false);
	let hasCallInitiated = $state(false);
	let isFlowCompleted = $state(false);
	let completedJobRevenue = $state('250.00');

	let draftValue = $state('Rory has gotten your message and he will be calling you in two minutes.');
	let draftInputEl: HTMLTextAreaElement | null = $state(null);
	let isSendingSms = $state(false);
	let isRecordingCall = $state(false);
	let isCompletingJob = $state(false);

	let pollerInterval: any;

	onMount(() => {
		pollEmergencyEvents();
		pollerInterval = setInterval(pollEmergencyEvents, 4500);
	});

	onDestroy(() => {
		if (pollerInterval) clearInterval(pollerInterval);
	});

	async function pollEmergencyEvents() {
		try {
			const res = await fetch(`/api/emergency/tenants/${companyId}/events?limit=15`);
			if (!res.ok) return;
			const json = await res.json();
			if (json && Array.isArray(json.data) && json.data.length > 0) {
				const emergencyEvent = json.data.find((ev: any) => ev.intentBucket === 'emergency');
				if (emergencyEvent) {
					const profileId = emergencyEvent.customerProfileId;
					const latestId = json.data[0].id;
					
					if (!activeEmergencyProfile || activeEmergencyProfile.id !== profileId) {
						lastKnownEventId = latestId;
						activeEmergencyProfile = { id: profileId, closed: false };
						await loadEmergencyWidgetData(profileId);
					} else if (latestId !== lastKnownEventId) {
						lastKnownEventId = latestId;
						activeEmergencyProfile.closed = false;
						await loadEmergencyWidgetData(profileId);
					} else {
						if (activeEmergencyProfile.closed) {
							showWidget = false;
						}
					}
				}
			}
		} catch (err) {
			console.warn('[Poller] failed to query events:', err);
		}
	}

	async function loadEmergencyWidgetData(profileId: string) {
		try {
			const res = await fetch(`/api/emergency/tenants/${companyId}/profiles/${profileId}`);
			if (!res.ok) return;
			const p = await res.json();
			
			currentWidgetProfileId = profileId;
			currentWidgetPhone = (p.clearPhone && p.clearPhone !== '—') ? p.clearPhone : (p.phone && p.phone.length < 20 ? p.phone : '');
			
			const historyRes = await fetch(`/api/emergency/tenants/${companyId}/profiles/${profileId}/history`);
			if (!historyRes.ok) return;
			const events = await historyRes.json();
			
			widgetName = p.name || 'Emergency Customer';
			widgetPhone = currentWidgetPhone || '—';
			widgetAvatar = (p.name || 'E').charAt(0).toUpperCase();
			
			const voicemailEvent = events.find((ev: any) => ev.eventType.includes('voicemail') || ev.eventType.includes('call'));
			const transcript = voicemailEvent ? (voicemailEvent.payload?.voicemail_text || voicemailEvent.payload?.textContent || 'Emergency incoming') : 'Emergency situation detected.';
			widgetTranscript = `"${transcript}"`;
			
			widgetTimelineEvents = events.slice(0, 5).map((ev: any) => {
				const isSms = ev.eventType.includes('sms');
				const isCall = ev.eventType.includes('call') || ev.eventType.includes('voicemail');
				const icon = isSms ? '💬' : isCall ? '📞' : '⚙️';
				const timeStr = new Date(ev.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
				const detail = ev.payload?.detail || ev.payload?.body || ev.payload?.textContent || ev.eventType;
				return { icon, timeStr, detail };
			});

			let latestEmergencyStart = null;
			let latestJobCompleted = null;
			let latestSmsReceived = null;
			let latestSmsSent = null;
			hasCallInitiated = false;

			events.forEach((ev: any) => {
				const type = ev.eventType;
				const isStartType = type.includes('voicemail') || type.includes('call_received') || type === 'sms_received' || type === 'message.received';
				
				if (isStartType) {
					if (!latestEmergencyStart || new Date(ev.occurredAt) > new Date(latestEmergencyStart.occurredAt)) {
						latestEmergencyStart = ev;
					}
				}
				if (type === 'job_completed') {
					if (!latestJobCompleted || new Date(ev.occurredAt) > new Date(latestJobCompleted.occurredAt)) {
						latestJobCompleted = ev;
					}
				}
				if (type === 'sms_received' || type === 'message.received') {
					if (!latestSmsReceived || new Date(ev.occurredAt) > new Date(latestSmsReceived.occurredAt)) {
						latestSmsReceived = ev;
					}
				}
				if (type === 'sms_sent' || type === 'message.sent') {
					if (!latestSmsSent || new Date(ev.occurredAt) > new Date(latestSmsSent.occurredAt)) {
						latestSmsSent = ev;
					}
				}
				if (type === 'call_initiated') {
					hasCallInitiated = true;
				}
			});

			isFlowCompleted = !!(latestJobCompleted && (!latestEmergencyStart || new Date(latestJobCompleted.occurredAt) > new Date(latestEmergencyStart.occurredAt)));
			
			if (isFlowCompleted) {
				if (!showWidget) {
					if (activeEmergencyProfile) activeEmergencyProfile.closed = true;
					return;
				}
				const rev = latestJobCompleted.payload?.revenue || '250.00';
				completedJobRevenue = Number(rev).toFixed(2);
			} else {
				hasUnansweredSms = !!(latestSmsReceived && (!latestSmsSent || new Date(latestSmsSent.occurredAt) < new Date(latestSmsReceived.occurredAt)));
				if (hasUnansweredSms) {
					draftValue = 'Rory has gotten your message and he will be calling you in two minutes.';
					setTimeout(() => {
						if (draftInputEl) {
							draftInputEl.focus();
							draftInputEl.setSelectionRange(draftValue.length, draftValue.length);
						}
					}, 120);
				}
			}

			if (!isFlowCompleted || showWidget) {
				if (!showWidget) {
					showWidget = true;
					playAlertSound();
				}
			}
		} catch (err) {
			console.warn('[Widget] failed to load data:', err);
		}
	}

	function playAlertSound() {
		try {
			const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
			const osc = audioCtx.createOscillator();
			const gain = audioCtx.createGain();
			osc.connect(gain);
			gain.connect(audioCtx.destination);
			osc.frequency.setValueAtTime(600, audioCtx.currentTime);
			gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
			osc.start();
			osc.stop(audioCtx.currentTime + 0.1);
		} catch(e) {}
	}

	function closeEmergencyWidget() {
		showWidget = false;
		if (activeEmergencyProfile) {
			activeEmergencyProfile.closed = true;
		}
	}

	async function sendWidgetDraft() {
		if (!currentWidgetPhone || !currentWidgetProfileId) return;
		isSendingSms = true;
		
		try {
			const res = await fetch('/api/emergency/telemetry/send-sms', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					to: currentWidgetPhone,
					body: draftValue
				})
			});
			if (res.ok) {
				await fetch('/api/emergency/telemetry/events', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						tenantSlug: companyId,
						eventType: 'sms_sent',
						phone: currentWidgetPhone,
						provider: 'telnyx_voice',
						payload: {
							detail: `SMS Sent: "${draftValue}"`,
							to: currentWidgetPhone,
							body: draftValue,
							sessionId: 'sess_sms_handshake'
						}
					})
				});
				toast.success('Draft SMS sent successfully!');
				await loadEmergencyWidgetData(currentWidgetProfileId);
			} else {
				toast.error('Failed to send SMS.');
			}
		} catch (err) {
			console.error(err);
			toast.error('Failed to send SMS.');
		} finally {
			isSendingSms = false;
		}
	}

	async function widgetFakeCall() {
		if (!currentWidgetPhone || !currentWidgetProfileId) return;
		isRecordingCall = true;
		
		try {
			const res = await fetch('/api/emergency/telemetry/events', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tenantSlug: companyId,
					eventType: 'call_initiated',
					phone: currentWidgetPhone,
					provider: 'telnyx_voice',
					payload: {
						detail: 'Outbound dispatch call: "We\'re on our way and it\'s $100/hr"',
						duration: 120,
						call_rate: '$100/hr',
						from: '+15513915091'
					}
				})
			});
			if (res.ok) {
				toast.success('Call recorded successfully!');
				await loadEmergencyWidgetData(currentWidgetProfileId);
			} else {
				toast.error('Failed to record call.');
			}
		} catch (err) {
			console.error(err);
			toast.error('Failed to record call.');
		} finally {
			isRecordingCall = false;
		}
	}

	async function widgetCompleteJob() {
		if (!currentWidgetPhone || !currentWidgetProfileId) return;
		isCompletingJob = true;
		
		try {
			const res = await fetch('/api/emergency/telemetry/events', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tenantSlug: companyId,
					eventType: 'job_completed',
					phone: currentWidgetPhone,
					provider: 'telnyx_voice',
					payload: {
						detail: 'Job Completed - Invoiced $250.00',
						revenue: 250.00,
						from: '+15513915091'
					}
				})
			});
			if (res.ok) {
				toast.success('Job completed and review request SMS dispatched!');
				await loadEmergencyWidgetData(currentWidgetProfileId);
			} else {
				toast.error('Failed to complete job.');
			}
		} catch (err) {
			console.error(err);
			toast.error('Failed to complete job.');
		} finally {
			isCompletingJob = false;
		}
	}
</script>

{#if showWidget}
	<div 
		class="fixed bottom-5 left-5 w-[340px] bg-[#1E293B] border border-[#334155] rounded-xl shadow-2xl z-[99999] overflow-hidden text-slate-100 flex flex-col font-sans transition-all duration-300"
	>
		<!-- Header -->
		<div class="bg-red-500/10 border-b border-red-500/20 px-4 py-3 flex items-center justify-between">
			<div class="flex items-center gap-2">
				<span class="text-base">🚨</span>
				<span class="font-bold text-red-500 text-xs tracking-wider uppercase">Active Emergency Lead</span>
			</div>
			<button 
				onclick={closeEmergencyWidget} 
				class="bg-transparent border-0 text-slate-400 hover:text-slate-100 text-lg cursor-pointer flex items-center justify-center w-5 h-5 outline-none"
			>
				&times;
			</button>
		</div>

		<!-- Body -->
		<div class="p-4 flex flex-col gap-3">
			<!-- Header Profile Info -->
			<div class="flex items-center gap-3">
				<div class="h-9 w-9 rounded-full bg-red-600 text-white font-bold flex items-center justify-center text-sm shadow-md">
					{widgetAvatar}
				</div>
				<div class="flex flex-col min-w-0">
					<div class="font-bold text-xs text-white truncate">{widgetName}</div>
					<div class="text-[10px] text-slate-400 font-mono tracking-tight truncate">{widgetPhone}</div>
				</div>
			</div>

			<!-- Dynamic Voicemail Transcript -->
			<div class="bg-[#0F172A] border border-[#1E293B] rounded-lg p-3 text-slate-300 text-xs leading-relaxed italic relative">
				<span class="absolute top-1 left-2 text-[10px] text-slate-500 font-mono font-bold uppercase">Transcript</span>
				<p class="mt-2 text-[11px] leading-[15px]">{widgetTranscript}</p>
			</div>

			<!-- Real-time Timeline Log -->
			<div class="bg-[#0F172A]/50 border border-[#334155]/50 rounded-lg p-3 text-xs flex flex-col gap-2">
				<div class="text-[8px] text-slate-400 font-mono uppercase font-semibold tracking-wider">Trajectory Timeline</div>
				<div class="max-h-[120px] overflow-y-auto flex flex-col gap-2 pr-1">
					{#each widgetTimelineEvents as ev}
						<div class="flex gap-2 text-[10px] text-slate-300 items-start">
							<span class="shrink-0">{ev.icon}</span>
							<span class="text-slate-500 font-mono shrink-0">[{ev.timeStr}]</span>
							<span class="truncate flex-1" title={ev.detail}>{ev.detail}</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- Manual Draft SMS Box -->
			{#if hasUnansweredSms && !isFlowCompleted}
				<div class="bg-[#0EA5E9]/5 border border-[#0EA5E9]/20 rounded-lg p-3 flex flex-col gap-2">
					<div class="text-[8px] text-sky-400 font-mono uppercase font-semibold tracking-wider">Draft Response (Handshake)</div>
					<textarea 
						bind:this={draftInputEl}
						bind:value={draftValue}
						class="w-full h-11 bg-[#0F172A] border border-[#334155] rounded-md p-1.5 text-slate-100 text-xs resize-none outline-none focus:border-sky-500 transition-colors"
					></textarea>
					<div class="flex justify-end">
						<button 
							onclick={sendWidgetDraft} 
							disabled={isSendingSms}
							class="bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white border-0 px-3 py-1.5 rounded-md text-[10px] font-bold cursor-pointer transition-colors"
						>
							{isSendingSms ? 'Sending...' : 'Send Reply SMS'}
						</button>
					</div>
				</div>
			{/if}

			<!-- Action Buttons -->
			{#if !hasUnansweredSms && !isFlowCompleted}
				<div class="flex gap-2 border-t border-[#334155] pt-3">
					{#if !hasCallInitiated}
						<button 
							onclick={widgetFakeCall} 
							disabled={isRecordingCall}
							class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white border-0 py-2 px-3 rounded-lg text-xs font-bold cursor-pointer transition-colors shadow-md"
						>
							{isRecordingCall ? 'Recording...' : '📞 Fake Call ($100/hr)'}
						</button>
					{:else}
						<button 
							onclick={widgetCompleteJob} 
							disabled={isCompletingJob}
							class="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white border-0 py-2 px-3 rounded-lg text-xs font-bold cursor-pointer transition-colors shadow-md"
						>
							{isCompletingJob ? 'Completing...' : '💰 Complete Job'}
						</button>
					{/if}
				</div>
			{/if}

			<!-- Completion Status Banner -->
			{#if isFlowCompleted}
				<div class="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center text-emerald-400 text-xs font-bold flex flex-col gap-1">
					<span>✅ Job Completed!</span>
					<span class="text-[10px] text-emerald-500 font-mono">Invoiced: ${completedJobRevenue}</span>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Scrollbar customization */
	::-webkit-scrollbar {
		width: 4px;
	}
	::-webkit-scrollbar-track {
		background: transparent;
	}
	::-webkit-scrollbar-thumb {
		background: #475569;
		border-radius: 2px;
	}
	::-webkit-scrollbar-thumb:hover {
		background: #64748b;
	}
</style>
