<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import { Edit3, Facebook, Instagram } from 'lucide-svelte';
	import * as Dialog from '$lib/components/ui/dialog/index';
</script>

<Dialog.Content class="!w-[682px] bg-dialog px-10 pb-4 pt-10">
	<Dialog.Header>
		<Dialog.Title class="py-4">Rory Dredhart</Dialog.Title>
		<div class="flex flex-col gap-11">
			<div class="flex flex-col gap-2">
				<div class="flex items-center gap-4">
					<span class="w-20 text-sm">Name:</span>
					<input
						type="text"
						value="Rory"
						class="w-48 border-b border-gray-300 bg-transparent outline-none"
					/>
					<input
						type="text"
						value="Dredhart"
						class="ml-2 w-48 border-b border-gray-300 bg-transparent outline-none"
					/>
				</div>

				<div class="flex items-center gap-4">
					<span class="w-20 text-sm">SMS:</span>
					<input
						type="tel"
						value="(705) 264-2251"
						class="border-b border-gray-300 bg-transparent text-blue-500 outline-none"
					/>
				</div>

				<div class="flex items-center gap-4">
					<span class="w-20 text-sm">Email:</span>
					<input
						type="email"
						value="r.dredharrt@canadiantradex.com"
						class="border-b border-gray-300 bg-transparent text-blue-500 outline-none"
					/>
				</div>
				<div class="flex flex-col gap-4">
					<span class="w-20 text-sm">Channels:</span>
					<div class="flex items-center gap-2">
						<Facebook class="h-6 w-6" />
						<Instagram class="h-6 w-6" />
					</div>
				</div>
			</div>

			<div class="mt-8">
				<h2 class="mb-4 text-xl">History</h2>
				<div class="rounded-lg border border-dashed border-[#858585] bg-gray-50 p-6">
					<div class="mb-4 flex items-center justify-between">
						<span class="">Nov 27, 2024</span>
						<div class="flex items-center gap-2">
							<span class="rounded-md bg-neutral-100 px-3 py-1 text-sm text-white">Closed</span>
							<button class="p-1">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="24"
									height="24"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									class="h-4 w-4"><path d="m18 15-6-6-6 6" /></svg
								>
							</button>
						</div>
					</div>

					<div class="mb-4">
						<span class="rounded-md bg-neutral-100 px-3 py-1 text-sm text-white"
							>Canadian Trade-Ex</span
						>
					</div>

					<div class="flex items-center gap-2">
						<span class="text-neutral-100">Assignee</span>
						<span class="text-neutral-200">Rory Dredhart</span>
					</div>

					<a href="#" class="mt-4 block text-blue-600 hover:underline">View full conversation</a>
				</div>
			</div>
			<Button class=" ml-auto">Save Changes</Button>
		</div>
	</Dialog.Header>
</Dialog.Content>
