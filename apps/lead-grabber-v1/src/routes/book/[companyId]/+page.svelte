<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index';
	import { Input } from '$lib/components/ui/input/index';
	import { Label } from '$lib/components/ui/label/index';
	import { Calendar, Clock, Check, ChevronLeft } from 'lucide-svelte';

	let { data, form } = $props();

	// Deep-linked time (?t=) pre-selects a slot and jumps to step 2; ?n= prefills the name.
	function findRequested() {
		if (!data.requestedTime) return null;
		for (const day of data.days) {
			const slot = day.slots.find((s: any) => s.value.slice(0, 16) === data.requestedTime);
			if (slot) return { value: slot.value, label: slot.label, day: day.label };
		}
		return null;
	}
	const preselected = findRequested();
	let selected = $state<{ value: string; label: string; day: string } | null>(preselected);
	let step = $state<1 | 2>(preselected ? 2 : 1);
	let submitting = $state(false);
	const requestedButUnavailable = !!data.requestedTime && data.connected && !preselected;

	function pick(dayLabel: string, slot: { value: string; label: string }) {
		selected = { value: slot.value, label: slot.label, day: dayLabel };
		step = 2;
	}
</script>

<svelte:head>
	<title>Book an appointment · {data.companyName}</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 px-4 py-10">
	<div class="mx-auto w-full max-w-lg">
		<!-- Header -->
		<div class="mb-6 flex items-center gap-3">
			<div class="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white">
				<Calendar class="h-5 w-5" />
			</div>
			<div>
				<h1 class="text-xl font-bold leading-tight text-gray-900">Book an appointment</h1>
				<p class="text-sm text-gray-500">with {data.companyName}</p>
			</div>
		</div>

		{#if form?.success}
			<div class="rounded-2xl border border-green-200 bg-white p-8 text-center shadow-sm">
				<div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
					<Check class="h-6 w-6 text-green-600" />
				</div>
				<h2 class="text-lg font-semibold text-gray-900">You're booked!</h2>
				<p class="mt-1 text-sm text-gray-600">
					It's on the calendar and you'll get a confirmation. You can cancel or reschedule from that
					invite anytime.
				</p>
				{#if form.meetLink}
					<a
						href={form.meetLink}
						class="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
					>
						Join the meeting
					</a>
				{/if}
			</div>
		{:else if !data.connected}
			<div class="rounded-2xl border bg-white p-6 text-center text-gray-600 shadow-sm">
				Online booking isn't available right now — please give us a call.
			</div>
		{:else if data.days.length === 0}
			<div class="rounded-2xl border bg-white p-6 text-center text-gray-600 shadow-sm">
				No open times in the next two weeks — please reach out and we'll find a time that works.
			</div>
		{:else}
			<!-- Stepper -->
			<div class="mb-4 flex items-center gap-2 text-sm font-medium">
				<span
					class="flex items-center gap-1.5 rounded-full px-3 py-1 {step === 1
						? 'bg-blue-600 text-white'
						: 'bg-blue-50 text-blue-700'}"
				>
					<Clock class="h-3.5 w-3.5" /> 1. Time
				</span>
				<span class="h-px w-4 bg-gray-300"></span>
				<span
					class="flex items-center gap-1.5 rounded-full px-3 py-1 {step === 2
						? 'bg-blue-600 text-white'
						: 'bg-gray-100 text-gray-500'}"
				>
					<Check class="h-3.5 w-3.5" /> 2. Details
				</span>
			</div>

			{#if step === 1}
				<!-- STAGE 1: pick a time -->
				{#if requestedButUnavailable}
					<div class="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
						The exact time you asked for isn't open — please pick another below.
					</div>
				{/if}
				<div class="grid gap-3">
					{#each data.days as day}
						<div class="rounded-2xl border bg-white p-4 shadow-sm">
							<h3 class="mb-3 text-sm font-semibold text-gray-900">{day.label}</h3>
							<div class="flex flex-wrap gap-2">
								{#each day.slots as slot}
									<button
										type="button"
										class="rounded-lg border px-3 py-1.5 text-sm font-medium transition {selected?.value ===
										slot.value
											? 'border-blue-600 bg-blue-600 text-white'
											: 'border-gray-300 text-gray-700 hover:border-blue-400 hover:bg-blue-50'}"
										onclick={() => pick(day.label, slot)}
									>
										{slot.label}
									</button>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{:else if selected}
				<!-- STAGE 2: details -->
				<div class="rounded-2xl border bg-white p-5 shadow-sm">
					<button
						type="button"
						class="mb-4 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
						onclick={() => (step = 1)}
					>
						<ChevronLeft class="h-4 w-4" /> Change time
					</button>

					<div class="mb-4 flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900">
						<Calendar class="h-4 w-4 shrink-0 text-blue-600" />
						<span class="font-medium">{selected.day} at {selected.label}</span>
					</div>

					<form
						method="POST"
						action="?/book"
						use:enhance={() => {
							submitting = true;
							return async ({ update }) => {
								await update();
								submitting = false;
							};
						}}
					>
						<input type="hidden" name="slot" value={selected.value} />
						<div class="grid gap-4">
							<div class="grid gap-1.5">
								<Label for="name">Your name</Label>
								<Input id="name" name="name" required value={data.requestedName || ''} placeholder="Full name" />
							</div>
							<div class="grid gap-1.5">
								<Label for="email">Email <span class="text-gray-400">(optional)</span></Label>
								<Input id="email" name="email" type="email" placeholder="you@example.com" />
							</div>
							<div class="grid gap-1.5">
								<Label for="phone">Phone <span class="text-gray-400">(optional)</span></Label>
								<Input
									id="phone"
									name="phone"
									type="tel"
									value={data.requestedPhone || ''}
									placeholder="(555) 555-5555"
								/>
							</div>
						</div>

						{#if form?.error}
							<p class="mt-3 text-sm text-red-600">{form.error}</p>
						{/if}

						<Button type="submit" disabled={submitting} class="mt-5 w-full bg-blue-600 hover:bg-blue-700">
							{submitting ? 'Booking…' : 'Confirm booking'}
						</Button>
					</form>
				</div>
			{/if}
		{/if}

		<p class="mt-6 text-center text-xs text-gray-400">Powered by {data.companyName}</p>
	</div>
</div>
