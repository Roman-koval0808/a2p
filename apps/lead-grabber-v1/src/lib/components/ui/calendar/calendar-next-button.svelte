<script lang="ts">
	import { Calendar as CalendarPrimitive } from "bits-ui";
	import ChevronRight from "lucide-svelte/icons/chevron-right";
	import { buttonVariants } from "$lib/components/ui/button/index.js";
	import { cn } from "$lib/utils";

	interface Props {
		class?: string;
		children?: import('svelte').Snippet;
		[key: string]: any
	}

	let {
		class: className = undefined,
		children,
		...rest
	}: Props = $props();
</script>

<CalendarPrimitive.NextButton
	class={cn(
		buttonVariants({ variant: "outline" }),
		"h-8 w-8 rounded-full bg-primary/20 p-0 ",
		className
	)}
	{...rest}
>
	{#snippet children()}
		{#if children}
			{@render children()}
		{:else}
			<ChevronRight class="h-4 w-4 text-primary" />
		{/if}
	{/snippet}
</CalendarPrimitive.NextButton>