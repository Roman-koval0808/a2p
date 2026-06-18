<script lang="ts">
	import '../app.css';
	import { browser } from '$app/environment';
	import { applyAction, enhance } from '$app/forms';
	import { setUserContext } from '$lib/contexts/user';
	import { onMount, type Snippet } from 'svelte';
	import { writable } from 'svelte/store';
	import LoadingBar from '$lib/components/loading-bar.svelte';
	import { Toaster } from 'svelte-sonner';
	import IncomingCallDialog from '$lib/components/IncomingCallDialog.svelte';
	import { callDialog } from '$lib/stores/callDialog';

	interface Props {
		data: any;
		children?: Snippet;
	}

	let { data, children }: Props = $props();

	// Initialize user store
	const user = writable(data.user);
	setUserContext(user);

	// --- Incoming Call Polling Logic ---
	let pollInterval: ReturnType<typeof setInterval>;
	let isPolling = false;
	let currentPendingCallId: string | null = null;
	let pollDelay = 5000; // Start with 5 seconds
	let consecutiveErrors = 0;
	const MAX_POLL_DELAY = 30000; // Max 30 seconds
	const BASE_POLL_DELAY = 5000; // Base 5 seconds

	async function checkForIncomingCalls() {
		if (isPolling) return; // Prevent concurrent polls

		isPolling = true;
		try {
			const response = await fetch('/api/calls/pending', { credentials: 'same-origin' });

			if (!response.ok) {
				// 502/503 = gateway/upstream issue — back off like 429
				if (response.status === 429 || response.status === 502 || response.status === 503) {
					consecutiveErrors++;
					pollDelay = Math.min(BASE_POLL_DELAY * Math.pow(2, consecutiveErrors), MAX_POLL_DELAY);
					if (pollInterval) clearInterval(pollInterval);
					pollInterval = setInterval(checkForIncomingCalls, pollDelay);
					return;
				}
				throw new Error(`HTTP ${response.status}`);
			}

			const data = await response.json();

			// Reset error counter on success
			consecutiveErrors = 0;
			if (pollDelay > BASE_POLL_DELAY) {
				pollDelay = BASE_POLL_DELAY;
				// Restart with base delay
				if (pollInterval) {
					clearInterval(pollInterval);
				}
				pollInterval = setInterval(checkForIncomingCalls, pollDelay);
			}

			if (data.hasCall && data.call) {
				console.log('📞 Found pending call:', data.call);

				// Only show dialog if we don't already have one open
				if (!$callDialog.open) {
					currentPendingCallId = data.call.id;
					callDialog.set({
						open: true,
						call: {
							name: data.call.name || 'Unknown Caller',
							phone: data.call.phone,
							callId: data.call.callId
						}
					});
				}
			}
		} catch (error) {
			console.error('❌ Error checking for calls:', error);
			// Increment error counter on network errors too
			consecutiveErrors++;
			if (consecutiveErrors < 5) {
				pollDelay = Math.min(BASE_POLL_DELAY * Math.pow(2, consecutiveErrors), MAX_POLL_DELAY);
				if (pollInterval) {
					clearInterval(pollInterval);
				}
				pollInterval = setInterval(checkForIncomingCalls, pollDelay);
			}
		} finally {
			isPolling = false;
		}
	}

	async function clearPendingCall() {
		if (currentPendingCallId) {
			try {
				await fetch(`/api/calls/pending?id=${currentPendingCallId}`, { method: 'DELETE' });
				currentPendingCallId = null;
			} catch (error) {
				console.error('❌ Error clearing pending call:', error);
			}
		}
	}

	onMount(() => {
		if (!browser) return;

		console.log('🔌 Starting call polling...');

		// Poll every 5 seconds for incoming calls (reduced from 2s to reduce load)
		pollInterval = setInterval(checkForIncomingCalls, pollDelay);

		// Initial check
		checkForIncomingCalls();

		return () => {
			console.log('🔌 Stopping call polling');
			if (pollInterval) {
				clearInterval(pollInterval);
			}
		};
	});
</script>

<LoadingBar class="bg-primary" />

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap"
		rel="stylesheet"
	/>
</svelte:head>
<Toaster richColors />
<div class="root-layout flex min-h-screen flex-col overflow-x-hidden">
	{#if children}
		{@render children()}
	{/if}

	<!-- Debug Section - Remove in production -->
	<!-- {#if import.meta.env.DEV}
      <div class="fixed top-4 right-4 z-50 bg-black/80 text-white p-4 rounded-lg text-sm">
        <div>📞 Call Polling: {isPolling ? 'Active' : 'Idle'}</div>
        <div>📞 Call Dialog Open: {$callDialog.open}</div>
        <div>📱 Call Data: {JSON.stringify($callDialog.call)}</div>
        <button 
          class="mt-2 bg-blue-600 text-white px-3 py-1 rounded text-xs"
          onclick={async () => {
            console.log('🧪 Creating test incoming call...');
            try {
              const response = await fetch('/api/calls/test', { method: 'POST' });
              const result = await response.json();
              console.log('✅ Test call created:', result);
            } catch (error) {
              console.error('❌ Failed to create test call:', error);
            }
          }}
        >
          Test Incoming Call
        </button>
        <button 
          class="mt-1 bg-gray-600 text-white px-3 py-1 rounded text-xs"
          onclick={() => {
            console.log('🧪 Testing call dialog...');
            callDialog.set({ 
              open: true, 
              call: { 
                name: 'Test Caller',
                phone: '+15551234567',
                callId: 'test-123' 
              }
            });
          }}
        >
          Test Dialog Only
        </button>
        <button 
          class="mt-1 bg-red-600 text-white px-3 py-1 rounded text-xs"
          onclick={() => {
            callDialog.set({ open: false, call: null });
          }}
        >
          Close Dialog
        </button>
      </div>
    {/if} -->

	{#if $callDialog.open && $callDialog.call}
		<IncomingCallDialog
			open={$callDialog.open}
			caller={{
				name: $callDialog.call.name || 'Unknown Caller',
				phone: $callDialog.call.phone
			}}
			on:answer={async () => {
				console.log('📞 User clicked ANSWER');
				try {
					// Answer the call via API
					const response = await fetch('/api/telnyx/answer-call', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ callId: $callDialog.call?.callId })
					});

					if (response.ok) {
						console.log('✅ Call answered successfully');
					} else {
						console.error('❌ Failed to answer call');
					}
				} catch (error) {
					console.error('❌ Error answering call:', error);
				}

				// Clear pending call and close dialog
				await clearPendingCall();
				callDialog.set({ open: false, call: null });
			}}
			on:decline={async () => {
				console.log('📞 User clicked DECLINE');
				try {
					// Hang up the call via API
					const response = await fetch('/api/telnyx/hangup', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ callId: $callDialog.call?.callId })
					});

					if (response.ok) {
						console.log('✅ Call declined successfully');
					} else {
						console.error('❌ Failed to decline call');
					}
				} catch (error) {
					console.error('❌ Error declining call:', error);
				}

				// Clear pending call and close dialog
				await clearPendingCall();
				callDialog.set({ open: false, call: null });
			}}
		/>
	{/if}
</div>
