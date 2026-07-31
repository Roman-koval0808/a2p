<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { FileText, ArrowDownAZ, ArrowUpAZ, CalendarDays, Image as ImageIcon } from 'lucide-svelte';

	interface ProfileFile {
		name: string;
		url: string;
		mime: string;
		direction: string;
		created: string;
		commId: string;
		summary: string;
	}

	interface Props {
		open?: boolean;
		files?: ProfileFile[];
	}

	let { open = $bindable(false), files = [] }: Props = $props();

	type SortKey = 'name' | 'date';
	let sortKey = $state<SortKey>('date');
	let sortDesc = $state(true);

	const sortedFiles = $derived.by(() => {
		const list = [...files];
		list.sort((a, b) => {
			const cmp =
				sortKey === 'name'
					? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
					: a.created.localeCompare(b.created);
			return sortDesc ? -cmp : cmp;
		});
		return list;
	});

	function setSort(key: SortKey) {
		if (sortKey === key) {
			sortDesc = !sortDesc;
		} else {
			sortKey = key;
			sortDesc = true;
		}
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: '2-digit',
			year: 'numeric'
		});
	}

	const isImage = (mime: string) => mime.startsWith('image/');
	const sortBtn =
		'flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors cursor-pointer';
	const sortActive = 'border-[#577AB7] bg-[#577AB7] text-white';
	const sortIdle = 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50';
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[560px]">
		<Dialog.Header>
			<Dialog.Title>Files</Dialog.Title>
			<Dialog.Description>
				Attachments from emails with this contact
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex items-center justify-between gap-2 px-6 pb-3">
			<div class="flex items-center gap-2">
				<button class={`${sortBtn} ${sortKey === 'name' ? sortActive : sortIdle}`} onclick={() => setSort('name')}>
					{#if sortKey === 'name' && !sortDesc}
						<ArrowUpAZ class="h-3.5 w-3.5" />
					{:else}
						<ArrowDownAZ class="h-3.5 w-3.5" />
					{/if}
					Name
				</button>
				<button class={`${sortBtn} ${sortKey === 'date' ? sortActive : sortIdle}`} onclick={() => setSort('date')}>
					<CalendarDays class="h-3.5 w-3.5" />
					Date
				</button>
			</div>
			<span class="text-xs text-gray-400">{files.length} file{files.length === 1 ? '' : 's'}</span>
		</div>

		<div class="max-h-[50vh] overflow-y-auto px-6 pb-6">
			{#if sortedFiles.length === 0}
				<div class="flex flex-col items-center justify-center gap-2 py-10">
					<FileText class="h-8 w-8 text-gray-300" />
					<p class="text-sm text-gray-400">No files yet</p>
				</div>
			{:else}
				<ul class="divide-y divide-gray-100">
					{#each sortedFiles as file (file.url + file.name)}
						<li class="py-2.5">
							<a
								href={file.url}
								target="_blank"
								rel="noopener noreferrer"
								class="group flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-gray-50"
							>
								{#if isImage(file.mime)}
									<img src={file.url} alt={file.name} class="h-9 w-9 flex-shrink-0 rounded object-cover" />
								{:else}
									<div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-[#E8EDF6]">
										<FileText class="h-4.5 w-4.5 h-[18px] w-[18px] text-[#577AB7]" />
									</div>
								{/if}
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium text-gray-800 group-hover:text-[#577AB7]">
										{file.name}
									</p>
									<p class="mt-0.5 truncate text-xs text-gray-400">
										{file.direction === 'inbound' ? 'In' : 'Out'} · {formatDate(file.created)} · {file.commId}
									</p>
								</div>
								<span class="text-xs text-gray-400 group-hover:text-[#577AB7]">
									Open
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
