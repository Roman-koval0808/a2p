import { prisma } from '$lib/db';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { commCode } from '$lib/utils/comm-id';

// Placeholder contact names that carry no information — treat them as "no name" so we show the
// phone number / address instead of a useless "Unknown Caller".
const GENERIC_NAMES = [
	'Unknown Caller',
	'Unknown Customer',
	'Anonymous',
	'Unknown',
	'Valued Customer'
];

const cap = (s: unknown): string => {
	const str = (s ?? '').toString().trim();
	return str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';
};

// Match the mock format the page was built around: "MM-DD, hh:mmAM".
function formatDate(d: Date): string {
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	let h = d.getHours();
	const min = String(d.getMinutes()).padStart(2, '0');
	const ampm = h >= 12 ? 'PM' : 'AM';
	h = h % 12 || 12;
	return `${mm}-${dd}, ${String(h).padStart(2, '0')}:${min}${ampm}`;
}

function formatTime(d: Date): string {
	return d.toLocaleTimeString('en-US', { hour12: false });
}

export const load: PageServerLoad = async ({ locals, depends }) => {
	depends('app:communication-hub');

	if (!locals.user?.company) {
		throw redirect(302, '/login');
	}

	const companyId = locals.user.company.id;

	try {
		const dbLogs = await prisma.communicationLog.findMany({
			where: { companyId },
			include: {
				communicationThread: { include: { contact: true } },
				customer: true
			},
			orderBy: { created: 'desc' },
			take: 100
		});

		const rows = dbLogs.map((log) => {
			const meta = (log.metadata as Record<string, any>) || {};
			const isOutbound = log.direction === 'outbound';

			const rawContactName =
				log.customer?.name || log.communicationThread?.contact?.name || '';
			const realName =
				rawContactName && !GENERIC_NAMES.includes(rawContactName) ? rawContactName : '';

			const customerValue = isOutbound ? log.destination : log.source;
			const companyValue = isOutbound ? log.source : log.destination;
			const customerNameOrPhone = realName || customerValue || '—';
			const companyNameOrPhone = companyValue || '—';

			// If inbound: customer is the source, company the endpoint. If outbound: reversed.
			const source = isOutbound ? companyNameOrPhone : customerNameOrPhone;
			const endpoint = isOutbound ? customerNameOrPhone : companyNameOrPhone;

			// Disposition: prefer the pipeline's classification, then thread/log status,
			// finally a plain direction word. Derived from real data only.
			const disposition =
				cap(meta.message_category) ||
				cap(meta.category_gpt) ||
				cap(meta.intent) ||
				(log.communicationThread?.status ? cap(log.communicationThread.status) : '') ||
				(log.status ? cap(String(log.status).replace(/_/g, ' ')) : '') ||
				(isOutbound ? 'Sent' : 'Received');

			return {
				id: log.id,
				date: formatDate(log.created),
				time: formatTime(log.created),
				type: log.type,
				direction: isOutbound ? 'Out' : 'In',
				source,
				endpoint,
				ext: '',
				company: log.customer?.companyName || '',
				disposition,
				// Fields used by the AI Summary popup.
				commId: commCode(log.communicationThreadId, log.id),
				category: cap(meta.message_category) || cap(meta.category_gpt) || cap(meta.intent) || 'General',
				subCategory: cap(meta.subcat_gpt) || cap(meta.sub_intent) || 'General',
				email: log.type === 'email' ? (isOutbound ? log.destination : log.source) || '' : source,
				subject: meta.subject || log.summary || 'No subject',
				body: log.content || log.summary || '',
				summary: log.summary || log.content || '',
				task:
					Array.isArray(meta.actionItems) && meta.actionItems.length
						? meta.actionItems.join('; ')
						: Array.isArray(meta.tasks) && meta.tasks.length
							? meta.tasks.join('; ')
							: ''
			};
		});

		return { rows };
	} catch (err) {
		console.error('Error loading communication hub:', err);
		return { rows: [] };
	}
};
