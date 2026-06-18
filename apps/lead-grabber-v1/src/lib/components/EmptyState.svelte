<script lang="ts">
	import { Inbox, ArrowRight, Plus } from 'lucide-svelte';

	/**
	 * Shared empty state or "resource not found" block.
	 * Use for: no results, no data yet, or in-page 404 (e.g. profile/notification not found).
	 */
	interface Props {
		title: string;
		description?: string;
		/** Primary CTA: link (href) or button (onclick) */
		primaryAction?: { label: string; href?: string; onclick?: () => void };
		/** card = bordered box (default); compact = plain text + link */
		variant?: 'card' | 'compact';
		/** Min height / layout class (e.g. "min-h-[400px]", "min-h-0 p-4") */
		class?: string;
	}

	let {
		title,
		description = '',
		primaryAction,
		variant = 'card',
		class: className = 'min-h-[400px]'
	}: Props = $props();

	const hasAction = primaryAction && (primaryAction.href ?? primaryAction.onclick);
</script>

<div class="flex {className} items-center justify-center">
	{#if variant === 'compact'}
		<div class="w-full p-4">
			<p class="font-['Poppins'] text-[#555555]">{title}</p>
			{#if primaryAction}
				{#if primaryAction.href}
					<a
						href={primaryAction.href}
						class="mt-4 inline-flex items-center gap-1.5 font-['Poppins'] text-sm font-medium text-[#577AB7] transition-colors hover:text-[#3d5a8a]"
					>
						{primaryAction.label}
						<ArrowRight class="h-4 w-4" />
					</a>
				{:else}
					<button
						type="button"
						onclick={primaryAction.onclick}
						class="mt-4 inline-flex items-center gap-1.5 font-['Poppins'] text-sm font-medium text-[#577AB7] transition-colors hover:text-[#3d5a8a]"
					>
						{primaryAction.label}
						<ArrowRight class="h-4 w-4" />
					</button>
				{/if}
			{/if}
		</div>
	{:else}
		<div class="mx-auto w-full max-w-md px-4 text-center">
			<div
				class="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-blue-50/40 p-10 shadow-lg shadow-slate-200/50"
			>
				<!-- Decorative corner -->
				<div
					class="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[#577AB7]/10 blur-2xl"
					aria-hidden="true"
				></div>
				<div
					class="absolute -bottom-4 -left-4 h-24 w-24 rounded-full bg-[#577AB7]/5 blur-xl"
					aria-hidden="true"
				></div>

				<div class="relative">
					<div
						class="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[#577AB7]/10 text-[#577AB7]"
					>
						<Inbox class="h-10 w-10" strokeWidth={1.5} />
					</div>
					<h2 class="mb-2 font-['Poppins'] text-2xl font-semibold tracking-tight text-slate-700">
						{title}
					</h2>
					{#if description}
						<p class="mb-8 font-['Poppins'] text-base leading-relaxed text-slate-500">
							{description}
						</p>
					{:else if hasAction}
						<div class="mb-8" aria-hidden="true"></div>
					{/if}
					{#if primaryAction}
						{#if primaryAction.href}
							<a
								href={primaryAction.href}
								class="inline-flex items-center justify-center gap-2 rounded-xl bg-[#577AB7] px-6 py-3 font-['Poppins'] text-base font-semibold text-white shadow-md shadow-[#577AB7]/25 transition-all hover:-translate-y-0.5 hover:bg-[#4a6ba5] hover:shadow-lg hover:shadow-[#577AB7]/30"
							>
								<Plus class="h-5 w-5" />
								{primaryAction.label}
							</a>
						{:else}
							<button
								type="button"
								onclick={primaryAction.onclick}
								class="inline-flex items-center justify-center gap-2 rounded-xl bg-[#577AB7] px-6 py-3 font-['Poppins'] text-base font-semibold text-white shadow-md shadow-[#577AB7]/25 transition-all hover:-translate-y-0.5 hover:bg-[#4a6ba5] hover:shadow-lg hover:shadow-[#577AB7]/30"
							>
								<Plus class="h-5 w-5" />
								{primaryAction.label}
							</button>
						{/if}
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
