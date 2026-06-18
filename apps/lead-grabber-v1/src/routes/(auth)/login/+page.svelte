<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import Spinner from '$lib/components/ui/spinner.svelte';
	import OtpInput from '$lib/components/ui/otp-input.svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';

	let loading = $state(false);
	let mode = $state<'password' | 'otp'>('password');
	let otpSent = $state(false);
	let otpEmail = $state('');
	let otpCode = $state('');

	async function sendOtp() {
		const emailEl = document.querySelector<HTMLInputElement>('input[name="email"]');
		const email = emailEl?.value?.trim();
		if (!email) {
			toast.error('Enter your email');
			return;
		}
		loading = true;
		try {
			const res = await fetch('/api/auth/otp/send', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, intent: 'login' })
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error ?? 'Failed to send code');
				return;
			}
			otpEmail = email;
			otpSent = true;
			toast.success('Check your email for the code');
		} catch {
			toast.error('Something went wrong');
		} finally {
			loading = false;
		}
	}

	async function verifyOtp() {
		if (otpCode.length !== 5) {
			toast.error('Enter the 5-digit code');
			return;
		}
		loading = true;
		try {
			const res = await fetch('/api/auth/otp/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: otpEmail, code: otpCode, intent: 'login' })
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error ?? 'Invalid or expired code');
				return;
			}
			toast.success('Login successful');
			goto(data.redirect ?? '/dashboard');
		} catch {
			toast.error('Something went wrong');
		} finally {
			loading = false;
		}
	}

	function handleEnhance() {
		return async ({ result }: { result: any }) => {
			loading = false;
			if (result.type === 'redirect') {
				toast.success('Login successful');
				await applyAction(result);
			} else {
				toast.error(result.data?.message ?? 'Invalid email or password');
			}
		};
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
					<h2 class="text-2xl font-semibold text-gray-900">Login</h2>
				</div>

				{#if otpSent}
					<div class="space-y-6">
						<p class="text-sm text-gray-600">
							We sent a 5-digit code to <strong>{otpEmail}</strong>
						</p>
						<OtpInput bind:value={otpCode} disabled={loading} onsubmit={verifyOtp} />
						<Button
							type="button"
							disabled={loading || otpCode.length !== 5}
							class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-white hover:bg-primary/80"
							onclick={verifyOtp}
						>
							{#if loading}
								<Spinner />
								Verifying...
							{:else}
								Verify and log in
							{/if}
						</Button>
						<button
							type="button"
							class="w-full text-sm text-gray-500 hover:text-gray-700"
							onclick={() => {
								otpSent = false;
								otpCode = '';
							}}
						>
							Use a different email
						</button>
					</div>
				{:else if mode === 'otp'}
					<div class="space-y-6">
						<div>
							<input
								name="email"
								type="email"
								placeholder="Email"
								required
								class="w-full rounded-lg border-transparent bg-gray-100 px-4 py-3 focus:border-primary/60 focus:bg-white focus:ring-0"
							/>
						</div>
						<Button
							type="button"
							disabled={loading}
							class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-white hover:bg-primary/80"
							onclick={sendOtp}
						>
							{#if loading}
								<Spinner />
								Sending code...
							{:else}
								Email me a code
							{/if}
						</Button>
						<button
							type="button"
							class="w-full text-sm text-gray-500 hover:text-gray-700"
							onclick={() => (mode = 'password')}
						>
							Log in with password instead
						</button>
					</div>
				{:else}
					<form
						method="POST"
						use:enhance={() => {
							const form = document.querySelector('form');
							if (form && !form.checkValidity()) {
								form.reportValidity();
								return;
							}
							loading = true;
							return handleEnhance();
						}}
						class="space-y-6"
					>
						<div>
							<input
								name="email"
								type="email"
								placeholder="Email"
								required
								class="w-full rounded-lg border-transparent bg-gray-100 px-4 py-3 focus:border-primary/60 focus:bg-white focus:ring-0"
							/>
						</div>
						<div>
							<input
								name="password"
								type="password"
								autocomplete="current-password"
								placeholder="Password"
								required
								class="w-full rounded-lg border-transparent bg-gray-100 px-4 py-3 focus:border-primary/60 focus:bg-white focus:ring-0"
							/>
							<div class="mt-2 text-right">
								<a href="/forgot-password" class="text-sm text-primary hover:underline">Forgot password?</a>
							</div>
						</div>
						<Button
							type="submit"
							disabled={loading}
							class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-white hover:bg-primary/80"
						>
							{#if loading}
								<Spinner />
								Logging in...
							{:else}
								Login
							{/if}
						</Button>
						<button
							type="button"
							class="w-full text-sm text-primary hover:underline"
							onclick={() => (mode = 'otp')}
						>
							Email me a code instead
						</button>
					</form>
				{/if}

				{#if !otpSent && mode === 'password'}
					<div class="relative mt-6">
						<div class="absolute inset-0 flex items-center">
							<div class="w-full border-t border-gray-300"></div>
						</div>
						<div class="relative flex justify-center text-sm">
							<span class="bg-white px-2 text-gray-500">Or login with</span>
						</div>
					</div>
					<button
						type="button"
						class="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-3 font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
					>
						Log in with Google
					</button>
				{/if}

				<p class="mt-6 text-center text-sm text-gray-600">
					Don't have an account?
					<a href="/signup" class="text-primary hover:underline">Sign up</a>
				</p>
			</div>
		</div>
	</div>
</div>
