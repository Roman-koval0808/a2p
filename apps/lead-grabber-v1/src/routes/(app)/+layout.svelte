<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, onDestroy } from 'svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index';
	import { Button } from '$lib/components/ui/button/index';
	import Separator from '$lib/components/ui/separator/separator.svelte';
	import { Bell, LogOut } from 'lucide-svelte';
	import { requestNotificationPermission, showDesktopNotification } from '$lib/utils/browser-notifications';
	import IncomingCallDialog from '$lib/components/IncomingCallDialog.svelte';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth';

	let { children, data } = $props();
	
	// Real-time & Reactive User State
	let currentUser = $state(data.user);
	let unreadCount = $state(0);
	let incomingCallOpen = $state(false);
	let currentCaller = $state({ name: '', phone: '', callId: '' });
	let eventSource: EventSource | null = null;

	const isCommunicationLog = $derived(page.url.pathname === '/communication-log' || page.url.pathname === '/inbox');

	onMount(async () => {
		// Initialize authStore with server-side data
		authStore.setUser(data.user);
		
		// Subscribe to authStore to get real-time profile updates
		const unsubscribe = authStore.subscribe((store) => {
			if (store.user) {
				currentUser = store.user;
			}
		});

		requestNotificationPermission();
		await fetchUnreadCount();
		setupSSE();

		return unsubscribe;
	});

	onDestroy(() => {
		if (eventSource) {
			eventSource.close();
		}
	});

	async function fetchUnreadCount() {
		try {
			const res = await fetch('/api/notifications/unread-count');
			const result = await res.json();
			if (result.success) {
				unreadCount = result.data.count;
			}
		} catch (err) {
			console.error('Failed to fetch unread count:', err);
		}
	}

	function setupSSE() {
		if (!browser) return;

		eventSource = new EventSource('/api/events');

		eventSource.addEventListener('connected', (e) => {
			console.log('SSE Connected:', JSON.parse(e.data));
		});

		eventSource.addEventListener('new_notification', (e) => {
			const data = JSON.parse(e.data);
			unreadCount++;
			
			// Show toast and desktop notification
			toast.info(data.notification.messagePreview || 'New notification received', {
				description: data.notification.sourceName,
				action: {
					label: 'View',
					onClick: () => goto('/inbox')
				}
			});

			showDesktopNotification(data.notification.sourceName || 'New Notification', {
				body: data.notification.messagePreview
			});

			if (typeof window !== 'undefined') {
				window.dispatchEvent(new CustomEvent('sse-new-notification', { detail: data }));
			}
		});

		eventSource.addEventListener('new_sms', (e) => {
			const data = JSON.parse(e.data);
			toast.success(`New SMS from ${data.notification.sourceName}`, {
				description: data.notification.messagePreview,
				action: {
					label: 'Reply',
					onClick: () => goto('/inbox')
				}
			});

			if (typeof window !== 'undefined') {
				window.dispatchEvent(new CustomEvent('sse-new-sms', { detail: data }));
			}
		});

		eventSource.addEventListener('incoming_call', (e) => {
			const data = JSON.parse(e.data);
			currentCaller = {
				name: data.name || 'Unknown Caller',
				phone: data.phone || '',
				callId: data.callId || ''
			};
			incomingCallOpen = true;

			showDesktopNotification(`Incoming Call: ${currentCaller.name}`, {
				body: `Calling ${currentCaller.phone}`
			});
		});

		eventSource.addEventListener('heartbeat', () => {
			// Connection is alive
		});

		eventSource.onerror = (err) => {
			console.error('SSE Error:', err);
			// EventSource will automatically retry connecting
		}
	}

	async function handleAnswerCall() {
		try {
			const res = await fetch('/api/telnyx/answer-call', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callId: currentCaller.callId })
			});
			if (res.ok) {
				toast.success('Call answered');
			}
		} catch (err) {
			toast.error('Failed to answer call');
		} finally {
			incomingCallOpen = false;
		}
	}

	async function handleDeclineCall() {
		try {
			const res = await fetch('/api/telnyx/hangup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ callId: currentCaller.callId })
			});
		} catch (err) {
			console.error('Failed to hangup call:', err);
		} finally {
			incomingCallOpen = false;
		}
	}

	function handleLogout() {
		goto('/logout');
	}

	// Dynamically import heavy components
	const AppSidebar = browser
		? import('$lib/components/app-sidebar.svelte').then((m) => m.default)
		: null;
</script>

<Sidebar.Provider class="!h-full !min-h-0 !flex-1">
	{#await AppSidebar then Sidebar}
		{#if Sidebar}
			<Sidebar user={currentUser} />
		{/if}
	{/await}

	<Sidebar.Inset class="flex !h-full !min-h-0 min-w-0 flex-col overflow-hidden">
		<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-auto bg-background px-4">
			<div class="mb-4 flex flex-shrink-0 items-center gap-4 pt-4">
				<Sidebar.Trigger />
			</div>
			{#if !isCommunicationLog}
				<div class="flex w-full flex-shrink-0 justify-between bg-white px-9 py-5">
					<div class="flex items-center gap-4">
						<img
							src={currentUser?.avatar ? (currentUser.avatar.startsWith('http') || currentUser.avatar.startsWith('/') ? currentUser.avatar : `/${currentUser.avatar}`) : '/img/profile.png'}
							alt=""
							class="profile h-12 w-12 rounded-full object-cover"
						/>
						<div class="flex-col">
							<h2 class="text-lg font-semibold">Good Morning, {currentUser?.name || 'User'}!</h2>
							<p class="text-sm text-gray-500">Simplify how you manage calls and messages.</p>
						</div>
					</div>

					<div class="flex items-center gap-5">
						<div class="relative cursor-pointer" onclick={() => goto('/communication-log')}>
							<Bell
								class="h-6 w-6 text-gray-500 transition-colors hover:text-primary"
							/>
							{#if unreadCount > 0}
								<span class="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
									{unreadCount > 99 ? '99+' : unreadCount}
								</span>
							{/if}
						</div>
						<Separator orientation="vertical" />
						<Button
							class="rounded-xl bg-root-background text-foreground"
							onclick={() => {
								handleLogout();
							}}
						>
							Logout
							<LogOut />
						</Button>
					</div>
				</div>
			{/if}
			<div class="min-h-0 flex-1 overflow-y-auto">
				{@render children?.()}
			</div>
		</div>
	</Sidebar.Inset>
</Sidebar.Provider>

<IncomingCallDialog 
	bind:open={incomingCallOpen} 
	caller={currentCaller} 
	on:answer={handleAnswerCall}
	on:decline={handleDeclineCall}
/>

<style>
	main {
		@apply bg-root-background;
	}

	:global(.root-layout > *),
	:global([data-sidebar='sidebar']) {
		height: 100% !important;
		min-height: 0 !important;
	}

	:global([data-sidebar='inset']) {
		height: 100% !important;
		min-height: 0 !important;
		display: flex !important;
		flex-direction: column !important;
		overflow: hidden !important;
	}
</style>
