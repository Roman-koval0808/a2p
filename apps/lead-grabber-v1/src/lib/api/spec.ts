/**
 * Helpers for ClearSky spec API responses.
 * All spec endpoints use session auth (locals.user + company) and standard JSON shape.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

export type SpecLocals = {
	user: {
		id: string;
		company: { id: string } | null;
	} | null;
};

export function requireAuth(locals: SpecLocals): { id: string; companyId: string } | null {
	if (!locals.user?.company?.id) return null;
	return { id: locals.user.id, companyId: locals.user.company.id };
}

export function unauthorized() {
	return json({ success: false, error: 'Unauthorized', code: 401 }, { status: 401 });
}

export function specSuccess<T>(data: T, message?: string) {
	return json({ success: true, data, ...(message && { message }) });
}

export function specError(message: string, code = 400) {
	return json({ success: false, error: message, code }, { status: code >= 400 ? code : 400 });
}

/** 404 with spec-shaped body for consistency. */
export function notFound(message = 'Not found') {
	return json({ success: false, error: message, code: 404 }, { status: 404 });
}

export function pagination(page: number, limit: number, total: number) {
	return { page, limit, total, totalPages: Math.ceil(total / limit) || 1 };
}
