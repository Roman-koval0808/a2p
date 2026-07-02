<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index';
	import * as Card from '$lib/components/ui/card/index';
	import { Input } from '$lib/components/ui/input/index';
	import { Label } from '$lib/components/ui/label/index';
	import { Switch } from '$lib/components/ui/switch/index';
	import * as Tabs from '$lib/components/ui/tabs/index';
	import { toast } from 'svelte-sonner';
	import { Loader2, Users, Calendar } from 'lucide-svelte';
	import { onDestroy, onMount } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index';
	import * as Select from '$lib/components/ui/select/index.js';
	import RoleBadge from '$lib/components/RoleBadge.svelte';
	import { formatDate } from '$lib/utils/date';
	import { goto } from '$app/navigation';

	interface CompanyMember {
		id: string;
		name: string;
		email: string;
		role: string;
	}

	interface Company {
		id: string;
		name: string;
		website?: string;
		logo?: string;
		owner: string;
		members: CompanyMember[];
		settings: {
			branding: {
				primary_color: string;
			};
			notifications: {
				email: boolean;
				web: boolean;
				sms: boolean;
				phone_numbers: string[];
			};
		};
	}

	interface Member {
		id: string;
		user: {
			id: string;
			name: string;
			email: string;
			avatar?: string;
		};
		role: 'owner' | 'admin' | 'member';
		joined_at: string;
	}

	let { data } = $props<{
		data: {
			company: Company | null;
			members: Member[];
			pendingInvites?: Array<{
				id: string;
				email: string | null;
				role: string | null;
				status: string;
				created: string;
			}>;
			userRole?: string;
			isAdminOrOwner?: boolean;
			googleCalendar?: { connected: boolean; email: string | null };
			googleConfigured?: boolean;
		};
	}>();
	let company = data.company;
	let phoneNumbers = $state(company?.settings?.notifications?.phone_numbers || []);
	let form: any;
	let loading = $state(false);
	let previewUrl: string | null = $state(null);

	// Toast the result of the Google Calendar OAuth round-trip (?calendar=connected|error|disconnected).
	onMount(() => {
		const status = new URLSearchParams(window.location.search).get('calendar');
		if (status === 'connected') toast.success('Google Calendar connected!');
		else if (status === 'disconnected') toast.success('Google Calendar disconnected.');
		else if (status === 'missing_scope')
			toast.error(
				'Calendar permission was not granted. Please click Connect again and allow access to your calendar (leave all the permission boxes checked).',
				{ duration: 10000 }
			);
		else if (status === 'error') toast.error('Could not connect Google Calendar. Please try again.');
		if (status) {
			const u = new URL(window.location.href);
			u.searchParams.delete('calendar');
			history.replaceState(null, '', u.toString());
		}
	});

	async function disconnectCalendar() {
		try {
			await fetch('?/disconnectCalendar', { method: 'POST', body: new FormData() });
		} catch (e) {
			// ignore — we reload regardless
		}
		window.location.href = '/settings/company?calendar=disconnected';
	}
								
	$effect(() => {
		if (form?.success) {
			toast.success('Company settings updated successfully');
			loading = false;
		}
	});

	import { getFileUrl as getLogoUrl } from '$lib/utils/file-url';

	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];

		if (file) {
			// Clear previous preview
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl);
			}

			// Create new preview
			previewUrl = URL.createObjectURL(file);
		} else {
			previewUrl = null;
		}
	}

	onDestroy(() => {
		// Clean up preview URL when component is destroyed
		if (previewUrl) {
			URL.revokeObjectURL(previewUrl);
		}
	});
</script>

{#if !company}
	<div class="flex h-[90vh] items-center justify-center">
		<div class="text-center">
			<p class="text-gray-500">Loading company settings...</p>
		</div>
	</div>
{:else}
	<div class="flex h-[90vh] flex-col gap-3 bg-gray-100 p-4">
		<div class="flex items-center justify-between">
			<div class="h1 text-2xl font-semibold">Company Settings</div>
		</div>

		<div class="w-full flex-1 overflow-hidden rounded-xl bg-white p-6">
			<Tabs.Root
				value="customization"
				class="flex h-full flex-col"
			>
				<div class="mb-6 flex items-center gap-4">
					<h2 class="text-xl font-semibold text-primary">Company Profile</h2>
					<div class="flex gap-4 text-gray-500">
						<Tabs.List>
							{#if data.isAdminOrOwner}
								<Tabs.Trigger value="customization">Customization</Tabs.Trigger>
								<Tabs.Trigger value="danger" class="text-red-500 data-[state=active]:text-red-600">Danger</Tabs.Trigger>
							{/if}
						</Tabs.List>
					</div>
				</div>

				<p class="mb-8 text-gray-500">Manage your company profile</p>

				{#if data.isAdminOrOwner}
					<Tabs.Content value="customization" class="flex-1 overflow-y-auto">
						<form
							method="POST"
							action="?/updateCompany"
							use:enhance={() => {
								loading = true;
								return async ({ result }) => {
									if (result.type === 'success') {
										toast.success('Company settings updated successfully');
									} else if (result.type === 'failure') {
										toast.error(result.data?.error || 'Failed to update company');
									} else if (result.type === 'error') {
										toast.error(result.error || 'An error occurred');
									}
									loading = false;
								};
							}}
							class="space-y-6"
							enctype="multipart/form-data"
						>
							<input type="hidden" name="companyId" value={company.id} />
							<div class="space-y-4">
								<div class="space-y-2">
									<Label for="name">Company Name</Label>
									<Input id="name" name="name" value={company.name} required />
								</div>

								<div class="space-y-2">
									<Label for="website">Website</Label>
									<Input
										id="website"
										name="website"
										value={company.website || ''}
										type="url"
										placeholder="https://example.com"
									/>
								</div>

								<div class="space-y-2">
									<Label>Booking Calendar</Label>
									{#if data.googleCalendar?.connected}
										<div
											class="flex items-start justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-3"
										>
											<div class="flex items-start gap-2 text-sm">
												<Calendar class="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
												<div>
													<span class="font-medium text-green-800">Google Calendar connected</span>
													{#if data.googleCalendar.email}
														<span class="text-green-700"> · {data.googleCalendar.email}</span>
													{/if}
													<p class="mt-0.5 text-green-700">
														When the AI agrees an appointment time, it checks your availability and books
														it on your calendar (with a Google Meet link) automatically.
													</p>
												</div>
											</div>
											<button
												type="button"
												onclick={disconnectCalendar}
												class="shrink-0 text-sm font-medium text-red-600 hover:underline"
											>
												Disconnect
											</button>
										</div>
									{:else if data.googleConfigured}
										<a
											href="/api/google/calendar/connect"
											class="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
										>
											<Calendar class="h-4 w-4 text-blue-600" /> Connect Google Calendar
										</a>
										<p class="text-sm text-muted-foreground">
											Connect once — when the AI agrees an appointment time over text, it books it on
											your calendar automatically (with a Meet link). No booking page to manage.
										</p>
									{:else}
										<p class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
											Google Calendar isn't configured on the server yet. You can still use a booking
											link below.
										</p>
									{/if}
								</div>

								<div class="space-y-2">
									<Label for="bookingUrl">Booking Calendar Link (optional)</Label>
									<Input
										id="bookingUrl"
										name="bookingUrl"
										value={company.settings?.booking_url || ''}
										type="url"
										placeholder="https://calendar.google.com/calendar/appointments/..."
									/>
									<p class="text-sm text-muted-foreground">
										Alternative to connecting above: paste a Google Appointment Schedule (or Calendly)
										link and the AI will send it so customers can self-book. Used only when Google
										Calendar isn't connected.
									</p>
								</div>

								<div class="space-y-2">
									<Label for="primaryColor">Brand Color</Label>
									<div class="flex gap-2">
										<Input
											id="primaryColor"
											name="primaryColor"
											value={company.settings.branding.primary_color}
											type="color"
											class="w-20 p-1"
										/>
										<Input value={company.settings.branding.primary_color} readonly />
									</div>
								</div>

								<div class="space-y-2">
									<Label for="logo">Company Logo</Label>
									<div class="space-y-4">
										{#if previewUrl || company.logo}
											<div class="relative h-32 w-32 overflow-hidden rounded-lg border">
												<img
													src={previewUrl || getLogoUrl(company.logo)}
													alt="Company Logo"
													class="h-full w-full object-contain"
												/>
											</div>
										{/if}
										<input
											id="logo"
											name="logo"
											type="file"
											accept="image/*"
											onchange={handleFileSelect}
											class="block w-full text-sm text-gray-500
                                        file:mr-4 file:rounded-md file:border-0
                                        file:bg-primary file:px-4
                                        file:py-2 file:text-sm
                                        file:font-semibold file:text-white
                                        file:hover:bg-primary/90"
										/>
									</div>
								</div>

								<div class="space-y-4 pt-4">
									<h3 class="text-lg font-medium">Notifications</h3>

									<div class="flex items-center justify-between">
										<div class="space-y-0.5">
											<Label>Email Notifications</Label>
											<div class="text-sm text-muted-foreground">
												Receive email notifications for new leads
											</div>
										</div>
										<Switch
											name="emailNotifications"
											value="true"
											checked={company.settings.notifications.email}
										/>
									</div>

									<div class="flex items-center justify-between">
										<div class="space-y-0.5">
											<Label>Web Notifications</Label>
											<div class="text-sm text-muted-foreground">
												Receive browser notifications for new leads
											</div>
										</div>
										<Switch
											name="webNotifications"
											value="true"
											checked={company.settings.notifications.web}
										/>
									</div>

									<div class="flex items-center justify-between">
										<div class="space-y-0.5">
											<Label>SMS Notifications</Label>
											<div class="text-sm text-muted-foreground">
												Receive SMS alerts on configured phone numbers when owner notification is triggered
											</div>
										</div>
										<Switch
											name="smsNotifications"
											value="true"
											checked={company.settings.notifications.sms}
										/>
									</div>

									<div class="space-y-3">
										<Label>SMS Notification Numbers</Label>
										{#each phoneNumbers as number, i}
											<div class="flex items-center gap-2">
												<Input
													type="tel"
													name="notificationPhones"
													placeholder="+15551234567"
													bind:value={phoneNumbers[i]}
													class="flex-1"
												/>
												<Button
													type="button"
													variant="outline"
													class="text-red-500 border-red-200 hover:bg-red-50 hover:text-red-700"
													onclick={() => {
														phoneNumbers = phoneNumbers.filter((_, idx) => idx !== i);
													}}
												>
													Remove
												</Button>
											</div>
										{/each}
										<Button
											type="button"
											variant="outline"
											size="sm"
											class="text-primary border-primary/20 hover:bg-primary/5"
											onclick={() => {
												phoneNumbers = [...phoneNumbers, ''];
											}}
										>
											+ Add Phone Number
										</Button>
									</div>
								</div>
							</div>

							<div class="flex justify-start">
								<Button type="submit" class="bg-primary px-8 text-white" disabled={loading}>
									{#if loading}
										<Loader2 class="mr-2 h-4 w-4 animate-spin" />
										Saving Changes...
									{:else}
										Save Changes
									{/if}
								</Button>
							</div>
						</form>
					</Tabs.Content>
				{/if}

				<Tabs.Content value="danger">
					<div class="rounded-lg border border-red-200 bg-white p-6 shadow-sm">
						<div class="mb-4 space-y-1">
							<h3 class="text-lg font-medium text-red-600">Danger Zone</h3>
							<p class="text-sm text-gray-500">
								Destructive actions for your company data.
							</p>
						</div>

						<div class="flex items-center justify-between rounded-lg border border-red-100 p-4">
							<div class="space-y-0.5">
								<h4 class="font-medium text-gray-900">Wipe Test Data</h4>
								<p class="text-sm text-gray-500">
									Permanently delete all customer profiles and message threads across LeadGrabber and CDP.
								</p>
							</div>
							<Button
								variant="destructive"
								onclick={async () => {
									if (confirm('Are you absolutely sure you want to wipe all profiles and messages? This cannot be undone.')) {
										try {
											const res = await fetch('/api/company/wipe-data', { method: 'POST' });
											if (res.ok) {
												toast.success('All profiles and messages have been wiped successfully.');
												window.location.reload();
											} else {
												const err = await res.json();
												toast.error(err.error || 'Failed to wipe data');
											}
										} catch (e) {
											console.error(e);
											toast.error('Failed to wipe data');
										}
									}
								}}
							>
								Wipe All Data
							</Button>
						</div>
					</div>
				</Tabs.Content>

			</Tabs.Root>
		</div>
	</div>
{/if}
