import { saveUploadedFile } from '$lib/utils/file-upload';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const formData = await request.formData();
		const logo = formData.get('logo') as File;
		const type = formData.get('type')?.toString() || 'company';

		if (!logo) {
			return json({ error: 'No file provided' }, { status: 400 });
		}

		// Generate filename based on type
		const filename = `${type}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
		const filePath = await saveUploadedFile(logo, filename);

		return json({ url: filePath });
	} catch (error: any) {
		console.error('Error uploading logo:', error);
		return json({ error: error.message || 'Failed to upload logo' }, { status: 500 });
	}
};
