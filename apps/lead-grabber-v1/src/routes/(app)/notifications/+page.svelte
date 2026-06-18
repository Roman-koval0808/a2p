<script lang="ts">
	import {
		Search,
		Mail,
		MoreVertical,
		Mic,
		ArrowLeft,
		Download,
		Trash2,
		Reply,
		Phone,
		MessageSquare,
		User
	} from 'lucide-svelte';
	import { goto } from '$app/navigation';

	type NotificationRow = {
		id: string;
		type: string;
		direction: string;
		sourceName: string | null;
		sourceIdentifier: string | null;
		messagePreview: string;
		content: string | null;
		read: boolean;
		threadId: string | null;
		messageId: string | null;
		createdAt: Date;
	};

	let { data } = $props();
	let notifications = $derived(data?.notifications ?? []) as NotificationRow[];
	let selectedFilter = $state('All');
	const filters = ['All', 'Email', 'SMS', 'Voice', 'Facebook', 'Web', 'Leadform', 'Leadbox'];
	let searchQuery = $state('');
	let selectedNotification = $state<NotificationRow | null>(null);

	function formatTime(d: Date) {
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
	}
	function formatDate(d: Date) {
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	let selectedNotifications = $state<Set<string>>(new Set());
	let selectAll = $state(false);

	function toggleSelectAll() {
		if (selectAll) {
			selectedNotifications = new Set();
		} else {
			selectedNotifications = new Set(notifications.map((n) => n.id));
		}
		selectAll = !selectAll;
	}

	function toggleNotification(id: string) {
		if (selectedNotifications.has(id)) {
			selectedNotifications.delete(id);
		} else {
			selectedNotifications.add(id);
		}
		selectedNotifications = new Set(selectedNotifications);
		selectAll = selectedNotifications.size === notifications.length;
	}

	const filteredNotifications = $derived(
		notifications.filter((n) => {
			const matchFilter =
				selectedFilter === 'All' || n.type.toLowerCase() === selectedFilter.toLowerCase();
			const matchSearch =
				!searchQuery.trim() ||
				(n.sourceName?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
				n.messagePreview.toLowerCase().includes(searchQuery.toLowerCase());
			return matchFilter && matchSearch;
		})
	);

	function handleNotificationClick(notification: NotificationRow) {
		selectedNotification = notification;
	}

	function handleReplyClick() {
		if (selectedNotification?.threadId) {
			goto(`/inbox?threadId=${encodeURIComponent(selectedNotification.threadId)}`);
		} else {
			goto(`/notifications/${selectedNotification?.id}/conversation`);
		}
	}

	function typeIcon(type: string) {
		switch (type) {
			case 'sms':
				return MessageSquare;
			case 'voice':
				return Phone;
			case 'email':
				return Mail;
			default:
				return Mail;
		}
	}

	// Realtime: layout subscribes globally and invalidates 'app:notifications'; this page just uses the data
</script>

<div class="w-full min-w-0 overflow-x-auto p-4">
	{#if selectedNotification}
		<!-- Notification Detail View -->
		<div class="max-w-5xl rounded-sm bg-white">
			<!-- Header -->
			<div
				class="flex h-[52px] items-center gap-3 rounded-sm border-b border-[#E0E0E0] bg-white px-4"
			>
				<button
					onclick={() => (selectedNotification = null)}
					class="h-5 w-7 text-[#7D7D7D] transition-colors hover:text-[#555555]"
					aria-label="Back"
				>
					<ArrowLeft class="h-5 w-7" />
				</button>
				<h1 class="font-sans text-xl font-semibold leading-[1.29] text-[#747474]">
					{selectedNotification.sourceName ?? 'Unknown'}
				</h1>
			</div>

			<!-- Content -->
			<div class="rounded-sm bg-white p-5">
				<!-- Metadata Bar -->
				<div class="mb-5 flex items-center justify-between">
					<div class="flex items-center gap-2.5">
						<Mail class="w-4.5 h-4.5 text-[#848484]" />
						<span class="font-sans text-sm font-medium leading-[22px] text-[#717171]">
							{formatDate(selectedNotification.createdAt)}
							{formatTime(selectedNotification.createdAt)}
						</span>
					</div>
					<div class="flex items-center gap-3.5">
						<button
							class="h-4 w-4 text-[#848484] transition-colors hover:text-[#555555]"
							aria-label="Download"
						>
							<Download class="h-4 w-4" />
						</button>
						<button
							class="h-4 w-4 text-[#848484] transition-colors hover:text-[#555555]"
							aria-label="Delete"
						>
							<Trash2 class="h-4 w-4" />
						</button>
						<button
							class="h-4 w-4 text-[#848484] transition-colors hover:text-[#555555]"
							aria-label="Reply"
						>
							<Reply class="h-4 w-4" />
						</button>
						<button
							class="h-4 w-4 text-[#848484] transition-colors hover:text-[#555555]"
							aria-label="More"
						>
							<MoreVertical class="h-4 w-4" />
						</button>
					</div>
				</div>

				<!-- Sender Info -->
				<div class="mb-5 flex items-center gap-2.5">
					<div class="flex h-8 w-8 items-center justify-center rounded-full bg-[#E0E0E0]">
						<User class="w-4.5 h-4.5 text-[#848484]" />
					</div>
					<span class="font-sans text-sm font-medium leading-[1.29] tracking-normal text-[#696969]">
						{selectedNotification.sourceName ?? 'Unknown'}
					</span>
				</div>

				<!-- Message Body -->
				<div class="mb-5 min-h-[120px] rounded-sm bg-[#F9F9F9] p-4">
					<p class="text-sm font-normal leading-[22px] text-[#717171]">
						{selectedNotification.content ?? selectedNotification.messagePreview}
					</p>
				</div>

				<!-- Action Buttons -->
				<div class="flex flex-wrap items-center gap-2.5">
					<button
						onclick={handleReplyClick}
						class="relative flex h-7 items-center justify-center gap-2 rounded-lg border border-[#7F7F7F] px-3 transition-colors hover:bg-gray-50"
					>
						<span
							class="font-sans text-xs font-medium leading-[1.29] tracking-normal text-[#787878]"
						>
							Reply Now
						</span>
						<Reply class="h-3 w-3.5 rotate-180 text-[#787878]" />
					</button>
					<button
						onclick={() => {
							if (selectedNotification?.sourceIdentifier) {
								goto(`/dialer?phone=${encodeURIComponent(selectedNotification.sourceIdentifier)}`);
							} else {
								goto('/dialer');
							}
						}}
						class="relative flex h-7 items-center justify-center gap-2 rounded-lg border border-[#7F7F7F] px-3 transition-colors hover:bg-gray-50"
					>
						<span
							class="font-sans text-xs font-medium leading-[1.29] tracking-normal text-[#787878]"
						>
							Call this Contact
						</span>
						<Phone class="h-3 w-3.5 rotate-180 text-[#787878]" />
					</button>
					<button
						class="relative flex h-7 items-center justify-center gap-2 rounded-lg border border-[#7F7F7F] px-3 transition-colors hover:bg-gray-50"
					>
						<span
							class="font-sans text-xs font-medium leading-[1.29] tracking-normal text-[#787878]"
						>
							Reply via SMS
						</span>
						<MessageSquare class="h-3 w-3.5 rotate-180 text-[#787878]" />
					</button>
					<button
						class="relative flex h-7 items-center justify-center gap-2 rounded-lg border border-[#7F7F7F] px-3 transition-colors hover:bg-gray-50"
					>
						<span
							class="font-sans text-xs font-medium leading-[1.29] tracking-normal text-[#787878]"
						>
							Reply via Email
						</span>
						<Mail class="h-3 w-3.5 rotate-180 text-[#787878]" />
					</button>
				</div>
			</div>
		</div>
	{:else}
		<!-- Title -->
		<h1 class="mb-5 font-sans text-xl font-semibold leading-[1.29] text-[#747474]">
			Important Notifications
		</h1>

		<!-- Filters and Search -->
		<div class="mb-5 flex items-center justify-between gap-4">
			<!-- Filter Buttons -->
			<div class="flex items-center gap-2.5">
				{#each filters as filter}
					<button
						onclick={() => (selectedFilter = filter)}
						class="h-9 rounded-lg px-3.5 font-sans text-sm font-normal leading-[1.29] transition-colors {selectedFilter ===
						filter
							? 'bg-[#577AB7] text-white'
							: 'bg-[#D7DFEB] text-[#577AB7]'}"
					>
						{filter}
					</button>
				{/each}
				<button class="flex h-9 w-9 items-center justify-center rounded-lg bg-[#D7DFEB]">
					<MoreVertical class="w-4.5 h-4.5 text-[#577AB7]" />
				</button>
			</div>

			<!-- Search Bar -->
			<div
				class="relative flex h-9 max-w-lg flex-1 items-center gap-2.5 rounded-lg bg-white px-3.5"
			>
				<Search class="w-4.5 h-4.5 text-[#577AB7]" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search"
					class="flex-1 font-sans text-sm font-normal leading-[1.29] text-[rgba(120,120,120,0.54)] outline-none placeholder:text-[rgba(120,120,120,0.54)]"
				/>
				<Mic class="h-4.5 w-4 text-[#577AB7]" />
			</div>
		</div>

		<!-- Table -->
		<div class="overflow-hidden rounded-lg border-[0.5px] border-[#9A9A9A] bg-white">
			<!-- Table Header -->
			<div
				class="flex h-12 items-center gap-3 rounded-t-lg border-b border-[#9A9A9A] bg-[#F3F3F3] px-4"
			>
				<input
					type="checkbox"
					checked={selectAll}
					onchange={toggleSelectAll}
					class="w-4.5 h-4.5 cursor-pointer rounded-sm border-[1.5px] border-[#4B4B4B] bg-[rgba(217,217,217,0.15)]"
				/>
				<div class="w-20 font-sans text-sm font-medium leading-[1.29] text-[#565656]">Type</div>
				<div class="w-36 font-sans text-sm font-medium leading-[1.29] text-[#565656]">Name</div>
				<div class="flex-1 font-sans text-sm font-medium leading-[1.29] text-[#565656]">
					Message
				</div>
				<div class="w-24 font-sans text-sm font-medium leading-[1.29] text-[#565656]">Time</div>
			</div>

			<!-- Table Body -->
			<div class="max-h-[550px] overflow-y-auto">
				{#if filteredNotifications.length === 0}
					<div class="flex h-24 items-center justify-center font-sans text-sm text-[#717171]">
						{searchQuery.trim() || selectedFilter !== 'All'
							? 'No matching notifications.'
							: 'No notifications yet. New messages and communication logs will appear here.'}
					</div>
				{:else}
					{#each filteredNotifications as notification, index}
						{@const Icon = typeIcon(notification.type)}
						<div
							role="button"
							tabindex="0"
							class="flex h-12 cursor-pointer items-center gap-3 border-b border-[#BEBEBE] px-4 transition-colors hover:bg-gray-50 {index ===
							filteredNotifications.length - 1
								? 'border-b-0'
								: ''} {index % 2 === 0 ? 'bg-white' : 'bg-[#F9F9F9]'}"
							onclick={() => handleNotificationClick(notification)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									handleNotificationClick(notification);
								}
							}}
						>
							<input
								type="checkbox"
								checked={selectedNotifications.has(notification.id)}
								onchange={() => toggleNotification(notification.id)}
								onclick={(e) => e.stopPropagation()}
								class="w-4.5 h-4.5 cursor-pointer rounded-sm border-[1.5px] border-[#919191] bg-[rgba(217,217,217,0.15)]"
							/>
							<div class="flex w-20 items-center">
								<Icon class="h-4 w-5 text-[#B7B7B7]" />
							</div>
							<div class="w-36 font-sans text-sm font-medium leading-[1.29] text-[#787878]">
								{notification.sourceName ?? 'Unknown'}
							</div>
							<div
								class="flex-1 truncate font-sans text-sm leading-[1.29] text-[#717171] {!notification.read
									? 'font-semibold'
									: 'font-normal'}"
							>
								{notification.messagePreview}
							</div>
							<div
								class="w-24 font-sans text-sm font-normal leading-[1.29] text-[rgba(86,86,86,0.78)]"
							>
								{formatTime(notification.createdAt)}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
