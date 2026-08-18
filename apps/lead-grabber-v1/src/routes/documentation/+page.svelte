<script lang="ts">
	let copied = $state<string | null>(null);

	async function copy(text: string, key: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = key;
			setTimeout(() => (copied = null), 1500);
		} catch {
			// clipboard unavailable
		}
	}

	const testUser = {
		email: 'test.mobile@clearsky.com',
		password: 'ClearskyMobile2026!',
		callerId: '+17059985691',
		testDest: '+17058068653'
	};

	const canonical: { route: string; method: string; purpose: string }[] = [
		{ route: '/api/auth/login', method: 'POST', purpose: 'Get JWT token' },
		{ route: '/api/auth/refresh', method: 'POST', purpose: 'Re-issue expired token' },
		{ route: '/api/me', method: 'GET', purpose: 'Profile + company' },
		{ route: '/api/sip/credentials', method: 'GET', purpose: 'WebRTC token + caller ID (dialer config)' },
		{ route: '/api/telnyx/dial', method: 'POST', purpose: 'Outbound call' },
		{ route: '/api/telnyx/hangup', method: 'POST', purpose: 'Hang up by callId' },
		{ route: '/api/telnyx/answer-call', method: 'POST', purpose: 'Answer inbound call' },
		{ route: '/api/telnyx/log-webrtc-call', method: 'POST', purpose: 'Record completed WebRTC call' },
		{ route: '/api/calls/history', method: 'GET', purpose: 'Call log' },
		{ route: '/api/sms/send', method: 'POST', purpose: 'Send SMS' },
		{ route: '/api/sms/history', method: 'GET', purpose: 'SMS log' },
		{ route: '/api/communication-logs', method: 'GET', purpose: 'Unified voice+SMS+email feed' },
		{ route: '/api/communication-logs/{id}', method: 'GET', purpose: 'Thread detail' },
		{ route: '/api/contacts', method: 'GET', purpose: 'Contact list' },
		{ route: '/api/push/register', method: 'POST', purpose: 'Register push/VoIP tokens' },
		{ route: '/api/fcm/store-token', method: 'POST', purpose: 'Android FCM token' },
		{ route: '/api/notifications', method: 'GET', purpose: 'Notification feed' },
		{ route: '/api/notifications/unread-count', method: 'GET', purpose: 'Badge count' },
		{ route: '/api/company-numbers', method: 'GET', purpose: 'Assigned outbound numbers' }
	];

	const conflicts: { concept: string; canonical: string; ignore: string }[] = [
		{
			concept: 'Communication log',
			canonical: '/api/communication-logs*',
			ignore:
				'/api/a2p/communication-log · /api/calls/history · /api/sms/history · /api/email/history · /api/v1/tenants/{slug}/profiles/*'
		},
		{
			concept: 'Outbound calls',
			canonical: '/api/telnyx/dial',
			ignore: '/api/telnyx/test-call · /api/telnyx/ivr/bridge · /api/telnyx/ivr/*'
		},
		{
			concept: 'Hang up',
			canonical: '/api/telnyx/hangup',
			ignore: '/api/telnyx/test-call-end · /api/calls/log'
		},
		{
			concept: 'Call logging',
			canonical: '/api/telnyx/log-webrtc-call',
			ignore: '/api/calls/log · /api/telnyx/test-call-summary'
		},
		{
			concept: 'Notifications',
			canonical: '/api/notifications*',
			ignore: '/api/dashboard/recent-notifications'
		},
		{
			concept: 'Inbox / messages',
			canonical: '/api/messages*',
			ignore: '/api/events · /api/notifications (different concept: alerts)'
		},
		{
			concept: 'SMS send',
			canonical: '/api/sms/send',
			ignore: '/api/v1/telemetry/send-sms (profiledb mirror)'
		},
		{
			concept: 'Webhooks (server-only)',
			canonical: '—',
			ignore:
				'/api/telnyx/webhook · /api/telnyx/call-webhook · /api/webhooks/telnyx/* · /api/webhooks/inbound-email · /api/webhooks/facebook — Telnyx/Google call these, not the app'
		},
		{
			concept: 'Telnyx admin',
			canonical: '/api/telnyx/numbers/list',
			ignore:
				'/api/telnyx/numbers/buy · /api/telnyx/numbers/search · /api/telnyx/numbers/orders · /api/telnyx/numbers/update · /api/telnyx/numbers/{id} · /api/telnyx/porting/* · /api/telnyx/setup-company'
		},
		{
			concept: 'Pipeline (internal)',
			canonical: '—',
			ignore:
				'/api/a2p/* · /api/orchestrator/* · /api/profiles/* · /api/representatives/* · /api/schedule/* · /api/tasks/* · /api/shortcuts/* · /api/ivr/* · /api/area-codes'
		}
	];

	const curl = `BASE=http://localhost:3005
EMAIL=test.mobile@clearsky.com
PASS=ClearskyMobile2026!

TOKEN=$(curl -s -X POST $BASE/api/auth/login \\
  -H 'Content-Type: application/json' \\
  -d "{\\"email\\":\\"$EMAIL\\",\\"password\\":\\"$PASS\\"}" | jq -r .token)

curl -s $BASE/api/me -H "Authorization: Bearer $TOKEN"
curl -s $BASE/api/sip/credentials -H "Authorization: Bearer $TOKEN"
curl -s -X POST $BASE/api/telnyx/dial -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' -d '{"to":"+17058068653"}'
curl -s $BASE/api/communication-logs -H "Authorization: Bearer $TOKEN"`;
</script>

<svelte:head>
	<title>API Integration Guide</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-6 py-12">
	<header class="mb-10">
		<p class="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">ClearSky / A2P Backend</p>
		<h1 class="mb-3 text-3xl font-bold tracking-tight">Mobile API Integration Guide</h1>
		<p class="text-sm leading-relaxed text-slate-500">
			Everything the mobile app needs to talk to the live backend: test user, authentication, the
			dialer flow, and which routes to use when paths conflict.
		</p>
		<div class="mt-4 flex flex-wrap gap-3 text-sm">
			<a
				href="/docs"
				class="rounded-lg bg-primary px-4 py-2 font-medium text-white hover:opacity-90"
			>
				Open Swagger UI (interactive)
			</a>
			<a
				href="/docs/spec.json"
				class="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-100"
			>
				OpenAPI spec (JSON)
			</a>
		</div>
	</header>

	<section class="mb-10 rounded-xl border border-slate-200 bg-slate-50 p-6">
		<h2 class="mb-1 text-lg font-semibold">Test user</h2>
		<p class="mb-4 text-sm text-slate-500">
			Log in with this account from the mobile app. It has a phone number assigned that can
			actually place calls through Telnyx.
		</p>
		<div class="grid gap-3 sm:grid-cols-2">
			<div class="rounded-lg border border-slate-200 bg-white p-4">
				<p class="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Email</p>
				<div class="flex items-center justify-between gap-2">
					<code class="text-sm font-medium break-all">{testUser.email}</code>
					<button
						class="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
						onclick={() => copy(testUser.email, 'email')}
					>
						{copied === 'email' ? 'Copied' : 'Copy'}
					</button>
				</div>
			</div>
			<div class="rounded-lg border border-slate-200 bg-white p-4">
				<p class="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Password</p>
				<div class="flex items-center justify-between gap-2">
					<code class="text-sm font-medium break-all">{testUser.password}</code>
					<button
						class="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
						onclick={() => copy(testUser.password, 'password')}
					>
						{copied === 'password' ? 'Copied' : 'Copy'}
					</button>
				</div>
			</div>
			<div class="rounded-lg border border-slate-200 bg-white p-4">
				<p class="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
					Caller ID (dial from this number)
				</p>
				<div class="flex items-center justify-between gap-2">
					<code class="text-sm font-medium">{testUser.callerId}</code>
					<button
						class="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
						onclick={() => copy(testUser.callerId, 'caller')}
					>
						{copied === 'caller' ? 'Copied' : 'Copy'}
					</button>
				</div>
			</div>
			<div class="rounded-lg border border-slate-200 bg-white p-4">
				<p class="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
					Test destination (call this)
				</p>
				<div class="flex items-center justify-between gap-2">
					<code class="text-sm font-medium">{testUser.testDest}</code>
					<button
						class="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
						onclick={() => copy(testUser.testDest, 'dest')}
					>
						{copied === 'dest' ? 'Copied' : 'Copy'}
					</button>
				</div>
			</div>
		</div>
		<p class="mt-3 text-xs leading-relaxed text-slate-500">
			⚠️ Only the caller ID above is owned by the Telnyx account. The company also has
			<code class="rounded bg-slate-200 px-1">+17059985374</code> and
			<code class="rounded bg-slate-200 px-1">+15513915091</code> assigned, but calls from those
			numbers fail at Telnyx (error <code class="rounded bg-slate-200 px-1">D51 — unverified origination number</code>).
		</p>
	</section>

	<section class="mb-10">
		<h2 class="mb-4 text-lg font-semibold">Authentication</h2>
		<ol class="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
			<li>
				<code class="rounded bg-slate-100 px-1.5 py-0.5">POST /api/auth/login</code> with
				<code class="rounded bg-slate-100 px-1.5 py-0.5">{'{ email, password }'}</code> →
				response contains the JWT <code class="rounded bg-slate-100 px-1.5 py-0.5">token</code>.
			</li>
			<li>
				Send it on every other request as
				<code class="rounded bg-slate-100 px-1.5 py-0.5">Authorization: Bearer &lt;token&gt;</code>.
			</li>
			<li>
				Token lasts 7 days. Before it expires, refresh it with
				<code class="rounded bg-slate-100 px-1.5 py-0.5">POST /api/auth/refresh</code>.
			</li>
			<li>
				Alternative flow: <code class="rounded bg-slate-100 px-1.5 py-0.5">POST /api/auth/otp/send</code>
				(<code class="rounded bg-slate-100 px-1.5 py-0.5">{'{ intent: "login" }'}</code>) → email code →
				<code class="rounded bg-slate-100 px-1.5 py-0.5">POST /api/auth/otp/verify</code> → token.
			</li>
		</ol>
	</section>

	<section class="mb-10">
		<h2 class="mb-4 text-lg font-semibold">Postman / Swagger</h2>
		<div class="space-y-2 text-sm leading-relaxed text-slate-700">
			<p>
				<b>Access code required:</b> this page and <a href="/docs" class="font-medium text-primary underline">/docs</a>
				are restricted — ask the backend owner for the <b>docs access code</b> and enter it at
				<a href="/docs-access" class="font-medium text-primary underline">/docs-access</a> (it lasts 30 days).
			</p>
			<p>
				<b>Swagger UI</b> (interactive, hosted here):
				<a href="/docs" class="font-medium text-primary underline">GET /docs</a>.
			</p>
			<p>
				<b>Raw OpenAPI spec</b> (import into Postman or Insomnia):
				<a href="/docs/spec.json" class="font-medium text-primary underline">GET /docs/spec.json</a>
				(also <code class="rounded bg-slate-100 px-1.5 py-0.5">/openapi.json</code> on the deployed build).
			</p>
			<p>
				<b>Files in the repo</b> (apps/lead-grabber-v1/postman/):
				<code class="rounded bg-slate-100 px-1.5 py-0.5">clearsky-api.openapi.json</code>
				(collection source — no access code needed, it's a snapshot) and
				<code class="rounded bg-slate-100 px-1.5 py-0.5">clearsky-api.postman_environment.json</code>
				(environment: base URL, test credentials, caller ID).
			</p>
			<p>
				<b>How to import:</b> Postman → Import → drag in the OpenAPI JSON → it becomes a collection.
				Then Environments → Import → the environment file. Set the
				<code class="rounded bg-slate-100 px-1.5 py-0.5">baseUrl</code> variable, call
				<code class="rounded bg-slate-100 px-1.5 py-0.5">/api/auth/login</code>, and paste the returned
				token into the <code class="rounded bg-slate-100 px-1.5 py-0.5">token</code> variable —
				protected routes are pre-configured to send
				<code class="rounded bg-slate-100 px-1.5 py-0.5">Authorization: Bearer {`{{token}}`}</code>.
			</p>
		</div>
	</section>

	<section class="mb-10">
		<h2 class="mb-4 text-lg font-semibold">Dialer flow (use in this order)</h2>
		<ol class="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
			<li>
				<code class="rounded bg-slate-100 px-1.5 py-0.5">GET /api/sip/credentials</code> →
				<code class="rounded bg-slate-100 px-1.5 py-0.5">connectionId</code>,
				<code class="rounded bg-slate-100 px-1.5 py-0.5">callerIdNumber</code> (use +17059985691),
				short-lived <code class="rounded bg-slate-100 px-1.5 py-0.5">webrtcToken</code> for the
				Telnyx WebRTC SDK — the app never needs the Telnyx API key.
			</li>
			<li>
				<code class="rounded bg-slate-100 px-1.5 py-0.5">POST /api/telnyx/dial</code> with
				<code class="rounded bg-slate-100 px-1.5 py-0.5">{'{ to, from?, clientId? }'}</code> →
				<code class="rounded bg-slate-100 px-1.5 py-0.5">{'{ callId, callLegId }'}</code>.
			</li>
			<li>
				<code class="rounded bg-slate-100 px-1.5 py-0.5">POST /api/telnyx/hangup</code> with
				<code class="rounded bg-slate-100 px-1.5 py-0.5">{'{ callId }'}</code> (the one from dial).
			</li>
			<li>
				Inbound calls arrive via push (register the VoIP token through
				<code class="rounded bg-slate-100 px-1.5 py-0.5">POST /api/push/register</code>); answer with
				<code class="rounded bg-slate-100 px-1.5 py-0.5">POST /api/telnyx/answer-call</code>.
			</li>
			<li>
				Everything shows up in <code class="rounded bg-slate-100 px-1.5 py-0.5">GET /api/communication-logs</code>.
			</li>
		</ol>
	</section>

	<section class="mb-10">
		<h2 class="mb-4 text-lg font-semibold">Canonical endpoints</h2>
		<div class="overflow-x-auto rounded-lg border border-slate-200">
			<table class="w-full text-left text-sm">
				<thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
					<tr>
						<th class="px-4 py-2 font-medium">Method</th>
						<th class="px-4 py-2 font-medium">Route</th>
						<th class="px-4 py-2 font-medium">Purpose</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each canonical as row}
						<tr>
							<td class="px-4 py-2">
								<span class="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-emerald-700">
									{row.method}
								</span>
							</td>
							<td class="px-4 py-2 font-mono text-xs text-slate-700">{row.route}</td>
							<td class="px-4 py-2 text-slate-500">{row.purpose}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class="mb-10">
		<h2 class="mb-4 text-lg font-semibold">Route conflicts — what to use</h2>
		<p class="mb-3 text-sm text-slate-500">
			Some details exist at multiple paths. Use the <b>canonical</b> ones in the mobile app and
			ignore the duplicates:
		</p>
		<div class="overflow-x-auto rounded-lg border border-slate-200">
			<table class="w-full text-left text-sm">
				<thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
					<tr>
						<th class="px-4 py-2 font-medium">Concept</th>
						<th class="px-4 py-2 font-medium">Use this</th>
						<th class="px-4 py-2 font-medium">Ignore (duplicate / legacy)</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100 align-top">
					{#each conflicts as row}
						<tr>
							<td class="px-4 py-2 font-medium text-slate-700">{row.concept}</td>
							<td class="px-4 py-2 font-mono text-xs text-emerald-700">{row.canonical}</td>
							<td class="px-4 py-2 font-mono text-xs leading-relaxed text-slate-400">
								{row.ignore}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section>
		<h2 class="mb-4 text-lg font-semibold">Smoke test (curl)</h2>
		<pre class="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code>{curl}</code></pre>
	</section>

	<footer class="mt-12 border-t border-slate-200 pt-6 text-xs text-slate-400">
		Full route list (142 endpoints): <a href="/docs" class="underline hover:text-slate-600">/docs</a> ·
		Machine-readable: <a href="/docs/spec.json" class="underline hover:text-slate-600">/docs/spec.json</a> ·
		Repo guide: <code class="rounded bg-slate-100 px-1">docs/mobile-api.md</code>
	</footer>
</div>
