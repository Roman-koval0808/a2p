<script lang="ts">
	import { Globe, Settings, Terminal, Shield, ExternalLink, ArrowRight, Play, Eye, BookOpen, Smartphone } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';

	let siteSettings = $state({
		title: 'ClearSky Trade Services',
		domain: 'clearsky-trades-demo.net',
		ssl: true,
		leadboxActive: true,
		leadformActive: true,
		botActive: true
	});

	function handleSave() {
		toast.success('Website configuration saved successfully!');
	}

	function copyEmbedCode(type: string) {
		const leadboxCode = `<script src="https://clearskysoftware.net/embed/leadbox.js" data-id="demo_leadbox" defer><\/script>`;
		const leadformCode = `<iframe src="https://clearskysoftware.net/embed/leadform/demo" width="100%" height="600px" frameborder="0"><\/iframe>`;
		
		const code = type === 'leadbox' ? leadboxCode : leadformCode;
		
		try {
			navigator.clipboard.writeText(code);
			toast.success('Embed snippet copied to clipboard!');
		} catch (e) {
			toast.error('Copy to clipboard failed');
		}
	}
</script>

<div class="min-h-screen bg-gray-50 p-6 font-sans">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between border-b border-gray-200 pb-5">
		<div>
			<h1 class="text-xl font-bold text-gray-800 flex items-center gap-2">
				<Globe class="h-5 w-5 text-indigo-500" />
				Website Management
			</h1>
			<p class="text-xs text-gray-500 mt-1">Configure your public business site domain, SSL, and communication widgets.</p>
		</div>
		<button
			onclick={handleSave}
			class="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-2 px-4 rounded shadow-sm transition"
		>
			Save Settings
		</button>
	</div>

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
		<!-- Left / Center: Settings Panels -->
		<div class="lg:col-span-2 space-y-6">
			<!-- Site Config Card -->
			<div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
				<h2 class="text-sm font-bold text-gray-800 uppercase tracking-wider">Site Domain & Security</h2>
				
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div class="space-y-1">
						<label for="site-title" class="text-[10px] font-bold text-gray-400 uppercase">Website Title</label>
						<input 
							id="site-title"
							type="text" 
							bind:value={siteSettings.title}
							class="w-full text-xs border border-gray-200 rounded p-2.5 bg-white text-gray-800 focus:outline-none"
						/>
					</div>
					<div class="space-y-1">
						<label for="site-domain" class="text-[10px] font-bold text-gray-400 uppercase">Public Domain</label>
						<input 
							id="site-domain"
							type="text" 
							bind:value={siteSettings.domain}
							class="w-full text-xs border border-gray-200 rounded p-2.5 bg-white text-gray-800 focus:outline-none"
						/>
					</div>
				</div>

				<div class="flex items-center justify-between border-t border-gray-50 pt-4 text-xs">
					<div class="flex items-center gap-2 text-gray-700">
						<Shield class="h-4.5 w-4.5 text-emerald-600" />
						<span>SSL Certificate (HTTPS) is active and renewing.</span>
					</div>
					<a href="https://{siteSettings.domain}" target="_blank" class="text-indigo-600 hover:underline flex items-center gap-1.5 font-semibold">
						Visit Public Site
						<ExternalLink class="h-3.5 w-3.5" />
					</a>
				</div>
			</div>

			<!-- Embed Codes Card -->
			<div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
				<h2 class="text-sm font-bold text-gray-800 uppercase tracking-wider">Widget Embed Codes</h2>
				
				<!-- Lead Box Widget -->
				<div class="space-y-2 border-b border-gray-100 pb-4">
					<div class="flex items-center justify-between">
						<span class="text-xs font-bold text-gray-700">Lead Box Overlay (Floating Chat Widget)</span>
						<button 
							onclick={() => goto('/leadbox')}
							class="text-[10px] text-indigo-600 font-bold hover:underline"
						>
							Customize Widget Settings
						</button>
					</div>
					<p class="text-[11px] text-gray-400">Copy this script and paste it before the closing &lt;/body&gt; tag on your public site pages.</p>
					<div class="bg-slate-900 rounded p-3 text-[11px] text-teal-400 font-mono flex items-center justify-between">
						<span>&lt;script src="https://clearskysoftware.net/embed/leadbox.js" data-id="demo_leadbox" defer&gt;&lt;/script&gt;</span>
						<button 
							onclick={() => copyEmbedCode('leadbox')}
							class="text-[10px] font-sans font-bold text-white hover:text-teal-300 hover:underline px-2 py-1 rounded bg-slate-800"
						>
							Copy
						</button>
					</div>
				</div>

				<!-- Lead Form Widget -->
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<span class="text-xs font-bold text-gray-700">Lead Capture Form (Iframe Widget)</span>
						<button 
							onclick={() => goto('/leadform')}
							class="text-[10px] text-indigo-600 font-bold hover:underline"
						>
							Customize Form Designer
						</button>
					</div>
					<p class="text-[11px] text-gray-400">Copy this Iframe and paste it inside any content wrapper on your contact us or landing pages.</p>
					<div class="bg-slate-900 rounded p-3 text-[11px] text-teal-400 font-mono flex items-center justify-between">
						<span>&lt;iframe src="https://clearskysoftware.net/embed/leadform/demo" width="100%" height="600px" frameborder="0"&gt;&lt;/iframe&gt;</span>
						<button 
							onclick={() => copyEmbedCode('leadform')}
							class="text-[10px] font-sans font-bold text-white hover:text-teal-300 hover:underline px-2 py-1 rounded bg-slate-800"
						>
							Copy
						</button>
					</div>
				</div>
			</div>
		</div>

		<!-- Right side: Sidebar info -->
		<div class="space-y-6">
			<!-- Widget Status Toggle Card -->
			<div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
				<h3 class="text-xs font-bold text-gray-800 uppercase tracking-wider">Active Widget Integrations</h3>
				
				<div class="space-y-3">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-xs font-medium text-gray-700">
							<Smartphone class="h-4.5 w-4.5 text-indigo-500" /> Lead Box Overlay
						</div>
						<label class="relative inline-flex items-center cursor-pointer">
							<input type="checkbox" bind:checked={siteSettings.leadboxActive} class="sr-only peer" />
							<div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
						</label>
					</div>

					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-xs font-medium text-gray-700">
							<BookOpen class="h-4.5 w-4.5 text-indigo-500" /> Contact Capture Form
						</div>
						<label class="relative inline-flex items-center cursor-pointer">
							<input type="checkbox" bind:checked={siteSettings.leadformActive} class="sr-only peer" />
							<div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
						</label>
					</div>

					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-xs font-medium text-gray-700">
							<Terminal class="h-4.5 w-4.5 text-indigo-500" /> AI Auto-Responder Chat
						</div>
						<label class="relative inline-flex items-center cursor-pointer">
							<input type="checkbox" bind:checked={siteSettings.botActive} class="sr-only peer" />
							<div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
						</label>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
