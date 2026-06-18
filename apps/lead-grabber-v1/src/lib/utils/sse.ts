// Store active SSE connections grouped by companyId
const companyConnections = new Map<string, Set<ReadableStreamDefaultController>>();

// Function to add an SSE connection for a specific company
export function addSSEConnection(companyId: string, controller: ReadableStreamDefaultController) {
	if (!companyConnections.has(companyId)) {
		companyConnections.set(companyId, new Set());
	}
	companyConnections.get(companyId)!.add(controller);
}

// Function to remove an SSE connection
export function removeSSEConnection(
	companyId: string,
	controller: ReadableStreamDefaultController
) {
	const connections = companyConnections.get(companyId);
	if (connections) {
		connections.delete(controller);
		if (connections.size === 0) {
			companyConnections.delete(companyId);
		}
	}
}

// Function to broadcast events to all connected clients of a company
export function broadcastCallEvent(
	companyId: string,
	event: {
		type: string;
		[key: string]: any;
	}
) {
	const connections = companyConnections.get(companyId);
	if (!connections) return;

	const eventName = event.type;
	const data = JSON.stringify(event);
	console.log(`Broadcasting SSE event [${eventName}] to company ${companyId}:`, event);

	for (const controller of connections) {
		try {
			controller.enqueue(`event: ${eventName}\ndata: ${data}\n\n`);
		} catch {
			// Remove failed connections
			connections.delete(controller);
		}
	}

	if (connections.size === 0) {
		companyConnections.delete(companyId);
	}
}

// Function to get the total count of active connections
export function getActiveSSEConnectionCount(): number {
	let total = 0;
	for (const connections of companyConnections.values()) {
		total += connections.size;
	}
	return total;
}
