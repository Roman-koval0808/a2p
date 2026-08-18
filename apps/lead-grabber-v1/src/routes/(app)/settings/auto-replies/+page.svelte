<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import { Switch } from '$lib/components/ui/switch/index';
	import { Edit } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { enhance } from '$app/forms';
	import TimePicker from '$lib/components/TimePicker.svelte';
	import { parseRange12, formatRange12 } from '$lib/utils/time';

	let { data } = $props();

	// Initialize state from saved data or defaults
	let textAutoReply = $state(data?.autoReply?.textAutoReply ?? false);
	let businessHoursMessage = $state(
		data?.autoReply?.businessHoursMessage ??
			'Hello, thank you for messaging us. Our team will respond shortly.'
	);
	let afterHoursMessage = $state(
		data?.autoReply?.afterHoursMessage ??
			'Hello, we are not available at the moment, but we will get in touch with you by {date}.'
	);
	let leadformBusinessHoursMessage = $state(
		data?.autoReply?.leadformBusinessHoursMessage ??
			'Hello, thank you for submitting the form. Our team will respond shortly.'
	);
	let leadformAfterHoursMessage = $state(
		data?.autoReply?.leadformAfterHoursMessage ??
			'Hello, we are not available at the moment, but we will get in touch with you by {date}.'
	);

	let businessHoursTextarea: HTMLTextAreaElement;
	let afterHoursTextarea: HTMLTextAreaElement;
	let leadformBusinessHoursTextarea: HTMLTextAreaElement;
	let leadformAfterHoursTextarea: HTMLTextAreaElement;

	function focusTextarea(textarea: HTMLTextAreaElement) {
		if (textarea && !textarea.disabled) {
			textarea.focus();
			textarea.select();
		}
	}

	// Initialize business hours from saved data, storing each day's range as two 24h "HH:MM"
	// values ('' = closed / not set) that the TimePicker binds to.
	const savedBusinessHours = data?.autoReply?.businessHours || {};
	const defaultBusinessHours = {
		sunday: { isOpen: false, hours: null },
		monday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
		tuesday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
		wednesday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
		thursday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
		friday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
		saturday: { isOpen: false, hours: null }
	};

	let businessHours = $state(
		Object.entries({ ...defaultBusinessHours, ...savedBusinessHours }).reduce(
			(acc, [day, settings]: [string, any]) => {
				const range = parseRange12(settings.hours);
				acc[day] = {
					isOpen: settings.isOpen ?? false,
					start: range?.start ?? '',
					end: range?.end ?? ''
				};
				return acc;
			},
			{} as Record<string, { isOpen: boolean; start: string; end: string }>
		)
	);
</script>

<div class="flex h-[90vh] flex-col gap-3 bg-gray-100 p-4">
	<div class="h1 text-2xl font-semibold">Auto Replies</div>

	<div class="flex flex-1 gap-5 overflow-hidden">
		<!-- Left Section -->
		<div class="w-1/2 overflow-y-auto rounded-xl bg-white p-6">
			<div class="mb-8">
				<h2 class="mb-2 flex items-center gap-2 text-xl font-semibold text-primary">
					Text Auto Reply
				</h2>
				<p class="mb-4 text-sm text-gray-500">Schedule and edit auto replies</p>

				<div class="mb-6 flex items-center gap-4">
					<span class="text-gray-700">Auto Reply:</span>
					<span>Off</span>
					<Switch checked={textAutoReply} onCheckedChange={(v) => (textAutoReply = v)} />
					<span class="text-primary">On</span>
				</div>
			</div>

			<div>
				<h2 class="mb-4 text-xl font-semibold text-primary">Set your business hours</h2>
				<div class="space-y-4">
				{#each Object.entries(businessHours) as [day, settings]}
					<div class="flex items-center gap-4">
						<span class="w-24 capitalize">{day}:</span>
						<Button
							variant="outline"
							class={`w-24 ${settings.isOpen ? 'text-primary' : ''}`}
							onclick={() => (settings.isOpen = !settings.isOpen)}
							disabled={!textAutoReply}
						>
							{settings.isOpen ? 'Open' : 'Closed'}
						</Button>
						{#if settings.isOpen}
							<div class="flex items-center gap-2">
								<TimePicker bind:value={settings.start} disabled={!textAutoReply} />
								<span class="text-gray-500">–</span>
								<TimePicker bind:value={settings.end} disabled={!textAutoReply} />
							</div>
						{/if}
					</div>
				{/each}
				</div>
			</div>

			<form
				method="POST"
				action="?/saveAutoReply"
				use:enhance={() => {
					return async ({ result }) => {
						if (result.type === 'success') {
							toast.success('Auto reply settings saved successfully!');
						} else {
							toast.error('Error saving auto reply settings');
						}
					};
				}}
			>
				<input
					type="hidden"
					name="autoReplyData"
					value={JSON.stringify({
						textAutoReply,
						businessHoursMessage,
						afterHoursMessage,
						leadformBusinessHoursMessage,
						leadformAfterHoursMessage,
					businessHours: Object.entries(businessHours).reduce(
						(acc, [day, settings]: [string, any]) => {
							acc[day] = {
								isOpen: settings.isOpen,
								hours: settings.start && settings.end ? formatRange12(settings.start, settings.end) : null
							};
							return acc;
						},
						{} as Record<string, { isOpen: boolean; hours: string | null }>
					)
					})}
				/>

				<div class="mt-8 flex justify-start">
					<Button type="submit" class="bg-primary px-8 text-white" disabled={!textAutoReply}>
						Save Changes
					</Button>
				</div>
			</form>
		</div>

		<!-- Right Section - Preview -->
		<div class="w-1/2 overflow-y-auto rounded-xl bg-white p-6">
			<h2 class="mb-6 text-xl font-semibold text-primary">Leadbox</h2>

			<div class="space-y-6">
				<div class="rounded-lg border p-4">
					<div class="mb-2 flex items-center justify-between">
						<h3 class="text-sm text-gray-600">Business hours auto reply message</h3>
						<Button
							variant="ghost"
							class="p-1 hover:bg-transparent"
							onclick={() => focusTextarea(businessHoursTextarea)}
							disabled={!textAutoReply}
						>
							<Edit class="h-4 w-4" />
						</Button>
					</div>
					<textarea
						bind:this={businessHoursTextarea}
						class="w-full rounded-md border bg-white p-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
						rows="2"
						bind:value={businessHoursMessage}
						disabled={!textAutoReply}
					></textarea>
				</div>

				<div class="rounded-lg border p-4">
					<div class="mb-2 flex items-center justify-between">
						<h3 class="text-sm text-gray-600">After hours auto reply message</h3>
						<Button
							variant="ghost"
							class="p-1 hover:bg-transparent"
							onclick={() => focusTextarea(afterHoursTextarea)}
							disabled={!textAutoReply}
						>
							<Edit class="h-4 w-4" />
						</Button>
					</div>
					<textarea
						bind:this={afterHoursTextarea}
						class="w-full rounded-md border bg-white p-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
						rows="3"
						bind:value={afterHoursMessage}
						disabled={!textAutoReply}
					></textarea>
					<p class="mt-1 text-xs text-gray-500">
						Tip: Use {'{date}'} to automatically insert the next business day (e.g., "we'll get in touch
						by {'{date}'}")
					</p>
				</div>
			</div>

			<h2 class="mb-6 mt-8 text-xl font-semibold text-primary">Leadform</h2>

			<div class="space-y-6">
				<div class="rounded-lg border p-4">
					<div class="mb-2 flex items-center justify-between">
						<h3 class="text-sm text-gray-600">Business hours auto reply message</h3>
						<Button
							variant="ghost"
							class="p-1 hover:bg-transparent"
							onclick={() => focusTextarea(leadformBusinessHoursTextarea)}
							disabled={!textAutoReply}
						>
							<Edit class="h-4 w-4" />
						</Button>
					</div>
					<textarea
						bind:this={leadformBusinessHoursTextarea}
						class="w-full rounded-md border bg-white p-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
						rows="2"
						bind:value={leadformBusinessHoursMessage}
						disabled={!textAutoReply}
					></textarea>
				</div>

				<div class="rounded-lg border p-4">
					<div class="mb-2 flex items-center justify-between">
						<h3 class="text-sm text-gray-600">After hours auto reply message</h3>
						<Button
							variant="ghost"
							class="p-1 hover:bg-transparent"
							onclick={() => focusTextarea(leadformAfterHoursTextarea)}
							disabled={!textAutoReply}
						>
							<Edit class="h-4 w-4" />
						</Button>
					</div>
					<textarea
						bind:this={leadformAfterHoursTextarea}
						class="w-full rounded-md border bg-white p-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
						rows="3"
						bind:value={leadformAfterHoursMessage}
						disabled={!textAutoReply}
					></textarea>
					<p class="mt-1 text-xs text-gray-500">
						Tip: Use {'{date}'} to automatically insert the next business day (e.g., "we'll get in touch
						by {'{date}'}")
					</p>
				</div>
			</div>
		</div>
	</div>
</div>
