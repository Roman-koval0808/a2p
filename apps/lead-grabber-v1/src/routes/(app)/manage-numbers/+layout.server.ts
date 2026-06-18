import type { LayoutServerLoad } from './$types';
import { ensureCompanyNumbersAssignedToApp } from '$lib/server/telnyx';

export const load: LayoutServerLoad = async ({ parent }) => {
	const data = await parent();
	// Sync: assign any company numbers (from DB) that aren't on the app yet
	await ensureCompanyNumbersAssignedToApp();
	return data;
};
