import { prisma } from '$lib/db';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;

	if (!user) {
		throw redirect(303, '/login');
	}

	if (!user.company) {
		throw redirect(303, '/create-company');
	}

	try {
		// Fetch the user's existing leadbox
		const existingLeadbox = await prisma.leadbox.findFirst({
			where: {
				ownerId: user.id
			},
			orderBy: {
				created: 'desc'
			}
		});

		// Get company logo for default
		const company = await prisma.company.findUnique({
			where: { id: user.company.id }
		});

		// Parse leadbox_data if it exists
		let leadboxData = null;
		if (existingLeadbox?.leadboxData) {
			try {
				leadboxData =
					typeof existingLeadbox.leadboxData === 'string'
						? JSON.parse(existingLeadbox.leadboxData)
						: existingLeadbox.leadboxData;
			} catch {
				leadboxData = existingLeadbox.leadboxData;
			}
		}

		// Use company logo as default if no logo in leadbox data
		// Don't override if leadbox already has a logo
		if (!leadboxData) {
			leadboxData = {};
		}
		if (!leadboxData.logoImage && company?.logo) {
			leadboxData.logoImage = company.logo;
		}

		const leadbox = existingLeadbox
			? {
					...existingLeadbox,
					leadbox_data: leadboxData
				}
			: null;

		return {
			user,
			leadbox,
			companyLogo: company?.logo || null
		};
	} catch (error) {
		console.error('Error loading leadbox:', error);
		return {
			user,
			leadbox: null,
			companyLogo: null
		};
	}
};

export const actions: Actions = {
	saveLeadbox: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) {
			return fail(401, { error: 'Unauthorized' });
		}

		try {
			const data = await request.formData();
			const leadboxDataJson = data.get('leadboxData');

			if (!leadboxDataJson || typeof leadboxDataJson !== 'string') {
				return fail(400, {
					success: false,
					message: 'Invalid leadbox data'
				});
			}

			const parsedData = JSON.parse(leadboxDataJson);

			const leadboxDataToSave = {
				leadboxData: parsedData,
				ownerId: user.id,
				name: 'Default Leadbox',
				status: 'active' as const
			};

			const existingLeadbox = await prisma.leadbox.findFirst({
				where: {
					ownerId: user.id
				}
			});

			let result;
			if (existingLeadbox) {
				result = await prisma.leadbox.update({
					where: { id: existingLeadbox.id },
					data: leadboxDataToSave
				});
			} else {
				result = await prisma.leadbox.create({
					data: leadboxDataToSave
				});
			}

			console.log('res', result);
			return {
				type: 'success',
				data: {
					message: 'Leadbox saved successfully!',
					leadbox: result
				}
			};
		} catch (error) {
			console.error('Error saving leadbox:', error);
			return fail(500, {
				type: 'error',
				message: 'Error saving leadbox. Please try again.'
			});
		}
	}
};
