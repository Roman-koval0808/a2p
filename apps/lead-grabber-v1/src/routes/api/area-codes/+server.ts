import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import US_AREA_CODES from '$lib/data/area-codes-us.json';
import CA_AREA_CODES from '$lib/data/area-codes-ca.json';

// North American Numbering Plan (NANPA) area codes loaded from JSON
// Data source: https://www.nationalnanpa.com/

export const GET: RequestHandler = async ({ url }) => {
	try {
		const country = url.searchParams.get('country') || 'US';

		let areaCodes: Array<{ code: string; location: string }> = [];

		if (country === 'US') {
			areaCodes = US_AREA_CODES;
		} else if (country === 'CA') {
			areaCodes = CA_AREA_CODES;
		}

		return json({
			success: true,
			areaCodes,
			country
		});
	} catch (error) {
		console.error('Error fetching area codes:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
				areaCodes: []
			},
			{ status: 500 }
		);
	}
};
