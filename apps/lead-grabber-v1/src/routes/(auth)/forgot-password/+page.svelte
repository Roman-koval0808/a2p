<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import Spinner from '$lib/components/ui/spinner.svelte';
	import { toast } from 'svelte-sonner';

	let loading = $state(false);
	let email = $state('');
	let submitted = $state(false);

	async function handleSubmit() {
		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			toast.error('Enter a valid email address');
			return;
		}
		loading = true;
		try {
			const res = await fetch('/api/auth/forgot-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email })
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error ?? 'Failed to send reset link');
				return;
			}
			submitted = true;
			toast.success('Check your email for the reset link');
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
					<h2 class="text-2xl font-semibold text-gray-900">Forgot Password</h2>
				</div>

				{#if submitted}
					<div class="space-y-6">
						<p class="text-sm text-gray-600">
							We sent a password reset link to <strong>{email}</strong>.
							Please check your email and follow the instructions to reset your password.
						</p>
						<div class="pt-4">
							<a href="/login" class="text-primary hover:underline">Back to Login</a>
						</div>
					</div>
				{:else}
					<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-6">
						<p class="text-sm text-gray-600">
							Enter your email address and we'll send you a link to reset your password.
						</p>
						<div>
							<input
								bind:value={email}
								type="email"
								placeholder="Email"
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
								Sending Link...
							{:else}
								Send Reset Link
							{/if}
						</Button>
						<div class="text-center">
							<a href="/login" class="text-sm text-gray-500 hover:text-gray-700">
								Wait, I remember my password
							</a>
						</div>
					</form>
				{/if}
			</div>
		</div>
	</div>
</div>
