<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index';
	import { Tag } from 'lucide-svelte';
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		<Button variant="ghost" class="hover:bg-transparent">
			<Tag class="text-3xl" size="33" />
		</Button>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content side="bottom" class="mr-60 w-[300px] rounded-lg bg-white p-3">
		<div class="relative">
			<input
				type="text"
				placeholder="Search tags..."
				class="w-full rounded-md border py-2 pl-8 pr-8 focus:outline-none focus:ring-2 focus:ring-foreground"
			/>
			<svg
				class="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2"
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
				/>
			</svg>
			<button class="absolute right-2 top-1/2 -translate-y-1/2 hover:text-gray-700"> ✕ </button>
		</div>
		<div class="mt-2">
			<div class="cursor-pointer rounded-md px-3 py-2 hover:bg-gray-100">Search Result 1</div>
			<div class="cursor-pointer rounded-md px-3 py-2 hover:bg-gray-100">Search Result 2</div>
		</div>
	</DropdownMenu.Content>
</DropdownMenu.Root>
