import { prisma } from '$lib/db';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) throw redirect(303, '/login');
	if (!user.company) throw redirect(303, '/create-company');

	try {
		const existing = await prisma.leadform.findFirst({
			where: { ownerId: user.id },
			orderBy: { updated: 'desc' }
		});

		const form = existing
			? {
					id: existing.id,
					name: existing.name,
					form_data:
						existing.formData &&
						typeof existing.formData === 'object' &&
						!Array.isArray(existing.formData)
							? (existing.formData as { settings?: unknown; formElements?: unknown })
							: { settings: {}, formElements: [] },
					created: existing.created.toISOString(),
					updated: existing.updated.toISOString()
				}
			: null;

		return { user, form };
	} catch (error) {
		console.error('Error loading form:', error);
		return { user, form: null };
	}
};

export const actions: Actions = {
	saveForm: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) return fail(401, { success: false, message: 'Unauthorized' });

		try {
			const form = await request.formData();
			const formDataJson = form.get('formData')?.toString();
			if (!formDataJson) return fail(400, { success: false, message: 'Invalid form data' });

			const parsedData = JSON.parse(formDataJson) as {
				settings?: { heading?: string };
				formElements?: unknown;
			};

			const formDataToSave = {
				formData: {
					settings: parsedData.settings ?? {},
					formElements: parsedData.formElements ?? []
				},
				name: parsedData.settings?.heading ?? 'Contact Form'
			};

			const existing = await prisma.leadform.findFirst({
				where: { ownerId: user.id }
			});

			let result;
			if (existing) {
				result = await prisma.leadform.update({
					where: { id: existing.id },
					data: formDataToSave
				});
			} else {
				result = await prisma.leadform.create({
					data: {
						...formDataToSave,
						ownerId: user.id
					}
				});
			}

			return {
				success: true,
				message: 'Form saved successfully!',
				form: result
			};
		} catch (error) {
			console.error('Error saving form:', error);
			return fail(500, { success: false, message: 'Error saving form. Please try again.' });
		}
	}
} satisfies Actions;
