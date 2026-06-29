<script lang="ts">
	import { Share2, Calendar, Plus, MessageSquare, Heart, Bookmark, Eye, Trash2, Send, Globe, Facebook, Instagram, Linkedin, Twitter } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	let socialPosts = $state([
		{
			id: '1',
			platform: 'Facebook',
			status: 'Scheduled',
			date: '2026-06-30 at 9:00 AM',
			content: 'Water leaks can cost hundreds of dollars if ignored. Call us for a complete home plumbing inspection and avoid water damage issues! 🏠💧 #clearwater #plumbingtips',
			likes: 0,
			shares: 0
		},
		{
			id: '2',
			platform: 'Instagram',
			status: 'Published',
			date: '2026-06-25 at 4:30 PM',
			content: 'Out with the old, in with the new! 🛠️ Completed a tankless water heater installation today. Homeowner is now enjoying endless hot water and lower energy bills! #trades #plumbinglife',
			likes: 42,
			shares: 5
		},
		{
			id: '3',
			platform: 'Linkedin',
			status: 'Published',
			date: '2026-06-20 at 10:15 AM',
			content: 'Proud to share that ClearSky Software has helped us automate nearly all incoming customer enquiries, resulting in a 72% increase in project bookings this month! 📈🚀 #growthmindset #businessautomation',
			likes: 18,
			shares: 2
		}
	]);

	let showComposeModal = $state(false);
	let selectedPlatform = $state('Facebook');
	let postContent = $state('');
	let scheduleTime = $state('2026-07-01T09:00');

	function getPlatformIcon(platform: string) {
		switch (platform) {
			case 'Facebook': return Facebook;
			case 'Instagram': return Instagram;
			case 'Linkedin': return Linkedin;
			default: return Twitter;
		}
	}

	function getPlatformColor(platform: string) {
		switch (platform) {
			case 'Facebook': return 'text-blue-600 bg-blue-50 border-blue-100';
			case 'Instagram': return 'text-pink-600 bg-pink-50 border-pink-100';
			case 'Linkedin': return 'text-sky-700 bg-sky-50 border-sky-100';
			default: return 'text-cyan-500 bg-cyan-50 border-cyan-100';
		}
	}

	function handleCompose(e: Event) {
		e.preventDefault();
		if (!postContent.trim()) return;

		const formatTime = new Date(scheduleTime).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});

		const newPost = {
			id: String(socialPosts.length + 1),
			platform: selectedPlatform,
			status: 'Scheduled',
			date: formatTime,
			content: postContent,
			likes: 0,
			shares: 0
		};

		socialPosts = [newPost, ...socialPosts];
		showComposeModal = false;
		postContent = '';
		toast.success('Social post scheduled successfully!');
	}

	function deletePost(id: string) {
		socialPosts = socialPosts.filter(p => p.id !== id);
		toast.success('Post removed from queue');
	}

	function publishNow(id: string) {
		socialPosts = socialPosts.map(p => {
			if (p.id === id) {
				return {
					...p,
					status: 'Published',
					date: 'Just now'
				};
			}
			return p;
		});
		toast.success('Published live to channel!');
	}
</script>

<div class="min-h-screen bg-gray-50 p-6 font-sans">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between border-b border-gray-200 pb-5">
		<div>
			<h1 class="text-xl font-bold text-gray-800 flex items-center gap-2">
				<Share2 class="h-5 w-5 text-indigo-500" />
				Social Content Planner
			</h1>
			<p class="text-xs text-gray-500 mt-1">Compose, schedule, and review updates across Facebook, Instagram, LinkedIn, and Twitter.</p>
		</div>
		<button
			onclick={() => showComposeModal = true}
			class="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-2 px-3 rounded shadow-sm transition"
		>
			<Plus class="h-4 w-4" />
			Compose Update
		</button>
	</div>

	<!-- Queue Grid -->
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
		<!-- Left / Center: Queue List -->
		<div class="lg:col-span-2 space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-bold text-gray-800 uppercase tracking-wider">Posting Queue & History</h2>
			</div>

			<div class="space-y-4">
				{#each socialPosts as post}
					{@const Icon = getPlatformIcon(post.platform)}
					<div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-4">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2.5">
								<div class="flex h-8 w-8 items-center justify-center rounded border {getPlatformColor(post.platform)}">
									<Icon class="h-4.5 w-4.5" />
								</div>
								<div>
									<span class="text-xs font-bold text-gray-800">{post.platform} Page</span>
									<p class="text-[10px] text-gray-400 font-semibold">{post.date}</p>
								</div>
							</div>
							<div class="flex items-center gap-2">
								<span class="inline-flex items-center text-[9px] font-bold px-2 py-0.5 rounded border 
									{post.status === 'Published' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-blue-50 text-blue-700 border-blue-200'}">
									{post.status.toUpperCase()}
								</span>
							</div>
						</div>

						<p class="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{post.content}</p>

						<div class="border-t border-gray-100 pt-3 flex items-center justify-between">
							{#if post.status === 'Published'}
								<div class="flex items-center gap-4 text-xs text-gray-400">
									<span class="flex items-center gap-1">
										<Heart class="h-3.5 w-3.5 text-pink-500 fill-pink-50" /> {post.likes}
									</span>
									<span class="flex items-center gap-1">
										<Share2 class="h-3.5 w-3.5 text-indigo-500" /> {post.shares}
									</span>
								</div>
							{:else}
								<div class="flex items-center gap-2">
									<button 
										onclick={() => publishNow(post.id)}
										class="text-[10px] font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded transition border border-emerald-200 flex items-center gap-1"
									>
										<Send class="h-3 w-3" /> Publish Now
									</button>
								</div>
							{/if}

							<button 
								onclick={() => deletePost(post.id)}
								class="text-gray-400 hover:text-red-600 transition"
								title="Delete"
							>
								<Trash2 class="h-4 w-4" />
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Right side: Sidebar metrics / Channel Status -->
		<div class="space-y-6">
			<div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
				<h3 class="text-xs font-bold text-gray-800 uppercase tracking-wider">Connected Accounts</h3>
				<div class="space-y-2.5">
					<div class="flex items-center justify-between border-b border-gray-50 pb-2.5">
						<div class="flex items-center gap-2 text-xs font-medium text-gray-700">
							<Facebook class="h-4 w-4 text-blue-600" /> Facebook Page
						</div>
						<span class="text-[10px] font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">CONNECTED</span>
					</div>

					<div class="flex items-center justify-between border-b border-gray-50 pb-2.5">
						<div class="flex items-center gap-2 text-xs font-medium text-gray-700">
							<Instagram class="h-4 w-4 text-pink-600" /> Instagram Professional
						</div>
						<span class="text-[10px] font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">CONNECTED</span>
					</div>

					<div class="flex items-center justify-between border-b border-gray-50 pb-2.5">
						<div class="flex items-center gap-2 text-xs font-medium text-gray-700">
							<Linkedin class="h-4 w-4 text-sky-700" /> LinkedIn Organization
						</div>
						<span class="text-[10px] font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">CONNECTED</span>
					</div>

					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-xs font-medium text-gray-400">
							<Twitter class="h-4 w-4 text-gray-400" /> Twitter Profile
						</div>
						<button class="text-[10px] font-bold text-indigo-600 hover:underline">Link Account</button>
					</div>
				</div>
			</div>

			<div class="bg-indigo-900 rounded-xl p-5 text-white shadow-md relative overflow-hidden">
				<div class="absolute right-[-20px] bottom-[-20px] opacity-10">
					<Share2 class="h-32 w-32" />
				</div>
				<h3 class="font-bold text-sm mb-1 uppercase tracking-wider">AI Content Companion</h3>
				<p class="text-white/80 text-xs leading-relaxed mb-4">Let ClearSky write your updates! Our system automatically drafts social media announcements for completed projects and positive reviews.</p>
				<button 
					onclick={() => toast.info('AI is scanning completed projects for post draft opportunities.')}
					class="w-full bg-white hover:bg-white/95 text-indigo-900 font-bold text-xs py-2 rounded shadow-sm transition"
				>
					Generate Posts
				</button>
			</div>
		</div>
	</div>

	<!-- Compose Modal Mockup -->
	{#if showComposeModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
			<div class="bg-white rounded-xl shadow-xl border w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
				<h3 class="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
					<Share2 class="h-5 w-5 text-indigo-500" />
					Compose Update
				</h3>

				<form onsubmit={handleCompose} class="space-y-4">
					<div class="space-y-1">
						<label for="platform" class="text-xs font-bold text-gray-500 uppercase">Publish Channel</label>
						<select
							id="platform"
							bind:value={selectedPlatform}
							class="w-full text-sm border-gray-200 border rounded-lg p-2.5 bg-white focus:outline-none"
						>
							<option>Facebook</option>
							<option>Instagram</option>
							<option>Linkedin</option>
							<option>Twitter</option>
						</select>
					</div>

					<div class="space-y-1">
						<label for="content" class="text-xs font-bold text-gray-500 uppercase">Post Content</label>
						<textarea
							id="content"
							rows="4"
							bind:value={postContent}
							required
							placeholder="What would you like to share with your audience?"
							class="w-full text-sm border-gray-200 border rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
						></textarea>
					</div>

					<div class="space-y-1">
						<label for="schedule" class="text-xs font-bold text-gray-500 uppercase">Schedule Time</label>
						<input
							id="schedule"
							type="datetime-local"
							bind:value={scheduleTime}
							required
							class="w-full text-sm border-gray-200 border rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
						/>
					</div>

					<div class="flex items-center justify-end gap-3 pt-2">
						<button
							type="button"
							onclick={() => showComposeModal = false}
							class="text-xs font-semibold text-gray-500 hover:text-gray-700 py-2 px-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
						>
							Cancel
						</button>
						<button
							type="submit"
							class="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 py-2 px-4 rounded-lg shadow-sm transition"
						>
							Schedule Post
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
</div>
