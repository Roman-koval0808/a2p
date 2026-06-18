import { writable } from 'svelte/store';

export interface FormElement {
	id: string;
	type: 'text' | 'phone' | 'email' | 'message' | 'address' | 'multiselect' | 'dropdown';
	label: string;
	value: string;
	required: boolean;
	isDefault?: boolean;
	options?: string[];
}

export const formElements = writable<FormElement[]>([]);
