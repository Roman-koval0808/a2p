import { broadcastCallEvent as sseBroadcast } from './sse';

// Function to broadcast events to connected clients via SSE
export function broadcastCallEvent(event: {
	type: string;
	name?: string;
	phone?: string;
	callId?: string;
}) {
	// Forward to SSE broadcast
	sseBroadcast(event);
}

// Legacy function for compatibility
export function addWebSocketConnection() {
	// No longer needed with SSE approach
	console.log('WebSocket connection handling moved to SSE');
}

// Function to get the count of active connections
export function getActiveConnectionCount(): number {
	// SSE connections are managed in the sse utility
	return 0;
}
