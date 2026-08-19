<script lang="ts">
	import { Calendar as CalendarPrimitive } from "bits-ui";
	import { cn } from "$lib/utils";

	interface Props {
		date: CalendarPrimitive.CellProps["date"];
		month?: CalendarPrimitive.CellProps["month"];
		class?: string;
		children?: import('svelte').Snippet;
		[key: string]: any
	}

	let { date, month, class: className = undefined, children, ...rest }: Props = $props();
</script>

<CalendarPrimitive.Cell
	{date}
	{month}
	class={cn(
		"[&:has([data-selected])]:bg-accent [&:has([data-selected][data-outside-month])]:bg-accent/50 relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([data-selected])]:rounded-md",
		className
	)}
	{...rest}
>
	{@render children?.()}
</CalendarPrimitive.Cell>