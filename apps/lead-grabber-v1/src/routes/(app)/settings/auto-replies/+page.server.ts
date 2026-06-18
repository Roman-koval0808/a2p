import { prisma } from '$lib/db';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const defaultAutoReply = {
	textAutoReply: false,
	businessHoursMessage: 'Hello, thank you for messaging us. Our team will respond shortly.',
	afterHoursMessage:
		'Hello, we are not available at the moment, but we will get in touch with you by {date}.',
	leadformBusinessHoursMessage:
		'Hello, thank you for submitting the form. Our team will respond shortly.',
	leadformAfterHoursMessage:
		'Hello, we are not available at the moment, but we will get in touch with you by {date}.',
	businessHours: {
		sunday: { isOpen: false, hours: null },
		monday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
		tuesday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
		wednesday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
		thursday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
		friday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
		saturday: { isOpen: false, hours: null }
	}
};

function parseSettings(settings: unknown): Record<string, unknown> {
	if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
	return settings as Record<string, unknown>;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) throw redirect(303, '/login');
	if (!user.company) throw redirect(303, '/create-company');

	try {
		const company = await prisma.company.findUnique({
			where: { id: user.company.id },
			select: { settings: true }
		});

		const settings = parseSettings(company?.settings);
		const autoReply = (
			settings.autoReply &&
			typeof settings.autoReply === 'object' &&
			!Array.isArray(settings.autoReply)
				? settings.autoReply
				: defaultAutoReply
		) as typeof defaultAutoReply;

		return { autoReply };
	} catch (error) {
		console.error('Error loading auto-reply settings:', error);
		return { autoReply: defaultAutoReply };
	}
};

export const actions: Actions = {
	saveAutoReply: async ({ request, locals }) => {
		const user = locals.user;
		if (!user?.company) return fail(401, { error: 'Unauthorized' });

		try {
			const form = await request.formData();
			const autoReplyDataStr = form.get('autoReplyData')?.toString();
			if (!autoReplyDataStr) return fail(400, { error: 'Missing autoReplyData' });

			const autoReplyData = JSON.parse(autoReplyDataStr) as typeof defaultAutoReply;

			const company = await prisma.company.findUnique({
				where: { id: user.company.id },
				select: { settings: true }
			});

			const settings = parseSettings(company?.settings);
			settings.autoReply = {
				textAutoReply: autoReplyData.textAutoReply ?? false,
				businessHoursMessage:
					autoReplyData.businessHoursMessage ?? defaultAutoReply.businessHoursMessage,
				afterHoursMessage: autoReplyData.afterHoursMessage ?? defaultAutoReply.afterHoursMessage,
				leadformBusinessHoursMessage:
					autoReplyData.leadformBusinessHoursMessage ??
					defaultAutoReply.leadformBusinessHoursMessage,
				leadformAfterHoursMessage:
					autoReplyData.leadformAfterHoursMessage ?? defaultAutoReply.leadformAfterHoursMessage,
				businessHours: autoReplyData.businessHours ?? defaultAutoReply.businessHours
			};

			await prisma.company.update({
				where: { id: user.company.id },
				data: { settings }
			});

			return { type: 'success' };
		} catch (error) {
			console.error('Error saving auto-reply settings:', error);
			return fail(500, { error: 'Failed to save settings' });
		}
	}
};
