<script lang="ts">
	let { data } = $props();
	let { user } = data;

	let selectedChannel = $state('sms');
</script>

<div class="flex min-h-screen flex-col gap-4 bg-gray-100 p-4">
	<!-- Header -->
	<div class="bg-gray-200 px-6 py-4">
		<h1 class="text-center text-2xl font-bold">Dashboard</h1>
	</div>

	<!-- Communication Channel Filters -->
	<div class="flex items-center gap-8 rounded-lg bg-white px-6 py-4">
		<button
			class="text-base font-normal {selectedChannel === 'sms'
				? 'font-medium text-primary'
				: 'text-gray-600 hover:text-gray-900'}"
			onclick={() => (selectedChannel = 'sms')}
		>
			sms
		</button>
		<button
			class="text-base font-normal {selectedChannel === 'email'
				? 'font-medium text-primary'
				: 'text-gray-600 hover:text-gray-900'}"
			onclick={() => (selectedChannel = 'email')}
		>
			email
		</button>
		<button
			class="text-base font-normal {selectedChannel === 'phonecall'
				? 'font-medium text-primary'
				: 'text-gray-600 hover:text-gray-900'}"
			onclick={() => (selectedChannel = 'phonecall')}
		>
			phonecall
		</button>
	</div>

	<!-- Cards Grid -->
	<div class="grid flex-1 grid-cols-2 gap-4">
		<!-- Upper Row - Left: latest communications -->
		<div class="rounded-lg bg-white p-6 shadow-sm">
			<h2 class="mb-4 text-base font-normal">latest communications</h2>
			<!-- Empty placeholder for content -->
		</div>

		<!-- Upper Row - Right: site visitors -->
		<div class="rounded-lg bg-white p-6 shadow-sm">
			<h2 class="mb-4 text-base font-normal">site visitors</h2>
			<div class="mb-4 space-y-2 text-sm">
				<div>session id</div>
				<div>name</div>
				<div>history</div>
				<div>web views</div>
				<div>profile</div>
			</div>
			<!-- Empty placeholder for content -->
		</div>

		<!-- Lower Row - Left: upcoming appointments -->
		<div class="rounded-lg bg-white p-6 shadow-sm">
			<h2 class="mb-4 text-base font-normal">upcoming appointments</h2>
			<!-- Empty placeholder for content -->
		</div>

		<!-- Lower Row - Middle-Left: assigned -->
		<div class="rounded-lg bg-white p-6 shadow-sm">
			<h2 class="mb-4 text-base font-normal">assigned</h2>
			<!-- Empty placeholder for content -->
		</div>

		<!-- Lower Row - Middle-Right: Empty card -->
		<div class="rounded-lg bg-white p-6 shadow-sm">
			<!-- Empty placeholder -->
		</div>

		<!-- Lower Row - Right: Empty card -->
		<div class="rounded-lg bg-white p-6 shadow-sm">
			<!-- Empty placeholder -->
		</div>
	</div>
</div>
