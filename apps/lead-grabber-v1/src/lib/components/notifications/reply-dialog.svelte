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
		MoreVertical,
		Send,
		Type,
		Paperclip,
		Link,
		Image
	} from 'lucide-svelte';

	interface ReplyData {
		sender: string;
		senderInitials: string;
		recipient: string;
		recipientEmail: string;
		date: string;
		time: string;
		originalMessage: string;
		originalSignature: string;
	}

	interface Props {
		open?: boolean;
		replyData?: ReplyData | null;
		useAI?: boolean;
		onSend?: () => void;
		onCloseAll?: () => void;
	}

	let {
		open = $bindable(false),
		replyData = null,
		useAI = false,
		onSend,
		onCloseAll
	}: Props = $props();

	let replyMessage = $state('');
	let agent = $state('Mark Doe');
	let appointmentTime = $state('2:30pm - 3:15pm');
	let location = $state('123 Pine St N Timmins Ontario');
	let purpose = $state('Test Drive');

	$effect(() => {
		if (open && useAI && replyData) {
			// Pre-fill with AI-generated content
			replyMessage = `Hello ${replyData.sender.split(' ')[0]}, we have sent you a calendar invite to test drive the Ford F150 @ 2:30 pm - 3:15 pm. I enclosed the F150 brochure listing all of the features. Please confirm the appointment by clicking Yes. If this time is not acceptable or you need to cancel you can refer to this email.`;
		} else if (open && !useAI) {
			// Empty for manual reply
			replyMessage = '';
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="!max-h-[90vh] !w-[1200px] max-w-[75vw] overflow-hidden bg-white !p-0 [&>button]:hidden"
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
						<ArrowLeft class="h-4 w-4" />
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

			<!-- Scrollable Content Area -->
			<div class="min-h-0 flex-1 overflow-y-auto">
				<!-- Original Email -->
				<div class="px-6 py-4">
					<div class="mb-4 flex items-start gap-4">
						<!-- Avatar -->
						<div
							class="flex h-12 w-[50px] flex-shrink-0 items-center justify-center rounded-full bg-[#59875F]"
						>
							<span class="font-sans text-2xl font-semibold leading-[28px] text-white">
								{replyData?.senderInitials || 'SL'}
							</span>
						</div>

						<!-- Sender Info -->
						<div class="min-w-0 flex-1">
							<div class="mb-1 flex items-start justify-between">
								<div class="flex flex-col gap-1">
									<span class="font-sans text-lg font-semibold leading-[21px] text-[#3D3D3D]">
										{replyData?.sender || 'Sarah Lee'}
									</span>
									<span class="font-sans text-[15px] font-normal leading-[18px] text-[#3F3F3F]">
										to me, {replyData?.recipient || 'Nate'}
									</span>
								</div>

								<div class="flex flex-shrink-0 items-center gap-4">
									<span
										class="whitespace-nowrap font-sans text-lg font-normal leading-[21px] text-[#727272]"
									>
										{replyData?.date || 'December, 01 2024'}
										{replyData?.time || '9:33 PM'}
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

					<!-- Original Message -->
					<div class="mb-4">
						<p class="mb-4 font-sans text-base font-normal leading-[19px] text-black">
							{replyData?.originalMessage ||
								'I am interested in purchasing a new car. Can I test drive the Ford F150 2026. I would like to visit your dealership this coming Friday between 2:00 pm and 3:30 pm.'}
						</p>
						<p class="font-sans text-lg font-normal leading-[21px] text-[#3F3F3F]">
							{replyData?.originalSignature || '-- Best Wishes, Rory'}
						</p>
					</div>

					<!-- Separator Line -->
					<div class="mb-4 h-px w-full bg-[#868686]"></div>
				</div>

				<!-- Reply Card -->
				<div class="px-6 pb-4">
					<div class="rounded-lg bg-white p-6 shadow-[0px_0px_4.7px_2px_rgba(0,0,0,0.21)]">
						<!-- Reply Header -->
						<div class="mb-4 flex items-center gap-2">
							<Reply class="h-[15px] w-5 text-[#474948]" />
							<span class="font-sans text-lg font-normal leading-[21px] text-black">
								{replyData?.sender || 'Sarah Lee'} ({replyData?.recipientEmail ||
									'sarahlee@email.com'})
							</span>
						</div>

						<!-- Reply Message Editor -->
						<div class="mb-4">
							{#if useAI}
								<!-- Pre-filled AI content -->
								<div class="mb-4">
									<p class="mb-4 font-sans text-lg font-normal leading-[26px] text-[#3F3F3F]">
										{replyMessage}
									</p>
								</div>
							{:else}
								<!-- Empty textarea for manual reply -->
								<textarea
									bind:value={replyMessage}
									placeholder="Type your reply here..."
									class="mb-4 min-h-[130px] w-full resize-none rounded-lg border border-gray-300 p-4 font-sans text-lg font-normal leading-[26px] text-[#3F3F3F] focus:outline-none focus:ring-2 focus:ring-blue-500"
								></textarea>
							{/if}

							<!-- Appointment Details (shown on both) -->
							<div class="mb-4">
								<p class="mb-2 font-sans text-lg font-semibold leading-[26px] text-[#3F3F3F]">
									<span class="font-semibold">Agent:</span>
									{agent}
								</p>
								<p class="mb-2 font-sans text-lg font-semibold leading-[26px] text-[#3F3F3F]">
									<span class="font-semibold">Appointment:</span>
									{appointmentTime}
								</p>
								<p class="mb-2 font-sans text-lg font-semibold leading-[26px] text-[#3F3F3F]">
									<span class="font-semibold">Location:</span>
									{location}
								</p>
								<p class="mb-2 font-sans text-lg font-semibold leading-[26px] text-[#3F3F3F]">
									<span class="font-semibold">Purpose:</span>
									{purpose}
								</p>
								<div class="mb-2 flex items-center gap-2">
									<span class="font-sans text-lg font-semibold leading-[26px] text-[#3F3F3F]">
										<span class="font-semibold">Confirm Appointment:</span>
									</span>
									<button
										class="flex h-[26px] w-[53px] items-center justify-center rounded bg-[#57B76C] font-sans text-lg font-semibold leading-[26px] text-white transition-colors hover:bg-[#57B76C]/90"
									>
										Yes
									</button>
									<button
										class="flex h-[26px] w-[53px] items-center justify-center rounded bg-[#DA3E3E] font-sans text-lg font-semibold leading-[26px] text-white transition-colors hover:bg-[#DA3E3E]/90"
									>
										No
									</button>
								</div>
							</div>
						</div>

						<!-- Bottom Toolbar -->
						<div
							class="flex h-[63px] w-full items-center justify-between rounded-2xl bg-[#EBEBEB] px-4"
						>
							<div class="flex items-center gap-4">
								<button
									class="flex h-[40px] items-center gap-2 rounded-full bg-[#0C58D1] px-6 font-sans text-lg font-semibold leading-[21px] text-white transition-colors hover:bg-[#0C58D1]/90"
									onclick={() => {
										if (onSend) {
											onSend();
										}
										if (onCloseAll) {
											onCloseAll();
										}
										open = false;
									}}
								>
									<Send class="h-5 w-5" />
									<span>Send</span>
								</button>
								<div class="h-10 w-px bg-white"></div>
								<button
									class="h-5 w-5 text-[#3F3F3F] transition-colors hover:text-[#3D3D3D]"
									aria-label="Format text"
								>
									<Type class="h-5 w-5" />
								</button>
								<button
									class="h-5 w-5 text-[#3F3F3F] transition-colors hover:text-[#3D3D3D]"
									aria-label="Attach file"
								>
									<Paperclip class="h-5 w-5" />
								</button>
								<button
									class="h-5 w-5 text-[#3F3F3F] transition-colors hover:text-[#3D3D3D]"
									aria-label="Insert link"
								>
									<Link class="h-5 w-5" />
								</button>
								<button
									class="h-5 w-5 text-[#3F3F3F] transition-colors hover:text-[#3D3D3D]"
									aria-label="Insert image"
								>
									<Image class="h-5 w-5" />
								</button>
								<button
									class="h-5 w-5 text-[#3F3F3F] transition-colors hover:text-[#3D3D3D]"
									aria-label="More options"
								>
									<MoreVertical class="h-5 w-5" />
								</button>
							</div>
							<button
								class="h-5 w-5 text-[#818181] transition-colors hover:text-[#616161]"
								aria-label="Delete draft"
							>
								<Trash2 class="h-5 w-5" />
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
