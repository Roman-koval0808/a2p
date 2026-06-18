<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button/index';
	import * as Card from '$lib/components/ui/card/index';
	import { Input } from '$lib/components/ui/input/index';
	import { Label } from '$lib/components/ui/label/index';
	import { toast } from 'svelte-sonner';
	import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-svelte';
	import { authStore } from '$lib/stores/auth';

	let isOwner = $state(false);
	let loading = $state(true);
	let saving = $state(false);
	let avatarUploading = $state(false);

	let name = $state('');
	let email = $state('');
	let avatarUrl = $state('');
	let originalEmail = $state('');
	
	// Error states
	let errors = $state<{ name?: string; email?: string }>({});

	onMount(async () => {
		try {
			const res = await fetch('/api/me');
			if (!res.ok) {
				const errorData = await res.json().catch(() => ({}));
				throw new Error(errorData.error || errorData.message || `Server error: ${res.status}`);
			}
			
			const result = await res.json();
			if (result.success && result.data) {
				const user = result.data;
				isOwner = user.role === 'owner';
				name = user.name || '';
				email = user.email || '';
				originalEmail = user.email || '';
				avatarUrl = user.avatar || '';
			} else {
				throw new Error(result.error || result.message || 'Failed to load user profile');
			}
		} catch (err: any) {
			console.error('Failed to load user:', err);
			toast.error(err.message || 'Failed to load user profile');
		} finally {
			loading = false;
		}
	});

	function validate() {
		const newErrors: { name?: string; email?: string } = {};
		
		if (!name.trim()) {
			newErrors.name = 'Name is required';
		}
		
		if (!email.trim()) {
			newErrors.email = 'Email is required';
		} else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			newErrors.email = 'Invalid email format';
		}
		
		errors = newErrors;
		return Object.keys(newErrors).length === 0;
	}

	async function updateProfile() {
		if (!validate()) {
			toast.error('Please fix the errors in the form');
			return;
		}
		
		saving = true;
		try {
			const res = await fetch('/api/me', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name,
					email: email !== originalEmail ? email : undefined,
					avatar: avatarUrl
				})
			});
			
			const result = await res.json().catch(() => ({ success: false, error: 'Invalid server response' }));
			
			if (res.ok && result.success) {
				toast.success('Profile updated successfully');
				originalEmail = result.data.email;
				errors = {};
				
				// Update global auth store to trigger layout updates (real-time name/avatar)
				authStore.setUser(result.data);
			} else {
				const errorMsg = result.error || result.message || 'Failed to update profile';
				toast.error(errorMsg);
				
				// Map common server errors to field errors
				if (errorMsg.toLowerCase().includes('email')) {
					errors = { ...errors, email: errorMsg };
				}
			}
		} catch (err: any) {
			console.error('Update failed:', err);
			toast.error(err.message || 'An error occurred while updating the profile');
		} finally {
			saving = false;
		}
	}

	async function handleAvatarUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		// Client-side file size check (10MB limit)
		if (file.size > 10 * 1024 * 1024) {
			toast.error('File too large. Max size is 10MB.');
			input.value = '';
			return;
		}

		avatarUploading = true;
		const formData = new FormData();
		formData.append('avatar', file);

		try {
			const res = await fetch('/api/upload/avatar', {
				method: 'POST',
				body: formData
			});
			
			const result = await res.json().catch(() => ({ success: false, error: 'Invalid server response' }));
			
			if (res.ok && result.success && result.data?.url) {
				avatarUrl = result.data.url;
				toast.success('Avatar uploaded successfully');
				
				// Fetch latest user data to update layout
				const userRes = await fetch('/api/me');
				const userData = await userRes.json();
				if (userData.success) {
					authStore.setUser(userData.data);
				}
			} else {
				toast.error(result.error || result.message || 'Failed to upload avatar');
			}
		} catch (err: any) {
			console.error('Avatar upload failed:', err);
			toast.error(err.message || 'An error occurred while uploading avatar');
		} finally {
			avatarUploading = false;
			input.value = '';
		}
	}

	async function deleteAccount() {
		const warningMsg = isOwner 
			? 'WARNING: You are the company owner. Deleting your account will permanently delete your user, your company, and ALL associated data (contacts, logs, numbers, flows, etc.) for ALL users. This cannot be undone. Are you absolutely sure?'
			: 'Are you sure you want to delete your account? This action cannot be undone.';
			
		if (!confirm(warningMsg)) return;

		try {
			const res = await fetch('/api/account', {
				method: 'DELETE',
				headers: { Accept: 'application/json' }
			});
			
			const data = await res.json().catch(() => ({ success: false, message: 'Invalid server response' }));
			
			if (res.ok && data.success) {
				alert('Account deleted successfully. You will be logged out.');
				window.location.href = '/login';
			} else {
				toast.error(data.error || data.message || 'Account deletion failed.');
			}
		} catch (err: any) {
			console.error('Account deletion failed:', err);
			toast.error(err.message || 'An error occurred while deleting the account');
		}
	}
</script>

<div class="container mx-auto max-w-3xl py-10 space-y-8">
	<div class="flex flex-col gap-2">
		<h2 class="text-3xl font-bold tracking-tight">Manage Account</h2>
		<p class="text-muted-foreground">Update your personal profile and account settings.</p>
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center p-24 gap-4 bg-muted/20 rounded-xl border border-dashed">
			<Loader2 class="h-10 w-10 animate-spin text-primary" />
			<p class="text-sm text-muted-foreground font-medium">Loading your profile...</p>
		</div>
	{:else}
		<div class="grid gap-8">
			<Card.Root>
				<Card.Header>
					<Card.Title>Profile Information</Card.Title>
					<Card.Description>Manage your public-facing details and credentials.</Card.Description>
				</Card.Header>
				<Card.Content>
					<form onsubmit={(e) => { e.preventDefault(); updateProfile(); }} class="space-y-6">
						<!-- Avatar Section -->
						<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
							<div class="relative h-24 w-24 flex-shrink-0">
								<div class="h-24 w-24 overflow-hidden rounded-full border-2 border-background ring-2 ring-primary/10 bg-muted shadow-sm">
									{#if avatarUrl}
										<img
											src={avatarUrl.startsWith('http') || avatarUrl.startsWith('/') ? avatarUrl : `/${avatarUrl}`}
											alt="Avatar"
											class="h-full w-full object-cover transition-opacity hover:opacity-90"
										/>

									{:else}
										<div class="flex h-full w-full items-center justify-center text-muted-foreground bg-primary/5">
											<span class="text-3xl font-bold text-primary/40">
												{name ? name.charAt(0).toUpperCase() : '?'}
											</span>
										</div>
									{/if}
									{#if avatarUploading}
										<div class="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
											<Loader2 class="h-7 w-7 animate-spin text-primary" />
										</div>
									{/if}
								</div>
								{#if avatarUrl && !avatarUploading}
									<div class="absolute -bottom-1 -right-1 rounded-full bg-background p-1 shadow-sm">
										<CheckCircle2 class="h-5 w-5 text-green-500 fill-white" />
									</div>
								{/if}
							</div>
							
							<div class="flex flex-col gap-3">
								<div class="flex flex-col gap-1">
									<h4 class="text-sm font-medium">Profile Photo</h4>
									<p class="text-xs text-muted-foreground">Recommended: Square image, at least 400x400px. Max 10MB.</p>
								</div>
								<div class="flex gap-2">
									<Label
										for="avatar-upload"
										class="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
									>
										{avatarUrl ? 'Change Photo' : 'Upload Photo'}
									</Label>
									<input
										id="avatar-upload"
										type="file"
										accept="image/*"
										class="hidden"
										onchange={handleAvatarUpload}
										disabled={avatarUploading}
									/>
								</div>
							</div>
						</div>

						<div class="grid gap-6 sm:grid-cols-2">
							<!-- Name -->
							<div class="space-y-2">
								<Label for="name" class={errors.name ? "text-destructive" : ""}>Full Name</Label>
								<div class="relative">
									<Input 
										id="name" 
										bind:value={name} 
										placeholder="Your name" 
										class={errors.name ? "border-destructive focus-visible:ring-destructive" : ""}
									/>
									{#if errors.name}
										<AlertCircle class="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive" />
									{/if}
								</div>
								{#if errors.name}
									<p class="text-xs font-medium text-destructive">{errors.name}</p>
								{/if}
							</div>

							<!-- Email -->
							<div class="space-y-2">
								<Label for="email" class={errors.email ? "text-destructive" : ""}>Email Address</Label>
								<div class="relative">
									<Input 
										id="email" 
										type="email" 
										bind:value={email} 
										placeholder="your.email@example.com" 
										class={errors.email ? "border-destructive focus-visible:ring-destructive" : ""}
									/>
									{#if errors.email}
										<AlertCircle class="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive" />
									{/if}
								</div>
								{#if errors.email}
									<p class="text-xs font-medium text-destructive">{errors.email}</p>
								{/if}
							</div>
						</div>

						<div class="flex justify-end pt-4 border-t mt-6">
							<Button type="submit" disabled={saving || avatarUploading} class="min-w-[120px]">
								{#if saving}
									<Loader2 class="mr-2 h-4 w-4 animate-spin" />
									Saving...
								{:else}
									Save Changes
								{/if}
							</Button>
						</div>
					</form>
				</Card.Content>
			</Card.Root>

			<!-- Danger Zone Card -->
			<Card.Root class="border-destructive/20 bg-destructive/5 overflow-hidden">
				<div class="h-1 bg-destructive/40 w-full"></div>
				<Card.Header>
					<div class="flex items-center gap-2">
						<AlertCircle class="h-5 w-5 text-destructive" />
						<Card.Title class="text-destructive">Danger Zone</Card.Title>
					</div>
					<Card.Description class="text-destructive/80 font-medium">
						Irreversible actions that affect your entire account.
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4">
					<p class="text-sm text-destructive/70 leading-relaxed">
						Deleting your account will permanently remove all of your profile information, settings, and personal data. This action cannot be undone.
					</p>

					{#if isOwner}
						<div class="rounded-lg bg-destructive/10 p-4 border border-destructive/20 text-destructive text-sm leading-relaxed">
							<p class="font-bold flex items-center gap-2 mb-1">
								<span class="inline-block px-1.5 py-0.5 bg-destructive text-white rounded text-[10px] uppercase tracking-wider">Critical Warning</span>
							</p>
							You are the <strong>Company Owner</strong>. Deleting your account will <b>permanently delete your company</b> and all associated data for <b>ALL users</b>. This includes contacts, logs, phone numbers, and IVR flows.
						</div>
					{/if}

					<div class="pt-2">
						<Button variant="destructive" onclick={deleteAccount} class="font-semibold shadow-sm hover:bg-destructive/90">
							Delete Account
						</Button>
					</div>
				</Card.Content>
			</Card.Root>
		</div>
	{/if}
</div>
