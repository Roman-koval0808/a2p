<script lang="ts">
	// Prototype-style Session Summary drawer (mirrors design/a2p-log-prototype.html openDraw).
	interface Props {
		comm?: any;
		onClose?: () => void;
	}

	let { comm, onClose }: Props = $props();

	const CHANNEL_LABELS: Record<string, string> = {
		email: 'Email',
		sms: 'SMS',
		voice: 'Voice',
		web: 'Web',
		facebook: 'Facebook',
		chatbot: 'Chatbot',
		leadform: 'Leadform',
		leadbox: 'Leadbox',
		viewroom: 'Viewroom'
	};

	function channelLabel(): string {
		const t = (comm?.type || comm?.typeIcon || '').toLowerCase();
		return CHANNEL_LABELS[t] || comm?.type || 'Web';
	}

	function cap(s: string | null | undefined): string {
		const v = (s ?? '').trim();
		if (!v) return '—';
		const lower = v.toLowerCase();
		const pretty: Record<string, string> = {
			water_heater: 'Water Heater',
			'water heater': 'Water Heater',
			hvac: 'HVAC',
			emergency: 'Emergency'
		};
		if (pretty[lower]) return pretty[lower];
		return v.charAt(0).toUpperCase() + v.slice(1);
	}

	function tierLabel(tier: string | null | undefined): string {
		const t = (tier ?? '').replace(/\s/g, '').toUpperCase();
		if (t === 'T1' || t === 'TIER1') return 'T1';
		if (t === 'T2' || t === 'TIER2') return 'T2';
		return '2B';
	}

	function emergencyLabel(comm: any): string {
		const m = comm?.raw?.metadata ?? {};
		return m.message_category === 'emergency' || m.urgency_gpt >= 4 ? 'Yes' : 'No';
	}

	function statusValue(comm: any): string {
		const m = comm?.raw?.metadata ?? {};
		const s = (m.intentStatus as string) ?? (m.message_category as string) ?? null;
		return s ? s.replace(/_/g, ' ') : (comm?.purpose ?? 'no action required').toLowerCase();
	}

	function nextStep(comm: any): string {
		return comm?.purpose || comm?.summary || 'Watch for the next signal.';
	}

	function journey(comm: any): string {
		const signals = Array.isArray(comm?.raw?.metadata?.signals) ? comm.raw.metadata.signals : [];
		if (signals.length) return signals.join(' → ');
		return comm?.summary || '';
	}

	function subtopics(): string[] {
		return Array.isArray(comm?.threadSubtopics) ? comm.threadSubtopics.map((s: string) => cap(s)) : [];
	}
</script>

{#if comm}
	<button type="button" class="ss-ov on" onclick={onClose} aria-label="Close"></button>
	<div class="ss-draw on">
		<div class="dh">
			<button class="x" onclick={onClose}>×</button>
			<h2>Session Summary</h2>
			<div class="meta">
				{comm.sessionId ?? '—'} · {comm.engagementId ?? '—'} ({subtopics().join(', ') || 'General'})
				· {channelLabel()} {comm.direction === 'Out' ? 'outbound' : 'inbound'}
			</div>
		</div>
		<div class="db">
			<div class="sec">Narrative</div>
			<div class="narr">{comm.summary || comm.raw?.content || '—'}</div>

			<div class="sec">Channel · Source · Endpoint</div>
			<div class="kv"><span class="k">Channel</span><span class="v">{channelLabel()} · {comm.direction === 'Out' ? 'out' : 'in'}</span></div>
			<div class="kv"><span class="k">Source</span><span class="v">{comm.channelSource || '—'}</span></div>
			{#if comm.channelSourceDetail}
				<div class="kv"><span class="k">Source detail</span><span class="v">{comm.channelSourceDetail}</span></div>
			{/if}
			<div class="kv"><span class="k">Endpoint</span><span class="v">{comm.endpoint || '—'}</span></div>

			<div class="sec">Intent (AI interpretation)</div>
			<div class="kv"><span class="k">Stage</span><span class="v">{cap(comm.intentStage) || '—'}</span></div>
			<div class="kv"><span class="k">Subtopic</span><span class="v">{cap(comm.intentSubtopic) || subtopics().join(', ') || '—'}</span></div>
			<div class="kv"><span class="k">Emergency</span><span class="v">{emergencyLabel(comm)}</span></div>
			<div class="kv"><span class="k">Status</span><span class="v">{comm.intentStatus || '—'}</span></div>
			<div class="kv"><span class="k">Confidence</span><span class="v">{comm.intentConfidence || '—'}</span></div>
			<div class="kv"><span class="k">Tier</span><span class="v">{tierLabel(comm.profileTier)}</span></div>

			<div class="sec">Journey &amp; Activity</div>
			<div class="narr">{journey(comm) || '—'}</div>

			<div class="sec">Status &amp; next step</div>
			<div class="status-bar">
				<div class="s">Current status</div>
				<div class="b">{statusValue(comm)}</div>
				<div class="nx">➜ {nextStep(comm)}</div>
			</div>
		</div>
	</div>
{/if}

<style>
	:global(.ss-ov) {
		position: fixed;
		inset: 0;
		background: rgba(16, 24, 40, 0.4);
		opacity: 0;
		pointer-events: none;
		transition: 0.2s;
		z-index: 50;
		border: none;
		padding: 0;
		cursor: pointer;
	}
	:global(.ss-ov.on) {
		opacity: 1;
		pointer-events: auto;
	}
	:global(.ss-draw) {
		position: fixed;
		top: 0;
		right: 0;
		height: 100%;
		width: 520px;
		max-width: 94vw;
		background: #fff;
		font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
		color: #1b2129;
		font-size: 14px;
		box-shadow: -8px 0 40px rgba(16, 24, 40, 0.2);
		transform: translateX(100%);
		transition: 0.25s;
		z-index: 51;
		overflow-y: auto;
	}
	:global(.ss-draw.on) {
		transform: translateX(0);
	}
	:global(.ss-draw .dh) {
		padding: 18px 22px;
		border-bottom: 1px solid #e3e7ec;
		position: sticky;
		top: 0;
		background: #fff;
	}
	:global(.ss-draw .dh .x) {
		float: right;
		border: none;
		background: none;
		font-size: 22px;
		cursor: pointer;
		color: #8b95a0;
		line-height: 1;
	}
	:global(.ss-draw .dh h2) {
		margin: 0 0 3px;
		font-size: 17px;
	}
	:global(.ss-draw .dh .meta) {
		font-family: ui-monospace, monospace;
		font-size: 11.5px;
		color: #8b95a0;
	}
	:global(.ss-draw .db) {
		padding: 18px 22px;
	}
	:global(.ss-draw .sec) {
		font-size: 10.5px;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #8b95a0;
		font-weight: 700;
		margin: 22px 0 8px;
	}
	:global(.ss-draw .sec:first-child) {
		margin-top: 0;
	}
	:global(.ss-draw .narr) {
		background: #f4f6f8;
		border-radius: 10px;
		padding: 13px 15px;
		line-height: 1.6;
		font-size: 13.5px;
	}
	:global(.ss-draw .kv) {
		display: flex;
		justify-content: space-between;
		padding: 6px 0;
		border-bottom: 1px solid #eef1f4;
		font-size: 13px;
	}
	:global(.ss-draw .kv .k) {
		color: #5a6570;
	}
	:global(.ss-draw .kv .v) {
		font-weight: 600;
		text-align: right;
	}
	:global(.ss-draw .status-bar) {
		background: #20374b;
		color: #fff;
		border-radius: 10px;
		padding: 13px 15px;
	}
	:global(.ss-draw .status-bar .s) {
		font-size: 11px;
		color: #9db3c4;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	:global(.ss-draw .status-bar .b) {
		font-size: 15px;
		font-weight: 700;
		margin-top: 2px;
	}
	:global(.ss-draw .status-bar .nx) {
		font-size: 12.5px;
		color: #d3dee7;
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid rgba(255, 255, 255, 0.15);
	}
</style>
