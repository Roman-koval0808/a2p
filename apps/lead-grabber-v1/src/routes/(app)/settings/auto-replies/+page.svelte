<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import { Switch } from '$lib/components/ui/switch/index';
	import { Edit, Clock } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { enhance } from '$app/forms';

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

	// Helper function to parse hours string and extract time components
	function parseHours(hours: string | null) {
		if (!hours) {
			return {
				startHour: 8,
				startMinute: 0,
				startPeriod: 'AM',
				endHour: 6,
				endMinute: 0,
				endPeriod: 'PM'
			};
		}
		const match = hours.match(/(\d+):(\d+)\s+(AM|PM)\s+-\s+(\d+):(\d+)\s+(AM|PM)/);
		if (match) {
			return {
				startHour: parseInt(match[1]),
				startMinute: parseInt(match[2]),
				startPeriod: match[3],
				endHour: parseInt(match[4]),
				endMinute: parseInt(match[5]),
				endPeriod: match[6]
			};
		}
		return {
			startHour: 8,
			startMinute: 0,
			startPeriod: 'AM',
			endHour: 6,
			endMinute: 0,
			endPeriod: 'PM'
		};
	}

	// Initialize business hours from saved data
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
				const parsed = parseHours(settings.hours);
				acc[day] = {
					isOpen: settings.isOpen ?? false,
					hours: settings.hours ?? null,
					showTimePicker: false,
					startHour: parsed.startHour,
					startMinute: parsed.startMinute,
					startPeriod: parsed.startPeriod,
					endHour: parsed.endHour,
					endMinute: parsed.endMinute,
					endPeriod: parsed.endPeriod
				};
				return acc;
			},
			{} as Record<string, any>
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
								<div class="relative flex items-center gap-2">
									{#if settings.hours}
										<span class="text-sm text-gray-600">{settings.hours}</span>
									{/if}
									<Button
										variant="ghost"
										class="p-1 hover:bg-transparent"
										onclick={() => (settings.showTimePicker = !settings.showTimePicker)}
										disabled={!textAutoReply}
									>
										<Clock class="h-4 w-4" />
									</Button>

									{#if settings.showTimePicker}
										<div
											class="absolute top-full z-10 mt-2 min-w-[300px] rounded-lg border bg-white p-4 shadow-lg"
										>
											<div class="flex gap-4">
												<!-- Start Time -->
												<div class="flex-1">
													<div class="mb-2 block text-sm font-medium">Start Time</div>
													<div class="flex items-center gap-1">
														<select
															class="rounded border p-1 text-sm"
															bind:value={settings.startHour}
														>
															{#each Array.from({ length: 12 }, (_, i) => i + 1) as hour}
																<option value={hour}>{hour}</option>
															{/each}
														</select>
														<span>:</span>
														<select
															class="w-16 rounded border p-1 text-sm"
															bind:value={settings.startMinute}
														>
															{#each Array.from({ length: 4 }, (_, i) => i * 15) as minute}
																<option value={minute}>{String(minute).padStart(2, '0')}</option>
															{/each}
														</select>
														<select
															class="ml-1 rounded border p-1 text-sm"
															bind:value={settings.startPeriod}
														>
															<option value="AM">AM</option>
															<option value="PM">PM</option>
														</select>
													</div>
												</div>

												<!-- End Time -->
												<div class="flex-1">
													<div class="mb-2 block text-sm font-medium">End Time</div>
													<div class="flex items-center gap-1">
														<select
															class="rounded border p-1 text-sm"
															bind:value={settings.endHour}
														>
															{#each Array.from({ length: 12 }, (_, i) => i + 1) as hour}
																<option value={hour}>{hour}</option>
															{/each}
														</select>
														<span>:</span>
														<select
															class="w-16 rounded border p-1 text-sm"
															bind:value={settings.endMinute}
														>
															{#each Array.from({ length: 4 }, (_, i) => i * 15) as minute}
																<option value={minute}>{String(minute).padStart(2, '0')}</option>
															{/each}
														</select>
														<select
															class="ml-1 rounded border p-1 text-sm"
															bind:value={settings.endPeriod}
														>
															<option value="AM">AM</option>
															<option value="PM">PM</option>
														</select>
													</div>
												</div>
											</div>

											<Button
												class="mt-4 w-full"
												onclick={() => {
													settings.hours = `${settings.startHour}:${String(settings.startMinute).padStart(2, '0')} ${settings.startPeriod} - ${settings.endHour}:${String(settings.endMinute).padStart(2, '0')} ${settings.endPeriod}`;
													settings.showTimePicker = false;
												}}
											>
												Apply
											</Button>
										</div>
									{/if}
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
									hours: settings.hours
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
