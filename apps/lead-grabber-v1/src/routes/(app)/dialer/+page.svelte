<script lang="ts">
	import { Phone, Clock, Voicemail, Search, Mic, Delete, Plus, Trash2, ArrowUpRight, ArrowDownLeft, PhoneCall, Download } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { normalizePhoneNumber } from '$lib/utils/phone';
	import { filterContacts } from '$lib/utils/contacts-filter';
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';

	let { data } = $props();

	let phoneNumber = $state('');
	let isDialing = $state(false);
	let isCallActive = $state(false);
	let micGranted = $state(false);
	let callStatus = $state('Initializing...');
	let activeTab = $state('Phone');
	let searchQuery = $state('');

	const phoneNumbers = $derived(data.phoneNumbers || []);
	let selectedFromNumber = $state('');
	let telnyxClient: any = $state(null);
	let currentCall: any = $state(null);
	let serverCallId = $state('');

	// Timer state
	let callTimer: any = null;
	let secondsElapsed = $state(0);
	const formattedDuration = $derived(
		`${Math.floor(secondsElapsed / 60).toString().padStart(2, '0')}:${(secondsElapsed % 60).toString().padStart(2, '0')}`
	);

	// Ringback Tone state
	let audioCtx: AudioContext | null = null;
	let ringInterval: any = null;

	function startRingingTone() {
		if (!browser) return;
		try {
			const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
			audioCtx = new AudioContextClass();
			
			const playRingPattern = () => {
				if (!audioCtx || audioCtx.state === 'suspended') return;
				
				const osc1 = audioCtx.createOscillator();
				const osc2 = audioCtx.createOscillator();
				const gainNode = audioCtx.createGain();

				osc1.type = 'sine';
				osc1.frequency.value = 440;
				
				osc2.type = 'sine';
				osc2.frequency.value = 480;

				gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
				gainNode.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.1);
				gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime + 2.0);
				gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 2.1);

				osc1.connect(gainNode);
				osc2.connect(gainNode);
				gainNode.connect(audioCtx.destination);

				osc1.start();
				osc2.start();

				setTimeout(() => {
					try {
						osc1.stop();
						osc2.stop();
						osc1.disconnect();
						osc2.disconnect();
						gainNode.disconnect();
					} catch(e) {}
				}, 2200);
			};

			playRingPattern();
			ringInterval = setInterval(playRingPattern, 6000);
		} catch (e) {
			console.error('Failed to play ringing tone:', e);
		}
	}

	function stopRingingTone() {
		if (ringInterval) {
			clearInterval(ringInterval);
			ringInterval = null;
		}
		if (audioCtx) {
			try {
				audioCtx.close();
			} catch(e) {}
			audioCtx = null;
		}
	}

	function startCallTimer() {
		secondsElapsed = 0;
		if (callTimer) clearInterval(callTimer);
		callTimer = setInterval(() => {
			secondsElapsed++;
		}, 1000);
	}

	function stopCallTimer() {
		if (callTimer) {
			clearInterval(callTimer);
			callTimer = null;
		}
	}

	onDestroy(() => {
		stopRingingTone();
		stopCallTimer();
	});

	// Set initial selected number when phoneNumbers are loaded
	$effect(() => {
		if (phoneNumbers.length > 0 && !selectedFromNumber) {
			selectedFromNumber = phoneNumbers[0].phoneNumber;
		}
	});

	let lastAutoCalledNumber = '';
	// Read phone number and auto-call from URL params
	$effect(() => {
		const phoneParam = page.url.searchParams.get('phone');
		const callParam = page.url.searchParams.get('call');
		if (phoneParam) {
			dialInput = phoneParam;
			phoneNumber = phoneParam;
			if (callParam === 'true' && lastAutoCalledNumber !== phoneParam) {
				lastAutoCalledNumber = phoneParam;
				setTimeout(() => {
					if (!selectedFromNumber && phoneNumbers.length > 0) {
						selectedFromNumber = phoneNumbers[0].phoneNumber;
					}
					initiateCall();
				}, 1000);
			}
		}
	});

	// Initialize WebRTC client on Mount/Effect (Browser-only)
	$effect(() => {
		if (!browser) return;

		let clientInstance: any = null;

		async function initTelnyx() {
			try {
				const res = await fetch('/api/sip/credentials');
				const json = await res.json();
				if (!json.success || !json.data.webrtcToken) {
					console.warn('Failed to retrieve WebRTC credentials or token');
					callStatus = 'Fallback Mode';
					return;
				}

				// Ask for the microphone up front (needs HTTPS + a user having visited the page).
				// getUserMedia is what actually triggers the browser's mic prompt — the WebRTC SDK
				// otherwise only asks on the first call, so granting it here means the first call has
				// audio immediately, and a denial is surfaced now instead of failing mid-call.
				try {
					const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
					stream.getTracks().forEach((t) => t.stop()); // release; the SDK re-acquires on call
					micGranted = true;
				} catch (micErr) {
					console.error('Microphone permission denied/unavailable:', micErr);
					micGranted = false;
					toast.error('Microphone blocked — allow mic access for the browser to make calls.');
				}

				const { TelnyxRTC } = await import('@telnyx/webrtc');
				clientInstance = new TelnyxRTC({
					login_token: json.data.webrtcToken
				});

				// Bind target audio element for incoming media streams
				clientInstance.remoteElement = 'remoteAudio';

				clientInstance.on('telnyx.ready', () => {
					console.log('Telnyx RTC ready');
					callStatus = 'Ready';
				});
				// Surface socket/registration failures explicitly instead of a silent fallback.
				clientInstance.on('telnyx.socket.error', (e: any) => {
					console.error('Telnyx socket error:', e);
					callStatus = 'Fallback Mode';
				});

				clientInstance.on('telnyx.error', (error: any) => {
					console.error('Telnyx RTC error:', error);
					callStatus = 'Fallback Mode';
				});

				clientInstance.on('telnyx.notification', (notification: any) => {
					if (notification.type === 'callUpdate') {
						const call = notification.call;
						currentCall = call;

						switch (call.state) {
							case 'ringing':
								console.log(`Incoming call from ${call.remotePartyNumber}`);
								callStatus = `Ringing: ${call.remotePartyNumber}`;
								if (confirm(`Answer incoming call from ${call.remotePartyNumber}?`)) {
									call.answer();
									isCallActive = true;
									callStatus = 'Connected';
								} else {
									call.hangup();
									isCallActive = false;
									currentCall = null;
									callStatus = 'Ready';
								}
								break;
							case 'active':
								console.log('Call is active');
								stopRingingTone();
								startCallTimer();
								isCallActive = true;
								isDialing = false;
								callStatus = 'Connected';
								break;
							case 'hangup':
								console.log('Call ended');
								stopRingingTone();
								stopCallTimer();
								isCallActive = false;
								isDialing = false;
								currentCall = null;
								callStatus = 'Ready';
								toast.success('Call ended');
								break;
						}
					}
				});

				clientInstance.connect();
				telnyxClient = clientInstance;
			} catch (err) {
				console.error('Error initializing WebRTC client:', err);
				callStatus = 'Fallback Mode';
			}
		}

		initTelnyx();

		return () => {
			if (clientInstance) {
				clientInstance.disconnect();
			}
		};
	});

	async function initiateCall() {
		if (!phoneNumber || phoneNumber.length < 10) {
			toast.error('Please enter a valid phone number');
			return;
		}

		isDialing = true;
		callStatus = 'Dialing...';

		// Format target to E.164
		let target = phoneNumber;
		if (!target.startsWith('+')) {
			const digits = target.replace(/\D/g, '');
			if (digits.length === 10) {
				target = '+1' + digits;
			} else {
				target = '+' + digits;
			}
		}

		// 1. If WebRTC client is ready, make direct WebRTC call
		if (telnyxClient && callStatus === 'Ready') {
			try {
				startRingingTone();
				currentCall = telnyxClient.newCall({
					destinationNumber: target,
					callerNumber: selectedFromNumber,
					audio: true,
					video: false
				});
				isCallActive = true;
			} catch (error) {
				stopRingingTone();
				console.error('WebRTC Call error:', error);
				toast.error('WebRTC call failed, falling back to Server Dial...');
				await initiateServerCall(target);
			}
		} else {
			// 2. Fallback to Server-side REST API dial
			console.log('WebRTC not ready or registered. Using REST fallback.');
			await initiateServerCall(target);
		}
	}

	async function initiateServerCall(target: string) {
		try {
			startRingingTone();
			const response = await fetch('/api/telnyx/dial', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					to: target,
					from: selectedFromNumber
				})
			});

			const result = await response.json();

			if (result.success) {
				toast.success('Call initiated (via server)');
				serverCallId = result.callId;
				isCallActive = true;
				
				setTimeout(() => {
					stopRingingTone();
					startCallTimer();
					callStatus = 'Connected';
				}, 4000);
			} else {
				stopRingingTone();
				toast.error('Failed to place call: ' + result.error);
				callStatus = 'Fallback Mode';
				isCallActive = false;
				isDialing = false;
			}
		} catch (error) {
			stopRingingTone();
			console.error('Server Dial error:', error);
			toast.error('Error placing call');
			callStatus = 'Error';
			isCallActive = false;
			isDialing = false;
		}
	}

	function hangup() {
		stopRingingTone();
		stopCallTimer();

		// 1. Hang up WebRTC call if active
		if (currentCall) {
			try {
				currentCall.hangup();
			} catch (e) {
				console.error(e);
			}
			currentCall = null;
		}

		// 2. Hang up Server call if active
		if (serverCallId) {
			callStatus = 'Hanging up...';
			fetch('/api/telnyx/hangup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callId: serverCallId })
			})
				.then((response) => response.json())
				.then((result) => {
					if (result.success) {
						toast.success('Call ended');
					} else {
						toast.error('Failed to hang up server call: ' + result.error);
					}
				})
				.catch((error) => {
					console.error('Hangup error:', error);
				})
				.finally(() => {
					serverCallId = '';
					isCallActive = false;
					isDialing = false;
					callStatus = telnyxClient ? 'Ready' : 'Fallback Mode';
				});
			return;
		}

		isCallActive = false;
		isDialing = false;
		callStatus = telnyxClient ? 'Ready' : 'Fallback Mode';
	}

	const contacts = $derived(data.contacts);

	let dialInput = $state('');

	let contextMenuOpen = $state(false);
	let contextMenuX = $state(0);
	let contextMenuY = $state(0);
	let dialInputElement: HTMLInputElement | null = $state(null);

	function appendDialInput(d: string) {
		dialInput += d;
	}

	function deleteDialInput() {
		dialInput = dialInput.slice(0, -1);
	}

	function call() {
		phoneNumber = dialInput;
		initiateCall();
	}

	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		contextMenuX = e.clientX;
		contextMenuY = e.clientY;
		contextMenuOpen = true;
	}

	function closeContextMenu() {
		contextMenuOpen = false;
	}

	function handleCreateNewContact() {
		closeContextMenu();
		const phoneParam = dialInput ? `?phone=${encodeURIComponent(dialInput)}` : '';
		goto(`/profiles/create${phoneParam}`);
	}

	function handleAddToExistingContact() {
		closeContextMenu();
		// TODO: Implement add to existing contact
		console.log('Add to existing contact:', dialInput);
	}

	function handleContactClick(contact: any) {
		if (contact.phone) {
			dialInput = normalizePhoneNumber(contact.phone);
		}
	}

	async function handleDeleteLog(id: string) {
		if (!confirm('Are you sure you want to delete this log entry?')) return;
		
		const formData = new FormData();
		formData.append('id', id);
		
		try {
			const res = await fetch('?/deleteLog', {
				method: 'POST',
				body: formData
			});
			
			if (res.ok) {
				toast.success('Log entry deleted');
				await invalidateAll();
			} else {
				toast.error('Failed to delete log entry');
			}
		} catch (err) {
			console.error('Delete error:', err);
			toast.error('Error deleting log entry');
		}
	}

	$effect(() => {
		if (contextMenuOpen) {
			const handleClickOutside = (e: MouseEvent) => {
				if (!(e.target as HTMLElement).closest('.context-menu')) {
					closeContextMenu();
				}
			};
			document.addEventListener('click', handleClickOutside);
			return () => document.removeEventListener('click', handleClickOutside);
		}
	});

	function getRecordingUrl(metadata: any): string | null {
		if (!metadata || typeof metadata !== 'object') return null;
		const urls = metadata.recording_urls;
		if (!urls) return null;
		if (typeof urls === 'string') return urls;
		if (typeof urls === 'object') {
			return urls.mp3 || urls.m4a || urls.wav || Object.values(urls).find((v) => typeof v === 'string' && v.startsWith('http')) || null;
		}
		return null;
	}

	const calls = $derived(data.calls || []);
	
	const filteredCalls = $derived(
		calls.filter((c: any) => {
			if (!searchQuery) return true;
			const query = searchQuery.toLowerCase();
			const source = (c.source || '').toLowerCase();
			const destination = (c.destination || '').toLowerCase();
			const name = (c.customer?.name || '').toLowerCase();
			return source.includes(query) || destination.includes(query) || name.includes(query);
		})
	);

	const voicemails = $derived(
		calls.filter((c: any) => getRecordingUrl(c.metadata) !== null)
	);

	const filteredVoicemails = $derived(
		voicemails.filter((c: any) => {
			if (!searchQuery) return true;
			const query = searchQuery.toLowerCase();
			const source = (c.source || '').toLowerCase();
			const destination = (c.destination || '').toLowerCase();
			const name = (c.customer?.name || '').toLowerCase();
			return source.includes(query) || destination.includes(query) || name.includes(query);
		})
	);

	const filteredContacts = $derived(filterContacts(contacts, searchQuery));
</script>

<!-- Hidden HTML audio element required for WebRTC audio playback -->
<audio id="remoteAudio" autoplay></audio>

<!-- Active Call Dialog Overlay -->
{#if isCallActive || isDialing}
	<div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
		<div class="w-[360px] rounded-2xl bg-white p-8 text-center shadow-2xl border border-gray-100 flex flex-col items-center">
			
			<!-- Animated Pulse Ring -->
			<div class="relative flex items-center justify-center w-24 h-24 rounded-full bg-indigo-50 mb-6">
				<div class="absolute inset-0 rounded-full bg-indigo-400/20 animate-ping"></div>
				<div class="relative w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center shadow-lg">
					<Phone class="h-8 w-8 text-white" />
				</div>
			</div>

			<!-- Recipient Phone Number -->
			<h2 class="font-sans text-2xl font-bold text-gray-800 mb-2">
				{phoneNumber}
			</h2>

			<!-- Call Status & Timer -->
			<p class="font-sans text-sm font-semibold text-[#577AB7] mb-1 tracking-wide uppercase">
				{callStatus}
			</p>
			
			{#if isCallActive && callStatus === 'Connected'}
				<div class="font-mono text-3xl font-bold text-gray-700 mt-2 mb-8 tracking-wider">
					{formattedDuration}
				</div>
			{:else}
				<div class="font-sans text-sm text-gray-400 mt-2 mb-8 animate-pulse">
					Connecting...
				</div>
			{/if}

			<!-- Hangup Button -->
			<button
				onclick={hangup}
				type="button"
				class="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 active:scale-95 transition-all text-white font-sans font-semibold text-lg shadow-lg shadow-red-600/25 flex items-center justify-center gap-2"
			>
				<Phone class="h-5 w-5 rotate-[135deg]" />
				End Call
			</button>
		</div>
	</div>
{/if}

<div class="min-h-screen bg-[#ECEEF3] p-0">
	<div class="p-4">
		<!-- Dialer Title Header -->
		<div class="mb-4 rounded-sm bg-white px-4 py-3">
			<h1 class="font-sans text-lg font-semibold leading-[1.29] text-[#747474]">Dialer</h1>
		</div>

		<!-- Top Row: Search + Tabs -->
		<div class="mb-4 flex w-full items-center justify-between gap-4">
			<!-- Search Bar -->
			<div class="flex h-12 w-1/2 items-center gap-2 rounded bg-white px-3">
				<Search class="h-5 w-5 text-[#577AB7]" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search"
					class="flex-1 border-0 bg-transparent font-sans text-sm leading-[1.29] text-[rgba(120,120,120,0.54)] outline-none placeholder:text-[rgba(120,120,120,0.54)]"
				/>
				<Mic class="h-5 w-5 text-[#577AB7]" />
			</div>

			<!-- Navigation Tabs -->
			<div class="flex h-12 w-1/2 items-center gap-6 rounded bg-white px-6">
				<button
					class="flex items-center gap-1.5 font-sans text-sm leading-[1.29] tracking-normal transition-all pb-1 border-b-2 {activeTab === 'Phone' ? 'font-bold text-[#577AB7] border-[#577AB7]' : 'font-medium text-[#747474] border-transparent hover:text-[#565656]'}"
					onclick={() => (activeTab = 'Phone')}
				>
					<Phone class="h-4 w-4 {activeTab === 'Phone' ? 'text-[#577AB7]' : 'text-[#999999]'}" />
					Phone
				</button>
				<button
					class="flex items-center gap-1.5 font-sans text-sm leading-[1.29] tracking-normal transition-all pb-1 border-b-2 {activeTab === 'Calls' ? 'font-bold text-[#577AB7] border-[#577AB7]' : 'font-medium text-[#747474] border-transparent hover:text-[#565656]'}"
					onclick={() => (activeTab = 'Calls')}
				>
					<Clock class="h-4 w-4 {activeTab === 'Calls' ? 'text-[#577AB7]' : 'text-[#999999]'}" />
					Calls
				</button>
				<button
					class="flex items-center gap-1.5 font-sans text-sm leading-[1.29] tracking-normal transition-all pb-1 border-b-2 {activeTab === 'Voicemail' ? 'font-bold text-[#577AB7] border-[#577AB7]' : 'font-medium text-[#747474] border-transparent hover:text-[#565656]'}"
					onclick={() => (activeTab = 'Voicemail')}
				>
					<Voicemail class="h-4 w-4 {activeTab === 'Voicemail' ? 'text-[#577AB7]' : 'text-[#999999]'}" />
					Voicemail
				</button>
			</div>
		</div>

		<!-- Main Content Row -->
		<div class="flex w-full items-start justify-between gap-4">
			<!-- Left Panel: Contacts, Call History, or Voicemails -->
			<div class="h-[504px] w-1/2 rounded-lg bg-white p-4 flex flex-col">
				{#if activeTab === 'Phone'}
					<!-- Headers -->
					<div class="mb-3 flex font-sans text-sm leading-[1.29] tracking-normal">
						<div class="w-[180px] font-medium text-[#565656]">Name</div>
						<div class="flex-1 font-medium text-[#565656]">Phone</div>
					</div>

					<!-- Contacts List -->
					<div class="flex-1 space-y-2 overflow-y-auto">
						{#each filteredContacts as c}
							<div
								class="flex cursor-pointer items-center border-l-[3px] border-l-[#BEBEBE] bg-[#FAFAFA] py-3 pl-4 pr-3 transition-colors hover:bg-[#F0F0F0]"
								onclick={() => handleContactClick(c)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										handleContactClick(c);
									}
								}}
								role="button"
								tabindex="0"
							>
								<div class="w-[180px] font-sans text-sm leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)] truncate pr-2">
									{c.name}
								</div>
								<div class="flex-1 font-sans text-sm leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)]">
									{c.phone}
								</div>
							</div>
						{/each}
						{#if filteredContacts.length === 0}
							<div class="text-center py-8 text-gray-400 text-sm font-sans">No contacts found.</div>
						{/if}
					</div>
				{:else if activeTab === 'Calls'}
					<!-- Calls List (Call History) -->
					<div class="mb-3 flex font-sans text-xs uppercase tracking-wider text-gray-500 font-semibold px-2">
						<div class="w-[180px]">Call Info</div>
						<div class="w-[100px]">Duration</div>
						<div class="w-[120px]">Date/Time</div>
						<div class="flex-1 text-right">Actions</div>
					</div>

					<div class="flex-1 space-y-2 overflow-y-auto pr-1">
						{#each filteredCalls as callLog}
							{@const contactNumber = callLog.direction === 'inbound' ? callLog.source : callLog.destination}
							{@const displayName = callLog.customer?.name || contactNumber}
							<div
								class="flex items-center border-l-[3px] {callLog.direction === 'inbound' ? (callLog.status === 'missed' ? 'border-l-red-500' : 'border-l-teal-500') : 'border-l-indigo-500'} bg-[#FAFAFA] py-2.5 pl-4 pr-3 rounded-r-md transition-all hover:bg-[#F3F4F6] group"
							>
								<!-- Call Info (Name/Number & Direction) -->
								<div class="w-[180px] font-sans text-sm leading-[1.29] tracking-normal text-gray-700 truncate pr-2">
									<div class="font-semibold flex items-center gap-1.5 truncate">
										{#if callLog.direction === 'inbound'}
											<ArrowDownLeft class="h-3.5 w-3.5 {callLog.status === 'missed' ? 'text-red-500' : 'text-teal-600'}" />
										{:else}
											<ArrowUpRight class="h-3.5 w-3.5 text-indigo-600" />
										{/if}
										<span class="truncate">{displayName}</span>
									</div>
									<div class="text-[11px] text-gray-400 mt-0.5 truncate pl-5">
										{contactNumber}
									</div>
								</div>

								<!-- Duration & Status -->
								<div class="w-[100px] font-sans text-sm text-gray-600">
									<div>{callLog.duration ? `${Math.floor(callLog.duration / 60)}m ${(Math.round(callLog.duration) % 60)}s` : '—'}</div>
									<span class="text-[10px] uppercase font-bold tracking-wider {callLog.status === 'missed' ? 'text-red-500' : callLog.status === 'completed' || callLog.status === 'success' ? 'text-teal-600' : 'text-gray-400'}">
										{callLog.status || 'unknown'}
									</span>
								</div>

								<!-- Date/Time -->
								<div class="w-[120px] font-sans text-xs text-gray-400">
									{new Date(callLog.created).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
								</div>

								<!-- Call-back & Delete Buttons -->
								<div class="flex-1 flex items-center justify-end gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
									<button
										onclick={() => {
											dialInput = contactNumber || '';
											call();
										}}
										class="p-1.5 rounded-full hover:bg-green-50 text-green-600 transition-colors"
										title="Call Back"
									>
										<PhoneCall class="h-4 w-4" />
									</button>
									<button
										onclick={() => handleDeleteLog(callLog.id)}
										class="p-1.5 rounded-full hover:bg-red-50 text-red-600 transition-colors"
										title="Delete Log"
									>
										<Trash2 class="h-4 w-4" />
									</button>
								</div>
							</div>
						{/each}
						{#if filteredCalls.length === 0}
							<div class="text-center py-8 text-gray-400 text-sm font-sans">No recent calls found.</div>
						{/if}
					</div>
				{:else if activeTab === 'Voicemail'}
					<!-- Voicemails List -->
					<div class="mb-3 flex font-sans text-xs uppercase tracking-wider text-gray-500 font-semibold px-2">
						<div class="w-[180px]">From</div>
						<div class="flex-1">Voicemail / Transcript</div>
						<div class="w-[80px] text-right">Actions</div>
					</div>

					<div class="flex-1 space-y-3 overflow-y-auto pr-1">
						{#each filteredVoicemails as vm}
							{@const contactNumber = vm.direction === 'inbound' ? vm.source : vm.destination}
							{@const displayName = vm.customer?.name || contactNumber}
							{@const proxyUrl = `/api/recording/${vm.id}`}
							<div class="flex flex-col border-l-[3px] border-l-amber-500 bg-[#FAFAFA] p-3 pl-4 pr-3 rounded-r-md transition-all hover:bg-[#F3F4F6] group">
								<div class="flex items-center justify-between mb-2">
									<div>
										<div class="font-sans text-sm font-semibold text-gray-700">
											{displayName}
										</div>
										<div class="text-[11px] text-gray-400">
											{contactNumber}
										</div>
									</div>
									<div class="flex items-center gap-3">
										<span class="font-sans text-[11px] text-gray-400">
											{new Date(vm.created).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
										</span>
										<!-- Callback & Delete Actions for Voicemail -->
										<div class="flex items-center gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
											<button
												onclick={() => {
													dialInput = contactNumber || '';
													call();
												}}
												class="p-1 rounded-full hover:bg-green-50 text-green-600 transition-colors"
												title="Call Back"
											>
												<PhoneCall class="h-3.5 w-3.5" />
											</button>
											<button
												onclick={() => handleDeleteLog(vm.id)}
												class="p-1 rounded-full hover:bg-red-50 text-red-600 transition-colors"
												title="Delete Voicemail"
											>
												<Trash2 class="h-3.5 w-3.5" />
											</button>
										</div>
									</div>
								</div>
								
								<!-- Custom Audio Player / Streaming Audio -->
								<div class="w-full mt-1.5 flex items-center gap-2">
									<audio src={proxyUrl} controls class="w-full h-8 rounded bg-transparent"></audio>
									<a
										href={proxyUrl}
										download="voicemail-{vm.id}.mp3"
										class="p-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
										title="Download Voicemail"
									>
										<Download class="h-4 w-4" />
									</a>
								</div>

								<!-- Voicemail Transcript Quote -->
								{#if vm.content && !vm.content.includes('Call recording available')}
									<div class="mt-2.5 bg-amber-50/60 border border-amber-100/80 rounded p-2.5 text-xs text-gray-600 font-sans italic relative pl-3 border-l-2 border-l-amber-300">
										<p class="leading-relaxed">"{vm.content}"</p>
									</div>
								{/if}
							</div>
						{/each}
						{#if filteredVoicemails.length === 0}
							<div class="text-center py-8 text-gray-400 text-sm font-sans">No voicemails found.</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Right Panel: Dial Pad -->
			<div class="h-[504px] w-1/2 rounded-lg bg-white p-6">
				<!-- Call Status Display -->
				{#if callStatus}
					<div class="text-center text-sm font-semibold mb-2 text-[#577AB7] animate-pulse">
						{callStatus}
					</div>
				{/if}

				<!-- Outbound Caller ID Selector -->
				<div class="mb-4 flex items-center justify-center gap-2">
					<span class="text-xs text-gray-500 font-sans">Outbound Number:</span>
					<select
						bind:value={selectedFromNumber}
						class="rounded border border-[#BEBEBE] bg-white px-2 py-1 text-xs font-sans text-gray-700 outline-none"
					>
						{#each phoneNumbers as num}
							<option value={num.phoneNumber}>{num.phoneNumber} {num.connectionLabel ? `(${num.connectionLabel})` : ''}</option>
						{/each}
					</select>
				</div>

				<!-- WebRTC / mic status: at-a-glance whether a call uses the browser softphone (real
				     two-way audio) or the audioless REST fallback. -->
				<div class="mb-4 flex items-center justify-center gap-3 text-xs">
					<span class="flex items-center gap-1.5">
						<span
							class="h-2 w-2 rounded-full {callStatus === 'Ready' || callStatus === 'Connected'
								? 'bg-emerald-500'
								: callStatus === 'Fallback Mode'
									? 'bg-red-500'
									: 'bg-amber-400'}"
						></span>
						<span class="text-gray-600">
							{callStatus === 'Ready' || callStatus === 'Connected'
								? 'Browser calling ready'
								: callStatus === 'Fallback Mode'
									? 'Fallback (no audio) — WebRTC not registered'
									: callStatus}
						</span>
					</span>
					<span class="flex items-center gap-1.5">
						<span class="h-2 w-2 rounded-full {micGranted ? 'bg-emerald-500' : 'bg-red-500'}"></span>
						<span class="text-gray-600">{micGranted ? 'Mic ready' : 'Mic blocked'}</span>
					</span>
				</div>

				<!-- Input Field -->
				<div class="mb-6 text-center">
					<input
						bind:this={dialInputElement}
						type="text"
						bind:value={dialInput}
						placeholder="Enter a name or number"
						oncontextmenu={handleContextMenu}
						class="w-full border-0 border-b border-[#BEBEBE] bg-transparent pb-2 text-center font-sans text-2xl font-bold leading-[1.29] tracking-normal text-[rgba(86,86,86,0.78)] outline-none placeholder:text-[rgba(86,86,86,0.78)]"
					/>
				</div>

				<!-- Number Pad Container -->
				<div class="mx-auto mb-6 w-[280px]">
					<!-- Number Pad Grid -->
					<div class="grid grid-cols-3 gap-x-4 gap-y-6">
						{#each [[1, 2, 3], [4, 5, 6], [7, 8, 9], ['*', 0, '#']] as row}
							{#each row as digit}
								<button
									class="flex h-12 w-full items-center justify-center font-sans text-xl font-medium leading-[1.29] tracking-normal text-[#565656] transition hover:bg-gray-50"
									onclick={() => appendDialInput(digit.toString())}
									type="button"
								>
									{digit}
								</button>
							{/each}
						{/each}
					</div>

					<!-- Action Buttons: Plus, Call, Delete -->
					<div class="mt-6 grid grid-cols-3 gap-x-4">
						<!-- Plus Button -->
						<button
							class="flex h-12 w-full items-center justify-center font-sans text-xl font-medium leading-[1.29] tracking-normal text-[#565656] transition hover:bg-gray-50"
							type="button"
							onclick={() => appendDialInput('+')}
						>
							+
						</button>

						<!-- Call/Hangup Button -->
						{#if isCallActive || isDialing}
							<button
								class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-600 transition hover:bg-red-700"
								onclick={hangup}
								type="button"
							>
								<Phone class="h-5 w-5 text-white rotate-[135deg]" />
							</button>
						{:else}
							<button
								class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#24A103] transition hover:bg-[#1f8a02]"
								onclick={call}
								type="button"
							>
								<Phone class="h-5 w-5 text-white" />
							</button>
						{/if}

						<!-- Delete Button -->
						<button
							class="flex h-12 w-full items-center justify-center font-sans text-xl font-medium leading-[1.29] tracking-normal text-[#565656] transition hover:bg-gray-50"
							onclick={deleteDialInput}
							type="button"
							title="Delete"
						>
							<Delete class="h-5 w-5" />
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Context Menu -->
	{#if contextMenuOpen}
		<div
			class="context-menu fixed z-50 min-w-[180px] rounded-sm bg-[#F5F5F5] py-1 shadow-lg"
			style="left: {contextMenuX}px; top: {contextMenuY}px;"
			role="menu"
		>
			<button
				class="w-full px-4 py-2 text-left font-sans text-sm leading-[1.29] text-[#565656] hover:bg-[#E8E8E8]"
				onclick={handleCreateNewContact}
				role="menuitem"
			>
				Create New Contact
			</button>
			<div class="my-1 border-t border-[#D0D0D0]"></div>
			<button
				class="w-full px-4 py-2 text-left font-sans text-sm leading-[1.29] text-[#565656] hover:bg-[#E8E8E8]"
				onclick={handleAddToExistingContact}
				role="menuitem"
			>
				Add to Existing Contact
			</button>
		</div>
	{/if}
</div>


