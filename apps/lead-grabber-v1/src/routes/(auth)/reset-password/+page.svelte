<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import Spinner from '$lib/components/ui/spinner.svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';

	let loading = $state(false);
	let newPassword = $state('');
	let confirmPassword = $state('');

	const token = page.url.searchParams.get('token');
	const id = page.url.searchParams.get('id');

	async function handleSubmit() {
		if (!token || !id) {
			toast.error('Invalid or missing reset token');
			return;
		}
		if (newPassword.length < 8) {
			toast.error('Password must be at least 8 characters');
			return;
		}
		if (newPassword !== confirmPassword) {
			toast.error('Passwords do not match');
			return;
		}

		loading = true;
		try {
			const res = await fetch('/api/auth/reset-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token, id, newPassword })
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error ?? 'Failed to reset password');
				return;
			}
			toast.success('Password reset successfully');
			goto('/login');
		} catch {
			toast.error('Something went wrong');
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
	<div class="flex w-full max-w-[1000px] gap-6 bg-dialog">
		<div class="hidden flex-1 lg:block">
			<img
				src="/img/login.png"
				alt="Person working on laptop"
				class="h-full w-full rounded-lg object-cover"
				loading="lazy"
			/>
		</div>

		<div class="flex w-full flex-col justify-center lg:w-[460px]">
			<div class="mx-auto">
				<img src="/img/logo.png" alt="ClearSky Software" class="h-[88px] w-[189px]" />
			</div>

			<div class="w-full rounded-lg bg-white p-8 lg:w-[460px]">
				<div class="mb-8 flex items-center justify-between">
					<h2 class="text-2xl font-semibold text-gray-900">Set New Password</h2>
				</div>

				{#if !token || !id}
					<div class="space-y-6">
						<p class="text-sm text-red-600">
							Invalid or expired reset link. Please request a new one.
						</p>
						<div class="pt-4">
							<a href="/forgot-password" class="text-primary hover:underline">Request Reset Link</a>
						</div>
					</div>
				{:else}
					<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-6">
						<p class="text-sm text-gray-600">
							Enter your new password below.
						</p>
						<div>
							<input
								bind:value={newPassword}
								type="password"
								placeholder="New Password"
								required
								class="w-full rounded-lg border-transparent bg-gray-100 px-4 py-3 focus:border-primary/60 focus:bg-white focus:ring-0"
							/>
						</div>
						<div>
							<input
								bind:value={confirmPassword}
								type="password"
								placeholder="Confirm New Password"
								required
								class="w-full rounded-lg border-transparent bg-gray-100 px-4 py-3 focus:border-primary/60 focus:bg-white focus:ring-0"
							/>
						</div>
						<Button
							type="submit"
							disabled={loading}
							class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-white hover:bg-primary/80"
						>
							{#if loading}
								<Spinner />
								Resetting...
							{:else}
								Reset Password
							{/if}
						</Button>
					</form>
				{/if}
			</div>
		</div>
	</div>
</div>
