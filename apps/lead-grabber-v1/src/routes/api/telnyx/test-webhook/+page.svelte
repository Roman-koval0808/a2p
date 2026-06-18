<script lang="ts">
	import { onMount } from 'svelte';

	let from = $state('+18005551234');
	let text = $state("Hello, I'm a test customer");
	let to = $state('+17059800835');
	let response = $state(null);
	let loading = $state(false);

	async function sendTestMessage() {
		loading = true;
		try {
			const res = await fetch(
				`/api/telnyx/test-webhook?from=${encodeURIComponent(from)}&text=${encodeURIComponent(text)}&to=${encodeURIComponent(to)}`
			);
			response = await res.json();
		} catch (err) {
			console.error('Error sending test message:', err);
			response = { success: false, error: err.message };
		} finally {
			loading = false;
		}
	}
</script>

<div class="container mx-auto max-w-2xl p-4">
	<h1 class="mb-6 text-2xl font-bold">Telnyx Webhook Tester</h1>

	<div class="mb-6 rounded-lg bg-white p-6 shadow-md">
		<div class="mb-4">
			<label class="mb-2 block font-medium text-gray-700" for="from"> From Phone Number </label>
			<input
				id="from"
				bind:value={from}
				class="focus:shadow-outline w-full appearance-none rounded border px-3 py-2 leading-tight text-gray-700 focus:outline-none"
				type="text"
			/>
		</div>

		<div class="mb-4">
			<label class="mb-2 block font-medium text-gray-700" for="to"> To Phone Number </label>
			<input
				id="to"
				bind:value={to}
				class="focus:shadow-outline w-full appearance-none rounded border px-3 py-2 leading-tight text-gray-700 focus:outline-none"
				type="text"
			/>
		</div>

		<div class="mb-6">
			<label class="mb-2 block font-medium text-gray-700" for="text"> Message Text </label>
			<textarea
				id="text"
				bind:value={text}
				class="focus:shadow-outline w-full appearance-none rounded border px-3 py-2 leading-tight text-gray-700 focus:outline-none"
				rows="3"
			></textarea>
		</div>

		<div class="flex items-center justify-between">
			<button
				onclick={sendTestMessage}
				disabled={loading}
				class="focus:shadow-outline rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700 focus:outline-none"
				type="button"
			>
				{loading ? 'Sending...' : 'Send Test Message'}
			</button>
		</div>
	</div>

	{#if response}
		<div class="rounded-lg bg-white p-6 shadow-md">
			<h2 class="mb-4 text-xl font-semibold">Response</h2>

			<div class="mb-2">
				<span class="font-medium">Status:</span>
				<span class={response.success ? 'text-green-600' : 'text-red-600'}>
					{response.success ? 'Success' : 'Error'}
				</span>
			</div>

			{#if response.status}
				<div class="mb-2">
					<span class="font-medium">HTTP Status:</span>
					{response.status}
				</div>
			{/if}

			{#if response.error}
				<div class="mb-4 rounded bg-red-100 p-3 text-red-800">
					<span class="font-medium">Error:</span>
					{response.error}
				</div>
			{/if}

			{#if response.response}
				<div class="mb-4">
					<span class="font-medium">Webhook Response:</span>
					<pre class="mt-2 overflow-x-auto rounded bg-gray-100 p-3">{JSON.stringify(
							response.response,
							null,
							2
						)}</pre>
				</div>
			{/if}

			{#if response.payload}
				<div>
					<span class="font-medium">Request Payload:</span>
					<pre class="mt-2 overflow-x-auto rounded bg-gray-100 p-3">{JSON.stringify(
							response.payload,
							null,
							2
						)}</pre>
				</div>
			{/if}
		</div>
	{/if}
</div>
