<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index';
	import {
		ArrowLeft,
		Download,
		Trash2,
		Mail,
		Clock,
		Star,
		Eye,
		Reply,
		MoreVertical
	} from 'lucide-svelte';
	import ReplyDialog from './reply-dialog.svelte';

	interface NotificationDetail {
		sender: string;
		senderInitials: string;
		recipient: string;
		date: string;
		time: string;
		message: string;
		signature: string;
		recipientEmail?: string;
	}

	interface Props {
		open?: boolean;
		notification?: NotificationDetail | null;
		onCloseNotifications?: () => void;
	}

	let { open = $bindable(false), notification = null, onCloseNotifications }: Props = $props();

	let replyDialogOpen = $state(false);
	let useAI = $state(false);

	function formatDate(dateStr: string): string {
		// Convert "Dec 01 2024" to "December, 01 2024"
		const monthMap: Record<string, string> = {
			Jan: 'January',
			Feb: 'February',
			Mar: 'March',
			Apr: 'April',
			May: 'May',
			Jun: 'June',
			Jul: 'July',
			Aug: 'August',
			Sep: 'September',
			Oct: 'October',
			Nov: 'November',
			Dec: 'December'
		};
		const parts = dateStr.split(' ');
		if (parts.length >= 3 && monthMap[parts[0]]) {
			return `${monthMap[parts[0]]}, ${parts[1]} ${parts[2]}`;
		}
		return dateStr;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="!max-h-[90vh] !w-[1440px] max-w-[80vw] overflow-hidden bg-white !p-0 [&>button]:hidden"
	>
		<div class="flex h-full w-full flex-col overflow-hidden">
			<!-- Top Action Bar -->
			<div
				class="flex flex-shrink-0 items-center justify-between border-b border-[#C6C6C6] bg-[#F9F9F9] px-6 py-3"
			>
				<div class="flex items-center gap-4">
					<button
						class="h-4 w-4 text-[#616161] transition-colors hover:text-[#3D3D3D]"
						onclick={() => (open = false)}
						aria-label="Back"
					>
						<ArrowLeft class="h-4 w-4 " />
					</button>
					<button
						class="h-5 w-5 text-[#818181] transition-colors hover:text-[#616161]"
						aria-label="Archive"
					>
						<Download class="h-5 w-5" />
					</button>
					<button
						class="h-5 w-5 text-[#818181] transition-colors hover:text-[#616161]"
						aria-label="Delete"
					>
						<Trash2 class="h-5 w-5" />
					</button>
					<button
						class="h-5 w-5 text-[#818181] transition-colors hover:text-[#616161]"
						aria-label="Mark as read"
					>
						<Mail class="h-5 w-5" />
					</button>
					<button
						class="h-5 w-5 text-[#818181] transition-colors hover:text-[#616161]"
						aria-label="Reminder"
					>
						<Clock class="h-5 w-5" />
					</button>
				</div>
			</div>

			<!-- Message Header -->
			<div class="flex-shrink-0 px-6 py-4">
				<div class="mb-4 flex items-start gap-4">
					<!-- Avatar -->
					<div
						class="flex h-12 w-[50px] flex-shrink-0 items-center justify-center rounded-full bg-[#59875F]"
					>
						<span class="font-sans text-2xl font-semibold leading-[28px] text-white">
							{notification?.senderInitials || 'SL'}
						</span>
					</div>

					<!-- Sender Info -->
					<div class="min-w-0 flex-1">
						<div class="mb-1 flex items-start justify-between">
							<div class="flex flex-col gap-1">
								<span class="font-sans text-lg font-semibold leading-[21px] text-[#3D3D3D]">
									{notification?.sender || 'Sarah Lee'}
								</span>
								<span class="font-sans text-[15px] font-normal leading-[18px] text-[#3F3F3F]">
									to me, {notification?.recipient || 'Mark Doe'}
								</span>
							</div>

							<div class="flex flex-shrink-0 items-center gap-4">
								<span
									class="whitespace-nowrap font-sans text-lg font-normal leading-[21px] text-[#727272]"
								>
									{formatDate(notification?.date || 'Dec 01 2024')}
									{notification?.time || '9:33 PM'}
								</span>

								<!-- Action Icons -->
								<div class="flex items-center gap-3">
									<button
										class="h-[13.6px] w-[17.58px] text-[#616161] transition-colors hover:text-[#3D3D3D]"
										aria-label="Star"
									>
										<Star class="h-[13.6px] w-[17.58px]" />
									</button>
									<button
										class="h-[14px] w-[14px] text-[#616161] transition-colors hover:text-[#3D3D3D]"
										aria-label="Mark as read"
									>
										<Eye class="h-[14px] w-[14px]" />
									</button>
									<button
										class="h-[14px] w-[15px] text-[#616161] transition-colors hover:text-[#3D3D3D]"
										aria-label="Reply"
									>
										<Reply class="h-[14px] w-[15px]" />
									</button>
									<button
										class="h-4 w-4 text-[#616161] transition-colors hover:text-[#3D3D3D]"
										aria-label="More options"
									>
										<MoreVertical class="h-4 w-4" />
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Separator Line -->
				<div class="mb-4 h-px w-full bg-[#868686]"></div>
			</div>

			<!-- Message Body -->
			<div class="min-h-0 flex-1 overflow-y-auto px-6">
				<div class="mb-4">
					<p class="mb-4 font-sans text-base font-normal leading-[19px] text-black">
						{notification?.message ||
							'I am interested in purchasing a new car. Can I test drive the Ford F150 2026. I would like to visit your dealership this coming Friday between 2:00 pm and 3:30 pm.'}
					</p>
					<p class="font-sans text-lg font-normal leading-[21px] text-[#3F3F3F]">
						{notification?.signature || '-- Best Wishes, Sarah'}
					</p>
				</div>

				<!-- Separator Line -->
				<div class="mb-4 h-px w-full bg-[#AAAAAA]"></div>
			</div>

			<!-- Action Buttons -->
			<div
				class="flex flex-shrink-0 items-center gap-4 border-t border-[#C6C6C6] bg-white px-6 py-4"
			>
				<button
					class="flex h-[41px] items-center gap-2 rounded-2xl border border-black px-4 font-sans text-lg font-normal leading-[21px] text-black transition-colors hover:bg-gray-50"
					onclick={() => {
						useAI = true;
						replyDialogOpen = true;
					}}
				>
					<Reply class="h-[15px] w-5 text-[#474948]" />
					<span>Reply with AI</span>
				</button>
				<button
					class="flex h-[41px] items-center gap-2 rounded-2xl border border-black px-4 font-sans text-lg font-normal leading-[21px] text-black transition-colors hover:bg-gray-50"
				>
					<Reply class="h-[15px] w-5 rotate-180 text-[#474948]" />
					<span>Forward with AI</span>
				</button>
				<button
					class="flex h-[41px] items-center gap-2 rounded-xl border border-black px-4 font-sans text-lg font-normal leading-[21px] text-black transition-colors hover:bg-gray-50"
					onclick={() => {
						useAI = false;
						replyDialogOpen = true;
					}}
				>
					<Reply class="h-[15px] w-5 text-[#474948]" />
					<span>Reply</span>
				</button>
				<button
					class="flex h-[41px] items-center gap-2 rounded-xl border border-black px-4 font-sans text-lg font-normal leading-[21px] text-black transition-colors hover:bg-gray-50"
				>
					<Reply class="h-[15px] w-5 rotate-180 text-[#474948]" />
					<span>Forward</span>
				</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

{#if notification}
	<ReplyDialog
		bind:open={replyDialogOpen}
		{useAI}
		onSend={() => {
			// Close the notification detail dialog when send is clicked
			open = false;
		}}
		onCloseAll={() => {
			// Close notifications dialog as well
			if (onCloseNotifications) {
				onCloseNotifications();
			}
		}}
		replyData={{
			sender: notification.sender,
			senderInitials: notification.senderInitials,
			recipient: notification.recipient,
			recipientEmail:
				notification.recipientEmail ||
				`${notification.sender.toLowerCase().replace(' ', '')}@email.com`,
			date: notification.date,
			time: notification.time,
			originalMessage: notification.message,
			originalSignature: notification.signature
		}}
	/>
{/if}
