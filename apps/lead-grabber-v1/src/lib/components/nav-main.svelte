<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';
	import {
			Home,
		ChartColumnBig,
		Smartphone,
		BookOpen,
		Settings,
		ChevronDown,
		ChevronUp,
		SquareSlash,
		Reply,
		Building,
		Phone,
		LayoutDashboard,
		MessageCircle,
		ChartLineIcon,
		FileText,
		Bell,
		UserCircle,
		ShoppingCart,
		Headphones,
		UserCheck,
		MapPin,
		PhoneOff,
		Globe,
		Share2,
		Megaphone,
		Sparkles
	} from 'lucide-svelte';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index';
	import { slide } from 'svelte/transition';
	const { user } = $props();
	let isCompany = $state(user?.company && user?.company !== '');

	const adminItems = [
		{ title: 'Dashboard', url: '/clearsky-admin', icon: LayoutDashboard, href: '/clearsky-admin' },
		{
			title: 'Communication Logs',
			url: '/communication-log',
			icon: FileText,
			href: '/communication-log'
		},
		{ title: 'Profiles', url: '/profiles', icon: UserCircle, href: '/profiles' },
		{ title: 'Analytics', url: '/analytics', icon: ChartLineIcon, href: '/analytics' }
	];

	const tenantRepItems = [
		{ title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard, href: '/dashboard' },
		{
			title: 'Communication Logs',
			url: '/communication-log',
			icon: FileText,
			href: '/communication-log'
		},
		{ title: 'Important Notifications', url: '/notifications', icon: Bell, href: '/notifications' },
		{ title: 'Inbox', url: '/inbox', icon: Home, href: '/inbox' },
		{ title: 'Profiles', url: '/profiles', icon: UserCircle, href: '/profiles' },
		{ title: 'Dialer', url: '/dialer', icon: Phone, href: '/dialer' },
		{ title: 'AI Summaries', url: '/ai-summaries', icon: Sparkles, href: '/ai-summaries' },
		{ title: 'Blogs', url: '/blogs', icon: BookOpen, href: '/blogs' },
		{ title: 'Social Content', url: '/social', icon: Share2, href: '/social' },
		{ title: 'Website Management', url: '/website', icon: Globe, href: '/website' },
		{ title: 'Marketing Tools', url: '/marketing', icon: Megaphone, href: '/marketing' },
		{ title: 'Analytics', url: '/analytics', icon: ChartLineIcon, href: '/analytics' }
	];

	const tenantAdminItems = [
		{ title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard, href: '/dashboard' },
		{
			title: 'Communication Logs',
			url: '/communication-log',
			icon: FileText,
			href: '/communication-log'
		},
		{ title: 'Important Notifications', url: '/notifications', icon: Bell, href: '/notifications' },
		{ title: 'Inbox', url: '/inbox', icon: Home, href: '/inbox' },
		{ title: 'Profiles', url: '/profiles', icon: UserCircle, href: '/profiles' },
		{ title: 'Dialer', url: '/dialer', icon: Phone, href: '/dialer' },
		{ title: 'AI Summaries', url: '/ai-summaries', icon: Sparkles, href: '/ai-summaries' },
		{ title: 'Blogs', url: '/blogs', icon: BookOpen, href: '/blogs' },
		{ title: 'Social Content', url: '/social', icon: Share2, href: '/social' },
		{ title: 'Website Management', url: '/website', icon: Globe, href: '/website' },
		{ title: 'Marketing Tools', url: '/marketing', icon: Megaphone, href: '/marketing' },
		{
			title: 'Buy Number',
			url: '/buy-number',
			icon: ShoppingCart,
			href: '/buy-number',
			subItems: [
				{ title: 'Buy Numbers', url: '/buy-number', icon: ShoppingCart, href: '/buy-number' },
				{ title: 'Manage Numbers', url: '/manage-numbers', icon: ShoppingCart, href: '/manage-numbers' },
				{ title: 'Port Numbers', url: '/port-numbers', icon: ShoppingCart, href: '/port-numbers' }
			]
		},
		{ title: 'IVR', url: '/ivr', icon: Headphones, href: '/ivr' },
		{ title: 'Locations', url: '/locations', icon: MapPin, href: '/locations' },
		{ title: 'Analytics', url: '/analytics', icon: ChartLineIcon, href: '/analytics' },
		{
			title: 'Settings',
			url: '/settings',
			icon: Settings,
			href: '/settings',
			subItems: [
				{ title: 'Lead Box', url: '/leadbox', icon: Smartphone, href: '/leadbox' },
				{ title: 'Lead Form', url: '/leadform', icon: BookOpen, href: '/leadform' },
				{ title: 'Auto Replies', url: '/settings/auto-replies', icon: Reply, href: '/settings/auto-replies' },
				{ title: 'Shortcuts', url: '/settings/shortcuts', icon: SquareSlash, href: '/settings/shortcuts' },
				...(!isCompany ? [{ title: 'Create Company', url: '/create-company', icon: Building, href: '/create-company' }] : []),
				...(isCompany ? [{ title: 'Company Settings', url: '/settings/company', icon: Building, href: '/settings/company' }] : [])
			]
		}
	];

	let items = $derived.by(() => {
		const activeMembership = user?.teamMemberships?.find((m: any) => m.companyId === user?.companyId);
		const tenantRole = activeMembership?.role || 'member'; 
		const platformRole = user?.platformRole || 'TENANT_USER';

		if (platformRole === 'CLEARSKY_ADMIN') return adminItems;
		if (tenantRole === 'owner' || tenantRole === 'admin') return tenantAdminItems;
		return tenantRepItems;
	});

	const sidebar = useSidebar();
	let expandedItems = $state<Set<string>>(new Set());
</script>

<Sidebar.Group>
	<Sidebar.Menu>
		{#each items as mainItem (mainItem.title)}
			<Sidebar.MenuItem class="gap-4">
				<a
					href={mainItem.href}
					class="w-full"
					onclick={(e) => {
						if (mainItem.subItems) {
							// DO NOT preventDefault here so the link still navigates
							const newExpanded = new Set(expandedItems);
							if (newExpanded.has(mainItem.title)) {
								newExpanded.delete(mainItem.title);
							} else {
								newExpanded.add(mainItem.title);
							}
							expandedItems = newExpanded;
						}
					}}
				>
					<Sidebar.MenuButton
						class="font-medium text-white hover:bg-primary-300 hover:text-white {page.url
							.pathname === mainItem.href
							? 'bg-primary-300 text-white'
							: ''}"
						isActive={page.url.pathname === mainItem.href}
					>
						{#snippet tooltipContent()}
							{mainItem.title}
						{/snippet}
						<mainItem.icon class="h-5 w-5 flex-shrink-0" />
						<span class="flex-1 truncate text-left group-data-[collapsible=icon]:hidden">{mainItem.title}</span>
						{#if mainItem.subItems}
							<Button
								variant="ghost"
								class="ml-auto hover:bg-transparent hover:text-white group-data-[collapsible=icon]:hidden px-2"
								onclick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									const newExpanded = new Set(expandedItems);
									if (newExpanded.has(mainItem.title)) {
										newExpanded.delete(mainItem.title);
									} else {
										newExpanded.add(mainItem.title);
									}
									expandedItems = newExpanded;
								}}
							>
								{#if expandedItems.has(mainItem.title)}
									<ChevronUp class="h-5 w-5" />
								{:else}
									<ChevronDown class="h-5 w-5" />
								{/if}
							</Button>
						{/if}
					</Sidebar.MenuButton>
				</a>
			</Sidebar.MenuItem>

			{#if mainItem.subItems && expandedItems.has(mainItem.title)}
				<div transition:slide class="group-data-[collapsible=icon]:hidden">
					{#each mainItem.subItems as subItem}
						<Sidebar.MenuItem>
							<a href={subItem.href} class="w-full">
								<Sidebar.MenuButton
									class="pl-14 font-medium text-white hover:bg-primary-300 hover:text-white {page
										.url.pathname === subItem.href
										? 'bg-primary-300 text-white'
										: ''}"
									isActive={page.url.pathname === subItem.href}
								>
									<span>{subItem.title}</span>
								</Sidebar.MenuButton>
							</a>
						</Sidebar.MenuItem>
					{/each}
				</div>
			{/if}
		{/each}
	</Sidebar.Menu>
</Sidebar.Group>
