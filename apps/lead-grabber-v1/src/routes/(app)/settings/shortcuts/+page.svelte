<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import { ArrowRight, Edit } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	let teamShortcuts = [{ id: 1, trigger: '23', message: 'Test 1234123123123213' }];

	let personalShortcuts = $state([]);

	function addPersonalShortcut() {
		personalShortcuts = [...personalShortcuts, { id: Date.now(), trigger: '', message: '' }];
	}
</script>

<div class="bg-gray-50 p-6">
	<h1 class="mb-6 text-2xl font-semibold">Shortcuts</h1>

	<!-- Team Shortcuts -->
	<div class="mb-8">
		<h2 class="mb-2 text-xl font-semibold text-primary">Team shortcuts</h2>
		<p class="mb-4 text-gray-500">
			Share team shortcuts to all your team members accessing this profile.
		</p>

		<div class="max-w-[600px] border-t">
			<div class="flex items-center justify-between py-4">
				<h3 class="text-lg font-semibold">Shortcut</h3>
				<p class="text-sm font-medium">
					Message <span class="opacity-70">(255 character limit per shortcut)</span>
				</p>
			</div>
			{#each teamShortcuts as shortcut}
				<div class="flex items-center justify-between py-4">
					<div class="flex items-center gap-4">
						<div class="flex items-center gap-3 font-medium">
							<div class=" flex h-8 w-7 items-center justify-center bg-slate-200 font-bold">/</div>
							{shortcut.trigger}
						</div>
					</div>
					<div class="flex items-center gap-4">
						<ArrowRight class="h-4 w-4 text-red-500" />
						<span class="text-gray-700">{shortcut.message}</span>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Personal Shortcuts -->
	<div>
		<h2 class="mb-2 text-xl font-semibold text-primary">Personal shortcuts</h2>
		<p class="mb-4 text-gray-500">Create and personalize shortcuts to use across all profiles.</p>

		<div class="max-w-[600px] border-t">
			<div class="flex items-center justify-between py-4">
				<h3 class="text-lg font-semibold">Personal Shortcut</h3>
				<p class="text-sm font-medium">
					Message <span class="opacity-70">(255 character limit per shortcut)</span>
				</p>
			</div>
			{#each personalShortcuts as shortcut}
				<div class="flex items-center justify-between py-4">
					<div class="flex items-center gap-4">
						<span class="font-medium">/{shortcut.trigger}</span>
						<Edit class="text-red-500" />
					</div>
					<span class="text-gray-700">{shortcut.message}</span>
				</div>
			{/each}

			{#if personalShortcuts.length === 0}
				<div class="py-4">
					<a href="#" class="text-primary hover:underline" onclick={addPersonalShortcut}>
						Add your first personal shortcut
					</a>
				</div>
			{/if}
		</div>
	</div>
</div>
