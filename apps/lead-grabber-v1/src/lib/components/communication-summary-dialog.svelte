<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index';

	interface Props {
		open?: boolean;
		commId?: string;
		date?: string;
		time?: string;
		category?: string;
		subCategory?: string;
		email?: string;
		subject?: string;
		body?: string;
		summary?: string;
		tasks?: string[];
		/** For voice: phone number shown as source */
		sourceLabel?: string;
		/** For voice: call recording playback URL (mp3/m4a from metadata.recording_urls) */
		recordingUrl?: string | null;
		estimatedPrice?: number | null;
		draftedMessage?: string | null;
		department?: string | null;
		/** For voice: the IVR path, e.g. "Called …5691 · Pressed 3 (Support) · Voicemail left" */
		ivrPath?: string | null;
	}

	let {
		open = $bindable(false),
		commId = '001234',
		date = '06-01-25',
		time = '02:12:03',
		category = '',
		subCategory = '',
		email = '',
		subject = '',
		body = '',
		summary = '',
		tasks = [],
		sourceLabel = '',
		recordingUrl = null,
		estimatedPrice = null,
		draftedMessage = null,
		department = null,
		ivrPath = null
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="!h-[567px] !w-[605px] overflow-hidden rounded bg-white !p-0 shadow-[0px_4px_4px_rgba(0,0,0,0.25)] [&>button]:hidden"
	>
		<div class="relative flex h-full w-full flex-col overflow-hidden p-6">
			<!-- Header Section -->
			<div class="mb-4 flex items-start justify-between">
				<!-- Left side: AI Summary and Date/Time -->
				<div class="flex flex-col gap-1">
					<div class="flex items-center gap-2">
						<span
							class="font-sans text-base font-semibold leading-[1.29] text-[rgba(86,86,86,0.94)]"
						>
							AI Summary:
						</span>
						<span
							class="font-sans text-base font-normal leading-[1.29] text-[rgba(86,86,86,0.78)]"
						>
							{date} | {time}
						</span>
					</div>
					{#if ivrPath}
						<span class="font-sans text-xs font-medium leading-tight text-[#4A72B2]">
							{ivrPath}
						</span>
					{/if}
				</div>

				<!-- Right side: Comm ID, Category, Sub-Category -->
				<div class="flex flex-col items-end gap-1">
					<span class="font-sans text-base font-medium leading-[1.29] text-[rgba(86,86,86,0.78)]">
						Comm ID - {commId ? (commId.startsWith('DROP-') ? commId : 'COM-' + commId.slice(-5).toUpperCase()) : '—'}
					</span>
					<span class="font-sans text-base font-medium leading-[1.29] text-[rgba(86,86,86,0.88)]">
						Category: {category}
					</span>
					<span
						class="text-right font-sans text-base font-medium leading-[1.29] text-[rgba(86,86,86,0.88)]"
					>
						Sub-Category: {subCategory}
					</span>
					{#if department}
						<span
							class="text-right font-sans text-base font-medium leading-[1.29] text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded mt-1"
						>
							Department: {department}
						</span>
					{/if}
				</div>
			</div>

			<!-- Main Content Area -->
			<div
				class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded border-b border-[#BEBEBE] bg-[#F7F7F7] p-4"
			>
				<!-- Summary Heading -->
				<span class="font-sans text-base font-semibold leading-[1.29] text-[rgba(86,86,86,0.88)]">
					Summary:
				</span>

				<!-- Inner White Box -->
				<div class="flex min-h-0 flex-col gap-3 overflow-y-auto rounded bg-[#FFFDFD] p-4">
					<!-- Email, Subject, Body Labels and Values -->
					<div class="flex flex-col gap-2">
						<div class="flex items-start gap-4">
							<span
								class="flex-shrink-0 whitespace-nowrap font-sans text-[15px] font-normal leading-[141%] text-[rgba(86,86,86,0.78)]"
							>
								{sourceLabel}:
							</span>
							<span
								class="min-w-0 break-words font-sans text-[15px] font-medium leading-[141%] text-[rgba(86,86,86,0.78)]"
							>
								{email}
							</span>
						</div>
						{#if estimatedPrice !== undefined && estimatedPrice !== null}
							<div class="flex items-start gap-4">
								<span
									class="flex-shrink-0 whitespace-nowrap font-sans text-[15px] font-normal leading-[141%] text-[rgba(86,86,86,0.78)]"
								>
									Estimated Value:
								</span>
								<span
									class="min-w-0 break-words font-sans text-[15px] font-semibold leading-[141%] text-emerald-600"
								>
									${estimatedPrice}
								</span>
							</div>
						{/if}
						{#if recordingUrl}
							<div class="flex flex-col gap-1">
								<span
									class="flex-shrink-0 whitespace-nowrap font-sans text-[15px] font-normal leading-[141%] text-[rgba(86,86,86,0.78)]"
								>
									Call recording:
								</span>
								<audio controls class="h-9 w-full max-w-sm" src={recordingUrl} preload="metadata">
									Your browser does not support the audio element.
								</audio>
							</div>
						{/if}
						<div class="flex items-start gap-4">
							<span
								class="flex-shrink-0 whitespace-nowrap font-sans text-[15px] font-normal leading-[141%] text-[rgba(86,86,86,0.78)]"
							>
								Subject Line:
							</span>
							<span
								class="min-w-0 break-words font-sans text-[15px] font-medium leading-[141%] text-[rgba(86,86,86,0.78)]"
							>
								{subject}
							</span>
						</div>
						{#if body}
							<div class="flex items-start gap-4">
								<span
									class="flex-shrink-0 whitespace-nowrap font-sans text-[15px] font-normal leading-[141%] text-[rgba(86,86,86,0.78)]"
								>
									Body:
								</span>
								<span
									class="min-w-0 break-words font-sans text-[15px] font-normal leading-[141%] text-[rgba(86,86,86,0.78)]"
								>
									{body}
								</span>
							</div>
						{/if}
						{#if draftedMessage}
							<div class="flex items-start gap-4">
								<span
									class="flex-shrink-0 whitespace-nowrap font-sans text-[15px] font-medium leading-[141%] text-blue-600"
								>
									Drafted Reply:
								</span>
								<span
									class="min-w-0 break-words font-sans text-[15px] font-normal italic leading-[141%] text-gray-700 bg-blue-50/50 p-2 rounded w-full border border-blue-100"
								>
									{draftedMessage}
								</span>
							</div>
						{/if}
					</div>

					<!-- Summary Text -->
					<div class="flex flex-col gap-1">
						<span class="font-sans text-[15px] font-medium leading-[141%] text-[#797979]">
							Summary
						</span>
						<p
							class="whitespace-pre-wrap break-words font-sans text-xs font-normal leading-[141%] text-[rgba(86,86,86,0.78)]"
						>
							{summary}
						</p>
					</div>

					<!-- Separator Line -->
					<div class="my-1 h-px w-full bg-[#979797]"></div>

					<!-- Tasks to Complete -->
					<div class="flex flex-col gap-2">
						<span class="font-sans text-[15px] font-semibold leading-[141%] text-[#797979]">
							Tasks to complete
						</span>
						<ul class="flex list-inside list-disc flex-col gap-1">
							{#each tasks as task}
								<li class="font-sans text-xs font-normal leading-[141%] text-[#7B7B7B]">
									{task}
								</li>
							{/each}
						</ul>
					</div>
				</div>
			</div>

			<!-- Footer: Close Button -->
			<div class="mt-4 flex flex-shrink-0 justify-end">
				<Dialog.Close>
					<button
						class="flex h-[33px] w-[85px] items-center justify-center rounded bg-[#577AB7] font-sans text-lg font-medium leading-[141%] text-white transition-colors hover:bg-[#577AB7]/90"
					>
						Close
					</button>
				</Dialog.Close>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
