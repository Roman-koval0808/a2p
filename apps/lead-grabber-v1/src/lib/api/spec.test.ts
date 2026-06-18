import { describe, it, expect } from 'vitest';
import { requireAuth, unauthorized, specSuccess, specError, notFound, pagination } from './spec';
import type { SpecLocals } from './spec';

describe('requireAuth', () => {
	it('returns null when user is null', () => {
		expect(requireAuth({ user: null })).toBe(null);
	});

	it('returns null when user has no company', () => {
		expect(requireAuth({ user: { id: 'u1', company: null } })).toBe(null);
	});

	it('returns id and companyId when user has company', () => {
		const locals: SpecLocals = {
			user: { id: 'u1', company: { id: 'c1' } }
		};
		expect(requireAuth(locals)).toEqual({ id: 'u1', companyId: 'c1' });
	});
});

describe('unauthorized', () => {
	it('returns 401 response with error body', async () => {
		const res = unauthorized();
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body).toEqual({ success: false, error: 'Unauthorized', code: 401 });
	});
});

describe('specSuccess', () => {
	it('returns 200 with success and data', async () => {
		const res = specSuccess({ foo: 'bar' });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ success: true, data: { foo: 'bar' } });
	});

	it('includes message when provided', async () => {
		const res = specSuccess({ id: '1' }, 'Created');
		const body = await res.json();
		expect(body).toEqual({ success: true, data: { id: '1' }, message: 'Created' });
	});
});

describe('specError', () => {
	it('returns 400 by default with error message', async () => {
		const res = specError('Bad request');
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body).toEqual({ success: false, error: 'Bad request', code: 400 });
	});

	it('uses provided status code', async () => {
		const res = specError('Not found', 404);
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.code).toBe(404);
	});
});

describe('notFound', () => {
	it('returns 404 with spec-shaped body', async () => {
		const res = notFound();
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body).toEqual({ success: false, error: 'Not found', code: 404 });
	});
	it('accepts custom message', async () => {
		const res = notFound('Contact not found');
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error).toBe('Contact not found');
	});
});

describe('pagination', () => {
	it('computes totalPages from page, limit, total', () => {
		expect(pagination(1, 10, 25)).toEqual({
			page: 1,
			limit: 10,
			total: 25,
			totalPages: 3
		});
	});

	it('returns at least 1 totalPages when total is 0', () => {
		expect(pagination(1, 10, 0).totalPages).toBe(1);
	});
});
