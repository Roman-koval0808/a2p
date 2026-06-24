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
	
	let activeBanner = $state<{ title: string; message: string; url: string; id: string } | null>(null);

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
			
			const threadId = data.notification?.threadId;
			const targetUrl = '/communication-log';
			
			const notifSettings = currentUser?.company?.settings;
			const parsedSettings = typeof notifSettings === 'string' ? JSON.parse(notifSettings) : notifSettings;
			const isWebNotifEnabled = parsedSettings?.notifications?.web !== false;

			if (isWebNotifEnabled) {
				// Show toast and desktop notification
				toast.info(data.notification.messagePreview || 'New notification received', {
					description: data.notification.sourceName,
					action: {
						label: 'View',
						onClick: () => goto(targetUrl)
					}
				});
				
				activeBanner = {
					title: data.notification.sourceName || 'New Notification',
					message: data.notification.messagePreview || 'You have a new message.',
					url: targetUrl,
					id: threadId || Date.now().toString()
				};

				showDesktopNotification(data.notification.sourceName || 'New Notification', {
					body: data.notification.messagePreview
				});
			}

			if (typeof window !== 'undefined') {
				window.dispatchEvent(new CustomEvent('sse-new-notification', { detail: data }));
			}
		});

		eventSource.addEventListener('new_sms', (e) => {
			const data = JSON.parse(e.data);
			const threadId = data.notification?.threadId;
			const targetUrl = '/communication-log';
			
			const notifSettings = currentUser?.company?.settings;
			const parsedSettings = typeof notifSettings === 'string' ? JSON.parse(notifSettings) : notifSettings;
			const isWebNotifEnabled = parsedSettings?.notifications?.web !== false;

			if (isWebNotifEnabled) {
				toast.success(`New SMS from ${data.notification.sourceName}`, {
					description: data.notification.messagePreview,
					action: {
						label: 'Reply',
						onClick: () => goto(targetUrl)
					}
				});
				
				activeBanner = {
					title: `New SMS from ${data.notification.sourceName}`,
					message: data.notification.messagePreview,
					url: targetUrl,
					id: threadId || Date.now().toString()
				};

				showDesktopNotification(`New SMS from ${data.notification.sourceName}`, {
					body: data.notification.messagePreview
				});
			}

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

			const notifSettings = currentUser?.company?.settings;
			const parsedSettings = typeof notifSettings === 'string' ? JSON.parse(notifSettings) : notifSettings;
			const isWebNotifEnabled = parsedSettings?.notifications?.web !== false;

			if (isWebNotifEnabled) {
				showDesktopNotification(`Incoming Call: ${currentCaller.name}`, {
					body: `Calling ${currentCaller.phone}`
				});
			}
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

	<Sidebar.Inset class="flex !h-full !min-h-0 min-w-0 flex-col overflow-hidden relative">
		<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-auto bg-background px-4">
			<div class="mb-4 flex flex-shrink-0 items-center justify-between pt-4">
				<div class="flex items-center gap-4">
					<Sidebar.Trigger />
					{#if data.availableCompanies && data.availableCompanies.length > 1}
						<div class="ml-4 flex items-center gap-2">
							<span class="hidden text-sm font-medium text-gray-500 sm:inline">Company:</span>
							<select
								class="h-8 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								value={currentUser?.companyId}
								onchange={async (e) => {
									const newCompanyId = e.target.value;
									try {
										const res = await fetch('/api/me/switch-company', {
											method: 'POST',
											headers: { 'Content-Type': 'application/json' },
											body: JSON.stringify({ companyId: newCompanyId })
										});
										if (res.ok) {
											window.location.reload();
										} else {
											toast.error('Failed to switch company');
										}
									} catch (err) {
										toast.error('Failed to switch company');
									}
								}}
							>
								{#each data.availableCompanies as company}
									<option value={company.id}>{company.name}</option>
								{/each}
							</select>
						</div>
					{/if}
				</div>
				{#if activeBanner}
					<div class="flex items-center gap-3 rounded-full bg-white px-4 py-2 shadow-md border border-gray-100 animate-in slide-in-from-top-2">
						<div class="relative flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600">
							<Bell class="h-4 w-4" />
							<span class="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5 rounded-full bg-red-500"></span>
						</div>
						<div class="flex flex-col">
							<span class="text-sm font-semibold">{activeBanner.title}</span>
							<span class="text-xs text-gray-500 max-w-[200px] truncate">{activeBanner.message}</span>
						</div>
						<Button 
							size="sm" 
							class="ml-2 h-7 rounded-full px-3 text-xs"
							onclick={() => {
								goto(activeBanner?.url || '/communication-log');
								activeBanner = null;
							}}
						>
							Reply Now
						</Button>
						<button class="ml-1 text-gray-400 hover:text-gray-600" onclick={() => activeBanner = null}>
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
						</button>
					</div>
				{/if}
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
