import { prisma } from '$lib/db';
import { env } from '$env/dynamic/private';

export interface NumberLookupResult {
	phoneNumber: string;
	lineType?: string;
	carrier?: string;
	raw?: any;
}

export async function lookupNumberCached(
	companyId: string,
	phoneNumber: string,
	tx?: any
): Promise<NumberLookupResult | null> {
	if (!phoneNumber) return null;
	const db = tx || prisma;

	const profile = await db.pipelineCustomerProfile.findFirst({
		where: { companyId, phoneNumber }
	});

	if (profile && profile.lineType && profile.carrier) {
		return {
			phoneNumber,
			lineType: profile.lineType,
			carrier: profile.carrier
		};
	}

	const apiKey = env.TELNYX_API_KEY;
	if (!apiKey) {
		return { phoneNumber, lineType: 'unknown', carrier: 'unknown' };
	}

	// Timeout promise (2s max) to ensure lookup NEVER blocks or gates emergency path (I-6)
	const fetchPromise = fetch(
		`https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(phoneNumber)}?type=carrier`,
		{
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			}
		}
	).then(async (res) => {
		if (!res.ok) return null;
		const json = await res.json();
		const data = json.data || {};
		const carrierData = data.carrier || {};
		return {
			phoneNumber,
			lineType: carrierData.type || 'unknown',
			carrier: carrierData.name || 'unknown',
			raw: data
		};
	});

	const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));

	try {
		const result = await Promise.race([fetchPromise, timeoutPromise]);
		if (result && profile) {
			await db.pipelineCustomerProfile.update({
				where: { id: profile.id },
				data: {
					lineType: result.lineType,
					carrier: result.carrier,
					lookupDate: new Date()
				}
			});
		}
		return result || { phoneNumber, lineType: 'unknown', carrier: 'unknown' };
	} catch (err) {
		console.warn('[NumberLookup] Lookup failed or timed out:', err);
		return { phoneNumber, lineType: 'unknown', carrier: 'unknown' };
	}
}
