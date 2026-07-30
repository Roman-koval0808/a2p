/**
 * Background worker to trigger the sweep endpoint continuously.
 * Runs via PM2 alongside the main application.
 */

const SWEEP_INTERVAL_MS = 10000; // 10 seconds
const ENDPOINT = 'http://127.0.0.1:3005/api/a2p/timers/sweep';

async function runSweep() {
	try {
		const res = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});
		if (!res.ok) {
			console.error(`[Worker] Sweep failed with status ${res.status}`);
		}
	} catch (err) {
		console.error(`[Worker] Sweep request error:`, err.message);
	}
}

function startLoop() {
	console.log(`[Worker] Starting sweep loop every ${SWEEP_INTERVAL_MS / 1000}s`);
	setInterval(runSweep, SWEEP_INTERVAL_MS);
	// Run first sweep immediately
	runSweep();
}

startLoop();
