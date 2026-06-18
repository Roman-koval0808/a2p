import { describe, it, expect } from 'vitest';
import { filterContacts } from './contacts-filter';

describe('filterContacts', () => {
	it('returns all contacts when query is empty', () => {
		const contacts = [
			{ name: 'Alice', phone: '+15551234567' },
			{ name: 'Bob', phone: null }
		];
		expect(filterContacts(contacts, '')).toEqual(contacts);
	});

	it('filters by name (case-insensitive)', () => {
		const contacts = [
			{ name: 'Alice Smith', phone: '+15551234567' },
			{ name: 'Bob Jones', phone: '+15559876543' }
		];
		expect(filterContacts(contacts, 'alice')).toHaveLength(1);
		expect(filterContacts(contacts, 'alice')[0].name).toBe('Alice Smith');
	});

	it('filters by phone (substring)', () => {
		const contacts = [
			{ name: 'Alice', phone: '+15551234567' },
			{ name: 'Bob', phone: '+15559876543' }
		];
		expect(filterContacts(contacts, '123')).toHaveLength(1);
		expect(filterContacts(contacts, '987')).toHaveLength(1);
	});

	it('returns empty array when no match', () => {
		const contacts = [{ name: 'Alice', phone: '+15551234567' }];
		expect(filterContacts(contacts, 'xyz')).toEqual([]);
	});

	it('handles null name or phone', () => {
		const contacts = [
			{ name: null, phone: '+15551111111' },
			{ name: 'NoPhone', phone: null }
		];
		expect(filterContacts(contacts, '111')).toHaveLength(1);
		expect(filterContacts(contacts, 'NoPhone')).toHaveLength(1);
	});
});
