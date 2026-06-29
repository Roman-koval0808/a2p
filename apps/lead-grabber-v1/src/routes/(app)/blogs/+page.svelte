<script lang="ts">
	import { BookOpen, Calendar, Edit2, Plus, Eye, Clock, Trash2, ArrowUpRight, Globe, CheckCircle2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	let articles = $state([
		{
			id: '1',
			title: '5 Warning Signs Your Roof Needs Immediate Repair',
			slug: 'roof-repair-warning-signs',
			status: 'Published',
			publishedAt: '2026-06-15',
			views: 1240,
			readTime: '4 min read',
			summary: 'Do not wait for a major leak to develop. Learn the early warning signs of shingle damage, flashing wear, and moisture retention.'
		},
		{
			id: '2',
			title: 'How to Prevent Frozen Pipes in Winter',
			slug: 'prevent-frozen-pipes',
			status: 'Published',
			publishedAt: '2026-05-28',
			views: 892,
			readTime: '5 min read',
			summary: 'A complete checklist for homeowners to insulate pipes, shut off exterior valves, and handle drop-temperatures safely.'
		},
		{
			id: '3',
			title: 'Understanding Tankless Water Heaters: Pros and Cons',
			slug: 'tankless-water-heaters',
			status: 'Draft',
			publishedAt: '—',
			views: 0,
			readTime: '6 min read',
			summary: 'Is it time to upgrade to endless hot water? We break down the installation costs, energy efficiency gains, and flow limits.'
		}
	]);

	let showNewModal = $state(false);
	let newTitle = $state('');
	let newSummary = $state('');
	let newReadTime = $state('5 min read');

	function handleCreateArticle(e: Event) {
		e.preventDefault();
		if (!newTitle.trim()) return;

		const newArticle = {
			id: String(articles.length + 1),
			title: newTitle,
			slug: newTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
			status: 'Draft',
			publishedAt: '—',
			views: 0,
			readTime: newReadTime,
			summary: newSummary || 'No summary provided.'
		};

		articles = [newArticle, ...articles];
		showNewModal = false;
		newTitle = '';
		newSummary = '';
		toast.success('Blog post draft created successfully!');
	}

	function toggleStatus(id: string) {
		articles = articles.map(art => {
			if (art.id === id) {
				const isPublished = art.status === 'Published';
				return {
					...art,
					status: isPublished ? 'Draft' : 'Published',
					publishedAt: isPublished ? '—' : new Date().toISOString().split('T')[0]
				};
			}
			return art;
		});
		toast.success('Article status updated!');
	}

	function deleteArticle(id: string) {
		articles = articles.filter(art => art.id !== id);
		toast.success('Article deleted');
	}
</script>

<div class="min-h-screen bg-gray-50 p-6 font-sans">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between border-b border-gray-200 pb-5">
		<div>
			<h1 class="text-xl font-bold text-gray-800 flex items-center gap-2">
				<BookOpen class="h-5 w-5 text-indigo-500" />
				Blog Article Publisher
			</h1>
			<p class="text-xs text-gray-500 mt-1">Write, organize, and publish rich articles and guides directly to your public website.</p>
		</div>
		<button
			onclick={() => showNewModal = true}
			class="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-2 px-3 rounded shadow-sm transition"
		>
			<Plus class="h-4 w-4" />
			New Article
		</button>
	</div>

	<!-- Stats Row -->
	<div class="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
		<div class="bg-white p-5 rounded-lg border border-gray-200 flex items-center gap-4">
			<div class="flex h-10 w-10 items-center justify-center rounded bg-indigo-50 text-indigo-600 border border-indigo-100">
				<BookOpen class="h-5 w-5" />
			</div>
			<div>
				<p class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Articles</p>
				<h3 class="text-xl font-extrabold text-gray-800 mt-0.5">{articles.length}</h3>
			</div>
		</div>

		<div class="bg-white p-5 rounded-lg border border-gray-200 flex items-center gap-4">
			<div class="flex h-10 w-10 items-center justify-center rounded bg-emerald-50 text-emerald-600 border border-emerald-100">
				<Eye class="h-5 w-5" />
			</div>
			<div>
				<p class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Article Views</p>
				<h3 class="text-xl font-extrabold text-gray-800 mt-0.5">
					{articles.reduce((acc, curr) => acc + curr.views, 0)}
				</h3>
			</div>
		</div>

		<div class="bg-white p-5 rounded-lg border border-gray-200 flex items-center gap-4">
			<div class="flex h-10 w-10 items-center justify-center rounded bg-amber-50 text-amber-600 border border-amber-100">
				<Globe class="h-5 w-5" />
			</div>
			<div>
				<p class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Status</p>
				<h3 class="text-xl font-extrabold text-gray-800 mt-0.5">Live On Web</h3>
			</div>
		</div>
	</div>

	<!-- Articles Table -->
	<div class="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
		<div class="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center justify-between">
			<h2 class="text-xs font-bold text-gray-700 uppercase tracking-wider">Articles & Drafts</h2>
		</div>

		<table class="w-full text-left text-sm text-gray-500">
			<thead class="bg-gray-50 text-xs uppercase text-gray-700">
				<tr>
					<th class="px-6 py-3">Title & Summary</th>
					<th class="px-6 py-3">Read Time</th>
					<th class="px-6 py-3">Views</th>
					<th class="px-6 py-3">Publish Date</th>
					<th class="px-6 py-3">Status</th>
					<th class="px-6 py-3 text-right">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each articles as art}
					<tr class="border-b bg-white hover:bg-gray-50/50 transition-colors">
						<td class="px-6 py-4 max-w-sm">
							<div class="font-bold text-gray-900 line-clamp-1">{art.title}</div>
							<div class="text-xs text-gray-400 mt-1 line-clamp-2">{art.summary}</div>
							<div class="text-[10px] font-mono text-gray-400 mt-1.5 flex items-center gap-1">
								<Globe class="h-3 w-3" /> /{art.slug}
							</div>
						</td>
						<td class="px-6 py-4 whitespace-nowrap text-xs text-gray-700">
							<span class="inline-flex items-center gap-1">
								<Clock class="h-3.5 w-3.5 text-gray-400" />
								{art.readTime}
							</span>
						</td>
						<td class="px-6 py-4 whitespace-nowrap font-bold text-gray-800 text-xs">{art.views}</td>
						<td class="px-6 py-4 whitespace-nowrap text-xs text-gray-700">{art.publishedAt}</td>
						<td class="px-6 py-4 whitespace-nowrap">
							<button 
								onclick={() => toggleStatus(art.id)}
								class="inline-flex items-center gap-1 text-[9px] font-extrabold uppercase px-2 py-0.5 rounded border transition-colors
								{art.status === 'Published' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'}"
							>
								{art.status}
							</button>
						</td>
						<td class="px-6 py-4 whitespace-nowrap text-right">
							<div class="flex items-center justify-end gap-3">
								<button 
									onclick={() => toast.info('Editor mockup: editing is saved as auto-draft.')}
									class="text-gray-400 hover:text-indigo-600 transition" 
									title="Edit"
								>
									<Edit2 class="h-4 w-4" />
								</button>
								<button 
									onclick={() => deleteArticle(art.id)}
									class="text-gray-400 hover:text-red-600 transition" 
									title="Delete"
								>
									<Trash2 class="h-4 w-4" />
								</button>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- New Article Modal Mockup -->
	{#if showNewModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
			<div class="bg-white rounded-xl shadow-xl border w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
				<h3 class="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
					<BookOpen class="h-5 w-5 text-indigo-500" />
					Create New Article
				</h3>

				<form onsubmit={handleCreateArticle} class="space-y-4">
					<div class="space-y-1">
						<label for="title" class="text-xs font-bold text-gray-500 uppercase">Title</label>
						<input
							id="title"
							type="text"
							bind:value={newTitle}
							required
							placeholder="e.g. 10 Tips to Clean Your Drain"
							class="w-full text-sm border-gray-200 border rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
						/>
					</div>

					<div class="space-y-1">
						<label for="summary" class="text-xs font-bold text-gray-500 uppercase">Excerpt / Summary</label>
						<textarea
							id="summary"
							rows="3"
							bind:value={newSummary}
							placeholder="A short description of the post..."
							class="w-full text-sm border-gray-200 border rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
						></textarea>
					</div>

					<div class="space-y-1">
						<label for="readTime" class="text-xs font-bold text-gray-500 uppercase">Estimated Read Time</label>
						<select
							id="readTime"
							bind:value={newReadTime}
							class="w-full text-sm border-gray-200 border rounded-lg p-2.5 bg-white focus:outline-none"
						>
							<option>3 min read</option>
							<option>4 min read</option>
							<option>5 min read</option>
							<option>6 min read</option>
							<option>8 min read</option>
						</select>
					</div>

					<div class="flex items-center justify-end gap-3 pt-2">
						<button
							type="button"
							onclick={() => showNewModal = false}
							class="text-xs font-semibold text-gray-500 hover:text-gray-700 py-2 px-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
						>
							Cancel
						</button>
						<button
							type="submit"
							class="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 py-2 px-4 rounded-lg shadow-sm transition"
						>
							Create Draft
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
</div>
