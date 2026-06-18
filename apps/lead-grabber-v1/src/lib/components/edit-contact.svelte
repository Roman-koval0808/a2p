<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { Button } from '$lib/components/ui/button/index';
	import { Edit3 } from 'lucide-svelte';
	import ContactLayout from './contact-layout.svelte';
</script>

<Dialog.Root>
	<Dialog.Trigger>
		<Button variant="ghost" size="icon" class="hover:bg-gray-100">
			<Edit3 class="h-4 w-4 text-blue-600" />
		</Button>
	</Dialog.Trigger>
	<ContactLayout />
</Dialog.Root>
