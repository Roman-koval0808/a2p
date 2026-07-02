import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exchangeCodeAndSave } from '$lib/server/google-calendar';

// Google redirects here after consent. `state` is the companyId we sent; it must match the
// logged-in user's company (prevents connecting someone else's calendar).
export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const oauthError = url.searchParams.get('error');
	const companyId = locals.user?.company?.id;

	if (oauthError || !code || !state || !companyId || companyId !== state) {
		throw redirect(303, '/settings/company?calendar=error');
	}

	const result = await exchangeCodeAndSave(code, companyId);
	// result: 'connected' | 'missing_scope' | 'error'
	throw redirect(303, `/settings/company?calendar=${result}`);
};
