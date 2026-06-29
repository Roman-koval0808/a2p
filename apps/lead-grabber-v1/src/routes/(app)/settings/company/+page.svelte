<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index';
	import * as Card from '$lib/components/ui/card/index';
	import { Input } from '$lib/components/ui/input/index';
	import { Label } from '$lib/components/ui/label/index';
	import { Switch } from '$lib/components/ui/switch/index';
	import * as Tabs from '$lib/components/ui/tabs/index';
	import { toast } from 'svelte-sonner';
	import { Loader2, Users } from 'lucide-svelte';
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
		};
	}>();
	let company = data.company;
	let phoneNumbers = $state(company?.settings?.notifications?.phone_numbers || []);
	let form: any;
	let loading = $state(false);
	let previewUrl: string | null = $state(null);
								
	// Define roles
	const roles = [
		{ value: 'admin', label: 'Super Admin' },
		{ value: 'member', label: 'Representative' }
	];

	// Derived store for trigger content
	const roleTriggerContent = $derived(
		roles.find((role) => role.value === selectedRole)?.label ?? 'Select a role'
	);

	// Add this new derived store for invite role trigger content
	const inviteRoleTriggerContent = $derived(
		roles.find((role) => role.value === selectedInviteRole)?.label ?? 'Select a role'
	);

	// Derived store for edit member role trigger content
	
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

		// Update pendingInvites when data changes
	$effect(() => {
		if (data.pendingInvites) {
			pendingInvites = data.pendingInvites;
		}
	});

	onMount(() => {
		loadPendingInvites();
	});

						} catch (error) {
			console.error('Error updating member:', error);
			toast.error('Failed to update member');
		} finally {
			editMemberDialog = false;
		}
	}
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
