<script lang="ts">
	import { Calendar as CalendarPrimitive } from "bits-ui";
	import * as Calendar from "./index.js";
	import { cn } from "$lib/utils";
	import { createEventDispatcher } from "svelte";
	import type { DateValue } from "@internationalized/date";

	interface Props {
		value?: DateValue;
		placeholder?: DateValue;
		weekdayFormat?: Intl.DateTimeFormatOptions["weekday"];
		class?: string;
		[key: string]: any
	}

	let {
		value = $bindable(undefined),
		placeholder = $bindable(undefined),
		weekdayFormat = "short",
		class: className = undefined,
		...rest
	}: Props = $props();

	const dispatch = createEventDispatcher();

	function handleValueChange(v: DateValue | undefined) {
		value = v;
		dispatch("change", v);
	}

	function handlePlaceholderChange(v: DateValue) {
		placeholder = v;
	}
</script>

<CalendarPrimitive.Root
	bind:value
	bind:placeholder
	{weekdayFormat}
	onValueChange={handleValueChange}
	onPlaceholderChange={handlePlaceholderChange}
	class={cn("p-3", className)}
	{...rest}
>
	{#snippet children({ months, weekdays })}
		<Calendar.Header>
			<Calendar.PrevButton />
			<Calendar.Heading />
			<Calendar.NextButton />
		</Calendar.Header>
		<Calendar.Months>
			{#each months as month}
				<Calendar.Grid>
					<Calendar.GridHead>
						<Calendar.GridRow class="flex">
							{#each weekdays as weekday}
								<Calendar.HeadCell>
									{weekday.slice(0, 2)}
								</Calendar.HeadCell>
							{/each}
						</Calendar.GridRow>
					</Calendar.GridHead>
					<Calendar.GridBody>
						{#each month.weeks as weekDates}
							<Calendar.GridRow class="mt-2 w-full">
								{#each weekDates as date}
									<Calendar.Cell {date} month={month.value}>
										<Calendar.Day />
									</Calendar.Cell>
								{/each}
							</Calendar.GridRow>
						{/each}
					</Calendar.GridBody>
				</Calendar.Grid>
			{/each}
		</Calendar.Months>
	{/snippet}
</CalendarPrimitive.Root>