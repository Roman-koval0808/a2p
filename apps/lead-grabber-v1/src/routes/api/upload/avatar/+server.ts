import { saveUploadedFile } from '$lib/utils/file-upload';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth, unauthorized } from '$lib/api/spec';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const auth = requireAuth(locals);
		if (!auth) return unauthorized();

		const formData = await request.formData();
		const avatar = formData.get('avatar') as File | null;

		if (!avatar) {
			return json({ success: false, error: 'No file provided in field "avatar"' }, { status: 400 });
		}

		// Generate a unique filename for the avatar
		const filename = `avatar-${Date.now()}-${Math.random().toString(36).substring(7)}`;

		// Use the existing file upload utility
		const filePath = await saveUploadedFile(avatar, filename);

		return json({
			success: true,
			data: { url: filePath },
			message: 'Avatar uploaded successfully'
		});
	} catch (error: any) {
		console.error('Error uploading avatar:', error);
		return json(
			{ success: false, error: error.message || 'Failed to upload avatar' },
			{ status: 500 }
		);
	}
};
