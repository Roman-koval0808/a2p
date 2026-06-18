<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { Download, Trash2, Mail, Clock } from 'lucide-svelte';
	import NotificationDetailDialog from './notification-detail-dialog.svelte';

	interface Notification {
		date: string;
		time: string;
		sender: string;
		commId: string;
		message: string;
		senderInitials?: string;
		recipient?: string;
		recipientEmail?: string;
		signature?: string;
	}

	interface Props {
		open?: boolean;
		notifications?: Notification[];
	}

	let {
		open = $bindable(false),
		notifications = [
			{
				date: 'Dec 01 2024',
				time: '9:33 PM',
				sender: 'Sarah Lee',
				commId: 'COM-00123',
				message:
					'I am interested in purchasing a new car. Can I test drive the Ford F150 2026. I would like to visit your dealership this coming Friday between 2:00 pm and 3:30 pm.',
				recipient: 'Mark Doe'
			},
			{
				date: 'Dec 01 2024',
				time: '9:33 PM',
				sender: 'Rory Dredhart',
				commId: 'COM-00123',
				message: 'Would like to meet you. Hello good day I am interested in purchasing a new car...'
			},
			{
				date: 'Dec 01 2024',
				time: '9:33 PM',
				sender: 'Rory Dredhart',
				commId: 'COM-00123',
				message: 'Would like to meet you. Hello good day I am interested in purchasing a new car...'
			},
			{
				date: 'Dec 01 2024',
				time: '9:33 PM',
				sender: 'Rory Dredhart',
				commId: 'COM-00123',
				message: 'Would like to meet you. Hello good day I am interested in purchasing a new car...'
			},
			{
				date: 'Dec 01 2024',
				time: '9:33 PM',
				sender: 'Rory Dredhart',
				commId: 'COM-00123',
				message: 'Would like to meet you. Hello good day I am interested in purchasing a new car...'
			},
			{
				date: 'Dec 01 2024',
				time: '9:33 PM',
				sender: 'Rory Dredhart',
				commId: 'COM-00123',
				message: 'Would like to meet you. Hello good day I am interested in purchasing a new car...'
			},
			{
				date: 'Dec 01 2024',
				time: '9:33 PM',
				sender: 'Rory Dredhart',
				commId: 'COM-00123',
				message: 'Would like to meet you. Hello good day I am interested in purchasing a new car...'
			},
			{
				date: 'Dec 01 2024',
				time: '9:33 PM',
				sender: 'Rory Dredhart',
				commId: 'COM-00123',
				message: 'Would like to meet you. Hello good day I am interested in purchasing a new car...'
			}
		]
	}: Props = $props();

	let detailDialogOpen = $state(false);
	let selectedNotification = $state<Notification | null>(null);

	function openDetail(notification: Notification) {
		selectedNotification = notification;
		detailDialogOpen = true;
	}

	function getInitials(name: string): string {
		return name
			.split(' ')
			.map((n) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="!max-h-[700px] !w-[1430px] max-w-[95vw] overflow-hidden bg-white !p-0 [&>button]:hidden"
	>
		<div class="flex h-full w-full flex-col overflow-hidden">
			<!-- Header: Your Notifications -->
			<div class="flex-shrink-0 border-b border-[#C6C6C6] px-6 py-4">
				<h2 class="font-sans text-2xl font-normal leading-[1.29] text-[#555555]">
					Your Notifications
				</h2>
			</div>

			<!-- Notifications List -->
			<div class="min-h-0 flex-1 overflow-y-auto">
				{#each notifications as notification, index}
					<div
						class="flex h-[80px] w-full items-center gap-6 border-b-[0.7px] border-[#C6C6C6] px-6 {index %
							2 ===
						0
							? 'bg-white'
							: 'bg-[#F9F9F9]'} cursor-pointer transition-colors hover:bg-gray-100"
						onclick={() => openDetail(notification)}
					>
						<!-- Date and Time -->
						<div class="flex flex-shrink-0 flex-col gap-1">
							<span class="font-sans text-lg font-normal leading-[1.29] text-[#727272]">
								{notification.date}
							</span>
							<span class="font-sans text-[15px] font-normal leading-[1.29] text-[#727272]">
								{notification.time}
							</span>
						</div>

						<!-- Sender and Comm ID -->
						<div class="flex flex-shrink-0 flex-col gap-1">
							<span class="font-sans text-lg font-normal leading-[1.29] text-[#727272]">
								{notification.sender}
							</span>
							<span class="font-sans text-sm font-normal leading-[1.29] text-[#555555]">
								{notification.commId}
							</span>
						</div>

						<!-- Message -->
						<div class="min-w-0 flex-1">
							<p class="truncate font-sans text-lg font-normal leading-[1.29] text-[#727272]">
								{notification.message}
							</p>
						</div>

						<!-- Action Icons -->
						<div class="flex flex-shrink-0 items-center gap-4" onclick={(e) => e.stopPropagation()}>
							<button
								class="h-5 w-5 text-[#818181] transition-colors hover:text-[#555555]"
								aria-label="Download"
							>
								<Download class="h-5 w-5" />
							</button>
							<button
								class="h-5 w-5 text-[#818181] transition-colors hover:text-[#555555]"
								aria-label="Delete"
							>
								<Trash2 class="h-5 w-5" />
							</button>
							<button
								class="h-5 w-5 text-[#818181] transition-colors hover:text-[#555555]"
								aria-label="Email"
							>
								<Mail class="h-5 w-5" />
							</button>
							<button
								class="h-5 w-5 text-[#818181] transition-colors hover:text-[#555555]"
								aria-label="Reminder"
							>
								<Clock class="h-5 w-5" />
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

{#if selectedNotification}
	<NotificationDetailDialog
		bind:open={detailDialogOpen}
		onCloseNotifications={() => {
			open = false;
		}}
		notification={{
			sender: selectedNotification.sender,
			senderInitials:
				selectedNotification.senderInitials || getInitials(selectedNotification.sender),
			recipient: selectedNotification.recipient || 'Mark Doe',
			recipientEmail:
				selectedNotification.recipientEmail ||
				`${selectedNotification.sender.toLowerCase().replace(' ', '')}@email.com`,
			date: selectedNotification.date,
			time: selectedNotification.time,
			message: selectedNotification.message.includes('...')
				? 'I am interested in purchasing a new car. Can I test drive the Ford F150 2026. I would like to visit your dealership this coming Friday between 2:00 pm and 3:30 pm.'
				: selectedNotification.message,
			signature:
				selectedNotification.signature ||
				`-- Best Wishes, ${selectedNotification.sender.split(' ')[0]}`
		}}
	/>
{/if}
