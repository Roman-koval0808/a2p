import type { RequestHandler } from '@sveltejs/kit';
import { prisma } from '$lib/db';
import { toContentItem } from '$lib/server/viewroom';

export const GET: RequestHandler = async ({ url }) => {
	const owner = url.searchParams.get('owner');
	if (!owner) {
		return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
	}
	try {
		const items = await prisma.contentLibraryItem.findMany({
			where: { ownerCompanyId: owner },
			orderBy: { created: 'desc' }
		});
		return new Response(JSON.stringify({ items: items.map(toContentItem) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
	} catch (e) {
		console.error('content-library list error', e);
		return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
	}
};