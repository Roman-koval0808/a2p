<script lang="ts">
	import { Check, X } from 'lucide-svelte';
	import AudioPreview from '$lib/components/AudioPreview.svelte';

	interface Props {
		/** Bound file (new selection). When set, preview uses object URL. */
		file?: File | null;
		/** Existing saved URL (e.g. when editing). Shown when file is null. */
		existingUrl?: string | null;
		/** Optional label above the zone (e.g. "Greeting") */
		label?: string;
		/** Optional id for the file input (so parent can clear it). Component generates one if not provided. */
		inputId?: string;
		/** Optional class on the wrapper */
		class?: string;
	}
	let {
		file = $bindable(null as File | null),
		existingUrl = null,
		label = '',
		inputId = `audio-upload-${Math.random().toString(36).slice(2, 9)}`,
		class: className = ''
	}: Props = $props();

	let previewUrl = $state<string | null>(null);
	let isDragging = $state(false);

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function setFile(newFile: File | null) {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
		file = newFile;
		if (newFile) previewUrl = URL.createObjectURL(newFile);
	}

	function onInputChange(e: Event) {
		const target = e.target as HTMLInputElement;
		const f = target.files?.[0];
		setFile(f ?? null);
	}

	function clear() {
		setFile(null);
		const el = document.getElementById(inputId) as HTMLInputElement | null;
		if (el) el.value = '';
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isDragging = false;
		const f = e.dataTransfer?.files?.[0];
		if (f && f.type.startsWith('audio/')) setFile(f);
	}

	function handleDragover(e: DragEvent) {
		e.preventDefault();
		isDragging = true;
	}

	function handleDragLeave() {
		isDragging = false;
	}

	$effect(() => {
		const f = file;
		if (f) {
			if (!previewUrl) previewUrl = URL.createObjectURL(f);
		} else {
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl);
				previewUrl = null;
			}
		}
	});

	const hasAudio = $derived(!!file || !!existingUrl);
	const playbackSrc = $derived(file ? previewUrl : (existingUrl ?? null));
</script>

<div class="space-y-2 {className}">
	{#if label}
		<label class="block font-['Poppins'] text-lg font-semibold leading-[21px] text-[#808080]"
			>{label}</label
		>
	{/if}
	<div class="rounded-[2px] border border-[#969696] bg-white p-4">
		<div
			class="rounded-[4px] border-2 border-dashed p-8 text-center transition-colors {isDragging
				? 'border-[#577AB7] bg-[#ECF3FF]'
				: 'border-[#4F4F4F] bg-[#ECF3FF]'}"
			role="button"
			tabindex="0"
			onkeydown={(e) => e.key === 'Enter' && document.getElementById(inputId)?.click()}
			ondragover={handleDragover}
			ondragleave={handleDragLeave}
			ondrop={handleDrop}
			onclick={() => !hasAudio && document.getElementById(inputId)?.click()}
		>
			{#if hasAudio}
				<div class="space-y-3">
					<div
						class="flex flex-wrap items-center justify-center gap-2 font-['Poppins'] text-[#577AB7]"
					>
						<Check class="h-5 w-5 shrink-0" />
						<span class="font-medium">{file ? file.name : 'Current recording'}</span>
						{#if file}
							<span class="text-sm text-[#808080]">({formatSize(file.size)})</span>
						{/if}
					</div>
					{#if playbackSrc}
						<AudioPreview src={playbackSrc} class="mx-auto" />
					{/if}
					<div class="flex flex-wrap items-center justify-center gap-2">
						<label class="inline-block cursor-pointer" onclick={(e) => e.stopPropagation()}>
							<input
								id={inputId}
								type="file"
								accept="audio/*"
								onchange={onInputChange}
								class="hidden"
							/>
							<span
								class="inline-block h-[32px] rounded border border-[#577AB7] bg-white px-3 font-['Poppins'] text-sm text-[#577AB7] hover:bg-[#f0f4ff]"
								role="button"
								tabindex="0"
								onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLElement).click()}
							>
								Change
							</span>
						</label>
						<button
							type="button"
							onclick={(e) => {
								e.stopPropagation();
								clear();
							}}
							class="inline-flex h-[32px] items-center gap-1 rounded border border-red-400 bg-white px-3 font-['Poppins'] text-sm text-red-600 hover:bg-red-50"
						>
							<X class="h-4 w-4" />
							Clear
						</button>
					</div>
				</div>
			{:else}
				<p class="mb-2 font-['Poppins'] text-base font-normal leading-[19px] text-[#969696]">
					Drag a file to upload or
				</p>
				<label class="inline-block cursor-pointer" onclick={(e) => e.stopPropagation()}>
					<input
						id={inputId}
						type="file"
						accept="audio/*"
						onchange={onInputChange}
						class="hidden"
					/>
					<span
						class="inline-block h-[36px] rounded bg-[#577AB7] px-4 font-['Poppins'] text-base font-normal leading-[36px] text-white hover:bg-[#4a6ba5]"
						role="button"
						tabindex="0"
						onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLElement).click()}
					>
						Browse...
					</span>
				</label>
			{/if}
		</div>
	</div>
</div>
