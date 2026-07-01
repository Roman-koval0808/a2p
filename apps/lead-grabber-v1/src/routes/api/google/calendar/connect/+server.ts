import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthUrl, isGoogleConfigured } from '$lib/server/google-calendar';

// Kicks off the Google OAuth consent flow for the logged-in user's company.
export const GET: RequestHandler = async ({ locals }) => {
	const companyId = locals.user?.company?.id;
	if (!companyId) throw redirect(303, '/login');
	if (!isGoogleConfigured()) {
		throw error(
			500,
			'Google Calendar is not configured on the server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'
		);
	}
	throw redirect(302, getAuthUrl(companyId));
};
