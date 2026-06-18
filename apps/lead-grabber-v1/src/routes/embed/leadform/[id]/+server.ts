import { prisma } from '$lib/db';
import { error } from '@sveltejs/kit';
import { PUBLIC_BASE_URL } from '$env/static/public';
import { buildLeadformScript } from '$lib/embed/leadform-builder';

export async function GET({ params, request, locals }) {
	try {
		let form;
		let company;

		if (params.id === 'default') {
			// Get the most recently created form
			form = await prisma.leadform.findFirst({
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
			if (form) {
				company = form.owner;
			}
		} else {
			form = await prisma.leadform.findUnique({
				where: { id: params.id },
				include: {
					owner: {
						include: {
							company: true
						}
					}
				}
			});
			if (form) {
				company = form.owner;
			}
		}

		if (!form) {
			throw error(404, 'Form not found');
		}

		if (!company?.company) {
			throw error(404, 'Company not found');
		}

		// Parse form_data if it's a string
		let formData = form.formData;
		if (typeof formData === 'string') {
			try {
				formData = JSON.parse(formData);
			} catch {
				formData = {};
			}
		}

		const jsCode = buildLeadformScript({
			id: params.id,
			formData: formData || {},
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
		console.error('Error generating form script:', err);
		return new Response('Error generating form script', {
			status: err.status || 500,
			headers: {
				'Content-Type': 'text/plain',
				'Access-Control-Allow-Origin': '*'
			}
		});
	}
}
