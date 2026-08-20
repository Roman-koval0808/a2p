<script lang="ts">
	import { Calendar as CalendarPrimitive } from "bits-ui";
	import { cn } from "$lib/utils";

	interface Props {
		class?: string;
		children?: import('svelte').Snippet<[CalendarPrimitive.HeadingProps["children"]]>;
		[key: string]: any
	}

	let {
		class: className = undefined,
		children,
		...rest
	}: Props = $props();
</script>

<CalendarPrimitive.Heading
	class={cn("text-sm font-medium", className)}
	{...rest}
>
	{#snippet children({ headingValue })}
		{#if children}
			{@render children({ headingValue })}
		{:else}
			{headingValue}
		{/if}
	{/snippet}
</CalendarPrimitive.Heading>