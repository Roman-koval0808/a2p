<script lang="ts">
	import { enhance } from '$app/forms';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { invalidateAll } from '$app/navigation';
	import type { ActionResult } from '@sveltejs/kit';

	let loading = $state(false);

	function handleEnhance() {
		return async ({ result, update }: { result: ActionResult; update: () => Promise<void> }) => {
			loading = false;

			if (result.type === 'failure') {
				toast.error(result.data?.error || 'Failed to create company');
				return;
			}

			if (result.type === 'success') {
				toast.success('Company created successfully!');

				// Wait for invalidation to ensure data is updated
				await invalidateAll();

				// Navigate to home page after a short delay
				setTimeout(() => {
					goto('/settings/company');
				}, 500);

				return;
			}

			await update();
		};
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
	<div class="w-full max-w-md">
		<div class="rounded-lg bg-white p-8 shadow">
			<h2 class="mb-6 text-2xl font-semibold">Create Your Company</h2>
			<p class="mb-6 text-gray-600">Set up your company to start using leadforms and leadboxes.</p>

			<form method="POST" use:enhance={handleEnhance} class="space-y-6">
				<div>
					<label for="name" class="mb-1 block text-sm font-medium text-gray-700">Company Name</label
					>
					<Input
						id="name"
						name="name"
						type="text"
						required
						class="w-full"
						placeholder="Enter your company name"
					/>
				</div>

				<div>
					<label for="website" class="mb-1 block text-sm font-medium text-gray-700"
						>Website (optional)</label
					>
					<Input
						id="website"
						name="website"
						type="url"
						class="w-full"
						placeholder="https://example.com"
					/>
				</div>

				<Button type="submit" class="w-full" disabled={loading}>
					{loading ? 'Creating...' : 'Create Company'}
				</Button>
			</form>
		</div>
	</div>
</div>
