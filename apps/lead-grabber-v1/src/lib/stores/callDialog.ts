import { writable } from 'svelte/store';

export interface IncomingCall {
	name?: string;
	phone: string;
	callId?: string;
}

export const callDialog = writable<{
	open: boolean;
	call: IncomingCall | null;
}>({
	open: false,
	call: null
});
