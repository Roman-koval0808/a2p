<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let selected = $state<{ value: string; label: string; day: string } | null>(null);
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Book an appointment · {data.companyName}</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 px-4 py-10">
	<div class="mx-auto max-w-2xl">
		<h1 class="text-2xl font-bold text-gray-900">Book an appointment</h1>
		<p class="mb-6 text-gray-500">with {data.companyName}</p>

		{#if form?.success}
			<div class="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
				<h2 class="text-lg font-semibold text-green-800">You're booked! 🎉</h2>
				<p class="mt-1 text-green-700">
					It's on the calendar and you'll get a confirmation. You can cancel or reschedule from that
					invite anytime.
				</p>
				{#if form.meetLink}
					<p class="mt-3 text-sm">
						Meeting link:
						<a class="text-blue-600 underline" href={form.meetLink}>{form.meetLink}</a>
					</p>
				{/if}
			</div>
		{:else if !data.connected}
			<div class="rounded-xl border bg-white p-6 text-gray-600">
				Online booking isn't available right now — please give us a call.
			</div>
		{:else if data.days.length === 0}
			<div class="rounded-xl border bg-white p-6 text-gray-600">
				No open times in the next two weeks — please reach out and we'll find a time that works.
			</div>
		{:else}
			<div class="grid gap-4">
				{#each data.days as day}
					<div class="rounded-xl border bg-white p-4">
						<h3 class="mb-2 font-semibold text-gray-900">{day.label}</h3>
						<div class="flex flex-wrap gap-2">
							{#each day.slots as slot}
								<button
									type="button"
									class="rounded-lg border px-3 py-1.5 text-sm transition {selected?.value === slot.value
										? 'border-blue-600 bg-blue-600 text-white'
										: 'border-gray-300 hover:bg-gray-50'}"
									onclick={() => (selected = { value: slot.value, label: slot.label, day: day.label })}
								>
									{slot.label}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>

			{#if selected}
				<form
					method="POST"
					action="?/book"
					class="mt-6 rounded-xl border bg-white p-5 shadow-sm"
					use:enhance={() => {
						submitting = true;
						return async ({ update }) => {
							await update();
							submitting = false;
						};
					}}
				>
					<p class="mb-3 text-sm text-gray-700">
						Booking <span class="font-semibold">{selected.day} at {selected.label}</span>
					</p>
					<input type="hidden" name="slot" value={selected.value} />
					<div class="grid gap-3 sm:grid-cols-2">
						<input
							name="name"
							required
							placeholder="Your name"
							class="rounded-lg border px-3 py-2 text-sm"
						/>
						<input
							name="email"
							type="email"
							placeholder="Email (optional)"
							class="rounded-lg border px-3 py-2 text-sm"
						/>
						<input
							name="phone"
							type="tel"
							placeholder="Phone (optional)"
							class="rounded-lg border px-3 py-2 text-sm sm:col-span-2"
						/>
					</div>
					{#if form?.error}
						<p class="mt-2 text-sm text-red-600">{form.error}</p>
					{/if}
					<button
						type="submit"
						disabled={submitting}
						class="mt-4 w-full rounded-lg bg-blue-600 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
					>
						{submitting ? 'Booking…' : 'Confirm booking'}
					</button>
				</form>
			{/if}
		{/if}
	</div>
</div>
