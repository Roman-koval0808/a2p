import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/db';
import { requireAuth, unauthorized } from '$lib/api/spec';

async function nextPersonalCode(companyId: string, userId: string): Promise<string> {
	const existing = await prisma.shortcut.findMany({
		where: { companyId, userId },
		select: { code: true }
	});
	const nums = existing
		.map((s) => parseInt(s.code.replace(/^\//, ''), 10))
		.filter((n) => !Number.isNaN(n));
	const next = nums.length > 0 ? Math.max(...nums) + 1 : 21;
	return `/${next}`;
}

export const GET: RequestHandler = async ({ locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const shortcuts = await prisma.shortcut.findMany({
		where: { companyId: auth.companyId, userId: auth.id },
		orderBy: { code: 'asc' }
	});
	const data = shortcuts.map((s) => ({ id: s.id, code: s.code, message: s.message }));
	return json({ success: true, data });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = requireAuth(locals);
	if (!auth) return unauthorized();

	const body = await request.json().catch(() => ({}));
	const message = typeof body.message === 'string' ? body.message.trim().slice(0, 255) : '';
	if (!message) {
		return json(
			{ success: false, error: 'message is required (max 255 chars)', code: 400 },
			{ status: 400 }
		);
	}

	const code = await nextPersonalCode(auth.companyId, auth.id);
	const shortcut = await prisma.shortcut.create({
		data: { companyId: auth.companyId, userId: auth.id, code, message }
	});
	return json(
		{
			success: true,
			data: { id: shortcut.id, code: shortcut.code, message: shortcut.message },
			message: 'Shortcut created successfully'
		},
		{ status: 201 }
	);
};
