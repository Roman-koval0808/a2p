<script lang="ts">
	import { Calendar as CalendarPrimitive } from "bits-ui";
	import { buttonVariants } from "$lib/components/ui/button/index.js";
	import { cn } from "$lib/utils";

	interface Props {
		class?: string;
		children?: import('svelte').Snippet<[CalendarPrimitive.DayProps["children"]]>;
		[key: string]: any
	}

	let {
		class: className = undefined,
		children,
		...rest
	}: Props = $props();
</script>

<CalendarPrimitive.Day
	class={cn(
		buttonVariants({ variant: "ghost" }),
		"h-9 w-9 p-0 rounded-full text-primary font-bold bg-primary/20",
		"[&[data-today]:not([data-selected])]:bg-accent [&[data-today]:not([data-selected])]:text-accent-foreground",
		// Selected
		"data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[selected]:hover:bg-primary data-[selected]:hover:text-primary-foreground data-[selected]:focus:bg-primary data-[selected]:focus:text-primary-foreground data-[selected]:opacity-100",
		// Disabled
		"data-[disabled]:text-muted-foreground data-[disabled]:opacity-50",
		// Unavailable
		"data-[unavailable]:text-destructive-foreground data-[unavailable]:line-through",
		// Outside months
		"data-[outside-month]:text-muted-foreground [&[data-outside-month][data-selected]]:bg-accent/50 [&[data-outside-month][data-selected]]:text-muted-foreground data-[outside-month]:pointer-events-none data-[outside-month]:opacity-50 [&[data-outside-month][data-selected]]:opacity-30",
		className
	)}
	{...rest}
>
	{#snippet children({ selected, disabled, unavailable, day })}
		{#if children}
			{@render children({ selected, disabled, unavailable, day })}
		{:else}
			{day}
		{/if}
	{/snippet}
</CalendarPrimitive.Day>