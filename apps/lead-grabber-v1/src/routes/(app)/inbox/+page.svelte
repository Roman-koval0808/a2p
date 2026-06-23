<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { MessageSquareText, ArrowRight } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button/index';

	let { data } = $props();
	let { user } = data;

	if (user == null) {
		goto('/login');
	}
	if (
		(user !== null && user?.company === null) ||
		(user?.company && typeof user.company === 'object' && !user.company.id)
	) {
		goto('/create-company');
	}

	onMount(() => {
		// Auto-redirect threadId params to communication-log
		const urlParams = new URLSearchParams(window.location.search);
		const urlThreadId = urlParams.get('threadId');
		if (urlThreadId) {
			goto(`/communication-log`);
		}
	});
</script>

<div class="flex h-[90vh] flex-col items-center justify-center gap-6 bg-gray-100 p-4">
	<div class="flex flex-col items-center gap-4 rounded-xl bg-white p-12 shadow-sm">
		<MessageSquareText class="h-16 w-16 text-gray-300" />
		<h2 class="text-xl font-semibold text-gray-800">Inbox has moved</h2>
		<p class="max-w-sm text-center text-sm text-gray-500">
			Messaging and replies have been moved to the
			<strong>Communication Log</strong> for a unified view. You can reply to any SMS,
			call, or message directly from there.
		</p>
		<Button
			class="mt-2 bg-primary px-6 text-white hover:bg-blue-700"
			onclick={() => goto('/communication-log')}
		>
			Go to Communication Log
			<ArrowRight class="ml-2 h-4 w-4" />
		</Button>
	</div>
</div>
