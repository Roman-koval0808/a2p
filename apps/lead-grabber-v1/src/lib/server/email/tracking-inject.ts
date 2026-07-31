import { mintCsToken } from './tracking';
import { PUBLIC_BASE_URL } from '$env/static/public';

export interface TrackingInjectionResult {
	htmlContent: string;
	csToken: string;
}

export async function injectEmailTracking(
	htmlContent: string,
	contactId: string,
	companyId: string,
	baseUrl?: string,
	commLogId?: string
): Promise<TrackingInjectionResult> {
	const csToken = await mintCsToken(contactId, companyId, commLogId);
	const origin = baseUrl || PUBLIC_BASE_URL;

	const trackingPixel = `<img src="${origin}/api/track/open?t=${csToken}" width="1" height="1" style="display:none" />`;

	const clickWrapped = htmlContent.replace(
		/<a\s+([^>]*?)href\s*=\s*"([^"]+)"([^>]*?)>/gi,
		(_, before, url, after) => {
			const encoded = encodeURIComponent(url);
			return `<a ${before}href="${origin}/api/track/click?t=${csToken}&url=${encoded}"${after}>`;
		}
	);

	const withPixel = clickWrapped.includes('</body>')
		? clickWrapped.replace('</body>', `${trackingPixel}\n</body>`)
		: clickWrapped + '\n' + trackingPixel;

	return { htmlContent: withPixel, csToken };
}
