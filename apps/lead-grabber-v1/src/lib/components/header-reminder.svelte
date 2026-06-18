<script>
	import { Button } from '$lib/components/ui/button/index';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index';
	import { Bell } from 'lucide-svelte';
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		<Button variant="ghost" class="hover:bg-transparent">
			<Bell class="text-3xl" size="33" />
		</Button>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content>
		<DropdownMenu.Group>
			<DropdownMenu.Item>
				<div class="h-full w-full hover:text-white">1 Hour</div>
			</DropdownMenu.Item>
			<DropdownMenu.Item>
				<div class="h-full w-full hover:text-white">4 Hours</div>
			</DropdownMenu.Item>
			<DropdownMenu.Item>
				<div class="h-full w-full hover:text-white">24 Hours</div>
			</DropdownMenu.Item>
			<DropdownMenu.Item>
				<div class="h-full w-full hover:text-white">Custom</div>
			</DropdownMenu.Item>
		</DropdownMenu.Group>
	</DropdownMenu.Content>
</DropdownMenu.Root>
