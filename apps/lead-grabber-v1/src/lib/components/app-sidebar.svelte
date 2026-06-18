<script lang="ts" module>
</script>

<script lang="ts">
	import NavMain from '$lib/components/nav-main.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { LogOut } from 'lucide-svelte';
	import { goto } from '$app/navigation';

	let { user, ref = $bindable(null), ...restProps } = $props();

	function handleLogout() {
		goto('/logout');
	}
</script>

<Sidebar.Root bind:ref collapsible="icon" {...restProps}>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton size="lg">
					{#snippet child({ props })}
						<img
							src="/icons/main-logo.svg"
							alt="Bits UI"
							class="mx-auto w-[160px] py-12 group-data-[collapsible=icon]:hidden"
						/>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>
	<Sidebar.Content>
		<NavMain {user} />
	</Sidebar.Content>
	<Sidebar.Footer>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton onclick={handleLogout} class="hover:bg-red-50 hover:text-red-700">
					{#snippet tooltipContent()}
						Logout
					{/snippet}
					<LogOut class="h-5 w-5" />
					<span class="group-data-[collapsible=icon]:hidden">Logout</span>
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
