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
	let showInviteDialog = $state(false);
	let showInviteLinkDialog = $state(false);
	let inviteLink = $state<string>('');
	let pendingInvites = $state(data.pendingInvites || []);
	let editMemberDialog = $state(false);
	let selectedMember = $state<Member | null>(null);
	let selectedRole = $state<string>('');
	let selectedInviteRole = $state('member');

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
	const editRoleTriggerContent = $derived(
		roles.find((role) => role.value === selectedRole)?.label ?? 'Select a role'
	);

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

	async function loadPendingInvites() {
		if (!company?.id) return;
		try {
			const response = await fetch(`/api/invites?companyId=${company.id}`);
			if (response.ok) {
				const data = await response.json();
				pendingInvites = data.invites || [];
			}
		} catch (err) {
			console.error('Error loading invites:', err);
			toast.error('Failed to load invites');
		}
	}

	// Update pendingInvites when data changes
	$effect(() => {
		if (data.pendingInvites) {
			pendingInvites = data.pendingInvites;
		}
	});

	onMount(() => {
		loadPendingInvites();
	});

	async function cancelInvite(inviteId: string) {
		try {
			const response = await fetch(`/api/invites/${inviteId}`, { method: 'DELETE' });
			if (response.ok) {
				toast.success('Invite cancelled');
				// Remove from local state
				pendingInvites = pendingInvites.filter((inv) => inv.id !== inviteId);
				// Also reload from server
				await loadPendingInvites();
			} else {
				const error = await response.json();
				toast.error(error.error || 'Failed to cancel invite');
			}
		} catch (err) {
			console.error('Error cancelling invite:', err);
			toast.error('Failed to cancel invite');
		}
	}

	async function resendInvite(inviteId: string) {
		try {
			const response = await fetch(`/api/invites/${inviteId}/resend`, { method: 'POST' });
			if (response.ok) {
				const data = await response.json();
				if (data.inviteLink) {
					inviteLink = data.inviteLink;
					showInviteLinkDialog = true;
					// Copy to clipboard
					try {
						await navigator.clipboard.writeText(data.inviteLink);
					} catch (err) {
						console.error('Failed to copy to clipboard:', err);
					}
				} else {
					toast.success('Invitation resent successfully');
				}
				await loadPendingInvites();
			} else {
				const error = await response.json();
				toast.error(error.error || 'Failed to resend invitation');
			}
		} catch (error) {
			console.error('Error resending invite:', error);
			toast.error('Failed to resend invitation');
		}
	}

	async function handleEditMember(member: Member) {
		selectedMember = member;
		selectedRole = member.role;
		editMemberDialog = true;
	}

	async function handleRoleUpdate() {
		if (!selectedMember || !selectedRole) return;

		try {
			const response = await fetch(`/api/company-members/${selectedMember.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role: selectedRole })
			});
			if (response.ok) {
				toast.success('Member role updated');
				// Refresh the page to show updated data
				window.location.reload();
			} else {
				toast.error('Failed to update member');
			}
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
				value={data.isAdminOrOwner ? 'customization' : 'members'}
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
							<Tabs.Trigger value="members">Team Members</Tabs.Trigger>
						</Tabs.List>
					</div>
				</div>

				<p class="mb-8 text-gray-500">Manage your company profile and team members</p>

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

				<Tabs.Content value="members" class="flex-1 overflow-y-auto">
					<div class="space-y-6">
						<div class="flex items-center justify-end">
							{#if data.isAdminOrOwner}
								<Button variant="outline" class="gap-2" onclick={() => (showInviteDialog = true)}>
									<Users class="h-4 w-4" />
									Invite Member
								</Button>
							{/if}
						</div>

						<div class="space-y-4">
							<h3 class="text-lg font-medium">Active Members</h3>
							<div class="rounded-lg bg-white shadow">
								<div class="p-6">
									<h2 class="mb-4 text-lg font-semibold">Active Members</h2>

									<div class="overflow-x-auto">
										<table class="min-w-full divide-y divide-gray-200">
											<thead>
												<tr>
													<th
														class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
													>
														Member
													</th>
													<th
														class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
													>
														Role
													</th>
													<th
														class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
													>
														Joined
													</th>
													<th
														class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
													>
														Actions
													</th>
												</tr>
											</thead>
											<tbody class="divide-y divide-gray-200 bg-white">
												{#each data.members as member}
													<tr>
														<td class="whitespace-nowrap px-6 py-4">
															<div class="flex items-center">
																<div class="h-10 w-10 flex-shrink-0">
																	{#if member.user?.avatar}
																		<img
																			class="h-10 w-10 rounded-full"
																			src={member.user.avatar}
																			alt=""
																		/>
																	{:else}
																		<div
																			class="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200"
																		>
																			<span class="font-medium text-gray-500">
																				{member.user?.name?.charAt(0).toUpperCase() ?? '?'}
																			</span>
																		</div>
																	{/if}
																</div>
																<div class="ml-4">
																	<button
																		class="text-left text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline"
																		onclick={(e) => {
																			e.stopPropagation();
																			goto(`/users/${member.user?.id}`);
																		}}
																	>
																		{member.user?.name ?? 'Unknown'}
																	</button>
																	<div class="text-sm text-gray-500">
																		{member.user?.email ?? 'No email'}
																	</div>
																</div>
															</div>
														</td>
														<td class="whitespace-nowrap px-6 py-4">
															<RoleBadge role={member.role} />
														</td>
														<td class="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
															{formatDate(member.joined_at)}
														</td>
														<td class="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
															{#if data.isAdminOrOwner}
																<button
																	class="text-indigo-600 hover:text-indigo-900"
																	onclick={() => handleEditMember(member)}
																>
																	Edit
																</button>
																{#if member.role !== 'owner' && member.user?.id !== data.user?.id}
																	<button
																		class="ml-4 text-red-600 hover:text-red-900"
																		onclick={async () => {
																			if (confirm('Are you sure you want to remove this member?')) {
																				try {
																					const res = await fetch(`/api/company-members/${member.id}`, {
																						method: 'DELETE'
																					});
																					if (res.ok) {
																						toast.success('Member removed successfully');
																						window.location.reload();
																					} else {
																						toast.error('Failed to remove member');
																					}
																				} catch (e) {
																					toast.error('Failed to remove member');
																				}
																			}
																		}}
																	>
																		Delete
																	</button>
																{/if}
															{/if}
														</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								</div>
							</div>
						</div>

						{#if pendingInvites.length > 0}
							<div class="space-y-4">
								<h3 class="text-lg font-medium">Invitations</h3>
								<div class="space-y-2">
									{#each pendingInvites as invite}
										<div class="flex items-center justify-between rounded-lg bg-gray-50 p-4">
											<div>
												<p class="font-medium">{invite.email || 'No email'}</p>
												<div class="flex items-center gap-2">
													<p class="text-sm text-gray-500">Role: {invite.role || 'member'}</p>
													<span
														class="rounded-full px-2 py-0.5 text-sm {invite.status === 'pending'
															? 'bg-yellow-100 text-yellow-800'
															: invite.status === 'accepted'
																? 'bg-green-100 text-green-800'
																: 'bg-red-100 text-red-800'}"
													>
														{invite.status}
													</span>
												</div>
											</div>
											{#if invite.status === 'pending'}
												<div class="flex items-center gap-2">
													<Button variant="ghost" size="sm" onclick={() => cancelInvite(invite.id)}>
														Cancel
													</Button>
													<Button variant="ghost" size="sm" onclick={() => resendInvite(invite.id)}>
														Resend
													</Button>
												</div>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</Tabs.Content>
			</Tabs.Root>
		</div>
	</div>

	<Dialog.Root bind:open={showInviteDialog}>
		<Dialog.Content class="sm:max-w-[425px]">
			<Dialog.Header>
				<Dialog.Title>Invite Team Member</Dialog.Title>
				<Dialog.Description>Invite a new member to join your team</Dialog.Description>
			</Dialog.Header>

			<form
				method="POST"
				action="?/inviteMember"
				use:enhance={() => {
					return async ({ result }) => {
						if (result.type === 'success') {
							const link = result.data?.inviteLink;
							if (link) {
								// Show dialog with invite link
								inviteLink = link;
								showInviteLinkDialog = true;
								// Also log to console (always)
								console.log(`Invite link: ${link}`);
								// Copy to clipboard automatically
								try {
									await navigator.clipboard.writeText(link);
								} catch (err) {
									console.error('Failed to copy to clipboard:', err);
								}
							} else {
								toast.success('Invitation sent successfully');
							}
							showInviteDialog = false;
							await loadPendingInvites();
						} else if (result.type === 'failure') {
							toast.error(result.data?.error || 'Failed to send invitation');
						}
					};
				}}
			>
				<input type="hidden" name="companyId" value={company.id} />
				<div class="grid gap-4 py-4">
					<div class="space-y-2">
						<Label for="email">Email Address</Label>
						<Input type="email" id="email" name="email" required placeholder="colleague@company.com" />
					</div>
					<div class="space-y-2">
						<Label>Role</Label>
						<Select.Root type="single" name="role" bind:value={selectedInviteRole}>
							<Select.Trigger class="w-full">
								{inviteRoleTriggerContent}
							</Select.Trigger>
							<Select.Content>
								<Select.Group>
									<Select.GroupHeading>Available Roles</Select.GroupHeading>
									{#each roles as role}
										<Select.Item value={role.value} label={role.label}>
											{role.label}
										</Select.Item>
									{/each}
								</Select.Group>
							</Select.Content>
						</Select.Root>
					</div>
				</div>

				<div class="flex justify-end gap-2">
					<Button type="button" variant="ghost" onclick={() => (showInviteDialog = false)}>
						Cancel
					</Button>
					<Button type="submit">Send Invitation</Button>
				</div>
			</form>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={editMemberDialog}>
		<Dialog.Content class="sm:max-w-[425px]">
			<Dialog.Header>
				<Dialog.Title>Edit Member Role</Dialog.Title>
				<Dialog.Description>
					Change the role for {selectedMember?.user?.name}
				</Dialog.Description>
			</Dialog.Header>

			<div class="grid gap-4 py-4">
				<div class="space-y-2">
					<Label>Role</Label>
					<Select.Root type="single" bind:value={selectedRole}>
						<Select.Trigger class="w-full">
							{editRoleTriggerContent}
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each roles as role}
									{#if selectedMember?.role === 'owner' || role.value !== 'owner'}
										<Select.Item value={role.value} label={role.label}>
											{role.label}
										</Select.Item>
									{/if}
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			<Dialog.Footer>
				<Button variant="outline" onclick={() => (editMemberDialog = false)}>Cancel</Button>
				<Button
					onclick={handleRoleUpdate}
					disabled={!selectedRole || selectedRole === selectedMember?.role}
				>
					Save Changes
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={showInviteLinkDialog}>
		<Dialog.Content class="sm:max-w-[500px]">
			<Dialog.Header>
				<Dialog.Title>Invitation Sent Successfully</Dialog.Title>
				<Dialog.Description>
					Share this link with the invited member. The link has been copied to your clipboard.
				</Dialog.Description>
			</Dialog.Header>

			<div class="grid gap-4 py-4">
				<div class="space-y-2">
					<Label>Invite Link</Label>
					<div class="flex gap-2">
						<Input value={inviteLink} readonly class="flex-1 font-mono text-sm" />
						<Button
							variant="outline"
							onclick={async () => {
								try {
									await navigator.clipboard.writeText(inviteLink);
									toast.success('Link copied to clipboard!');
								} catch (err) {
									toast.error('Failed to copy link');
								}
							}}
						>
							Copy
						</Button>
					</div>
				</div>
			</div>

			<Dialog.Footer>
				<Button onclick={() => (showInviteLinkDialog = false)}>Close</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
