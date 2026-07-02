<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { toEmbedUrl } from '$lib/utils/booking';
	import { Calendar, ExternalLink } from 'lucide-svelte';

	interface Props {
		open?: boolean;
		bookingUrl?: string | null;
		googleConnected?: boolean;
		googleEmail?: string | null;
	}
	let {
		open = $bindable(false),
		bookingUrl = null,
		googleConnected = false,
		googleEmail = null
	}: Props = $props();

	const embedUrl = $derived(toEmbedUrl(bookingUrl));
	// Embed the connected Google Calendar (only renders for a viewer signed in to that account).
	const googleEmbed = $derived(
		googleConnected && googleEmail
			? `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(googleEmail)}&mode=WEEK`
			: ''
	);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="!h-[660px] !w-[840px] max-w-[92vw] overflow-hidden rounded bg-white !p-0">
		<div class="flex items-center justify-between border-b px-4 py-3">
			<div class="flex items-center gap-2 font-semibold text-gray-900">
				<Calendar class="h-4 w-4 text-blue-600" /> Booking Calendar
			</div>
			{#if googleConnected}
				<a
					href="https://calendar.google.com/calendar/u/0/r"
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
				>
					Open Google Calendar <ExternalLink class="h-3.5 w-3.5" />
				</a>
			{:else if bookingUrl}
				<a
					href={bookingUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
				>
					Open in new tab <ExternalLink class="h-3.5 w-3.5" />
				</a>
			{/if}
		</div>

		{#if googleConnected}
			<div class="border-b bg-green-50 px-4 py-2 text-sm text-green-800">
				<span class="font-medium">Google Calendar connected</span>
				{#if googleEmail}<span class="text-green-700"> · {googleEmail}</span>{/if} — the AI books
				agreed appointment times here automatically.
			</div>
			<iframe src={googleEmbed} title="Google Calendar" class="h-[560px] w-full border-0"></iframe>
		{:else if embedUrl}
			<iframe src={embedUrl} title="Booking Calendar" class="h-[600px] w-full border-0"></iframe>
		{:else}
			<div class="flex h-[600px] flex-col items-center justify-center gap-3 p-8 text-center">
				<Calendar class="h-10 w-10 text-gray-300" />
				<p class="max-w-sm text-sm text-gray-600">
					No booking calendar is connected yet. Connect Google Calendar (the AI books
					appointments automatically) or add a booking link so customers can self-book.
				</p>
				<a
					href="/settings/company"
					class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
				>
					Set up in Company settings
				</a>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
