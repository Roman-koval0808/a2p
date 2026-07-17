<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { Button } from '$lib/components/ui/button/index';
	import { Edit3 } from 'lucide-svelte';
	import ContactLayout from './contact-layout.svelte';

	type Contact = {
		id: string;
		name?: string | null;
		phone?: string | null;
		email?: string | null;
		company?: string | null;
		avatarUrl?: string | null;
	};

	let {
		contact,
		onUpdated
	}: { contact: Contact; onUpdated?: (contact: Contact) => void } = $props();

	let open = $state(false);
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger>
		<Button variant="ghost" size="icon" class="hover:bg-gray-100">
			<Edit3 class="h-4 w-4 text-blue-600" />
		</Button>
	</Dialog.Trigger>
	<ContactLayout
		{contact}
		onUpdated={(updated) => {
			open = false;
			onUpdated?.(updated);
		}}
	/>
</Dialog.Root>
