import { prisma } from '$lib/db';
import { error } from '@sveltejs/kit';
import { PUBLIC_BASE_URL } from '$env/static/public';
import { buildLeadboxScript } from '$lib/embed/leadbox-builder';

export async function GET({ params, request, locals }) {
	try {
		let leadbox;
		let company;

		if (params.id === 'default') {
			// Get the most recently created leadbox
			leadbox = await prisma.leadbox.findFirst({
				orderBy: {
					created: 'desc'
				},
				include: {
					owner: {
						include: {
							company: true
						}
					}
				}
			});
			if (leadbox) {
				company = leadbox.owner;
			}
		} else {
			leadbox = await prisma.leadbox.findUnique({
				where: { id: params.id },
				include: {
					owner: {
						include: {
							company: true
						}
					}
				}
			});
			if (leadbox) {
				company = leadbox.owner;
			}
		}

		if (!leadbox) {
			throw error(404, 'Leadbox not found');
		}

		if (!company?.company) {
			throw error(404, 'Company not found');
		}

		// Parse leadbox_data if it's a string
		let leadboxData = leadbox.leadboxData;
		if (typeof leadboxData === 'string') {
			try {
				leadboxData = JSON.parse(leadboxData);
			} catch {
				leadboxData = {};
			}
		}

		const jsCode = buildLeadboxScript({
			id: params.id,
			leadboxData: leadboxData || {},
			companyId: company.company.id,
			baseUrl: PUBLIC_BASE_URL
		});

		return new Response(jsCode, {
			headers: {
				'Content-Type': 'application/javascript',
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': 'no-cache, no-store, must-revalidate',
				Pragma: 'no-cache',
				Expires: '0'
			}
		});
	} catch (err: any) {
		console.error('Error generating leadbox script:', err);
		return new Response('Error generating leadbox script', {
			status: err.status || 500,
			headers: {
				'Content-Type': 'text/plain',
				'Access-Control-Allow-Origin': '*'
			}
		});
	}
}
