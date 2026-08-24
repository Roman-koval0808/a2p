// Shared helpers for the AI assistants feature, ported from the standalone viewroom app.
//
// Two things changed in the port and both are load-bearing:
//   * The viewroom stored assistants in PocketBase and their training files in Drizzle. Here both
//     live in the main Prisma database, and assistants carry a `companyId` because a2p is
//     multi-tenant — the viewroom's table had no tenant column.
//   * Training files reuse the existing `ContentLibraryItem` table (`content_library`) rather than
//     a second file store. An assistant's `trainingFiles` is a list of those ids.

import { prisma } from '$lib/db';
import { env } from '$env/dynamic/private';
import { getContentType, uploadToBunnyCDN } from '$lib/upload/bunny';

/** Marks a content-library row as an assistant's knowledge-base file. */
export const AI_TRAINING_LIBRARY_TYPE = 'ai_training';

export interface AuthedCompany {
	companyId: string;
}

/**
 * Upload one training file to Bunny and record it in the content library.
 * Returns the new ContentLibraryItem id, or null when the upload could not be completed —
 * callers skip those rather than failing the whole request.
 */
export async function storeTrainingFile(file: File, companyId: string): Promise<string | null> {
	const zone = env.BUNNY_STORAGE_ZONE_NAME;
	const key = env.BUNNY_ACCESS_KEY;
	if (!zone || !key) {
		console.error('[ai-assistants] Bunny storage is not configured; cannot store training file');
		return null;
	}

	const url = await uploadToBunnyCDN(file, zone, key, env.BUNNY_REGION);
	if (!url) return null;

	const row = await prisma.contentLibraryItem.create({
		data: {
			title: file.name,
			type: file.type || getContentType(file.name),
			file: url,
			ownerCompanyId: companyId,
			libraryType: [AI_TRAINING_LIBRARY_TYPE]
		},
		select: { id: true }
	});
	return row.id;
}

/**
 * Load an assistant, scoped to the company. Returns null when it does not exist OR belongs to
 * another tenant — the caller cannot tell the two apart, which is deliberate.
 */
export async function getAssistantForCompany(id: string, companyId: string) {
	return prisma.aiAssistant.findFirst({ where: { id, companyId } });
}

/** The content-library rows behind an assistant's `trainingFiles`, scoped to the company. */
export async function getTrainingFiles(fileIds: string[], companyId: string) {
	if (!fileIds.length) return [];
	return prisma.contentLibraryItem.findMany({
		where: { id: { in: fileIds }, ownerCompanyId: companyId },
		select: { id: true, title: true, type: true, file: true, created: true }
	});
}

/** All content-library rows marked as ai_training for the company. */
export async function getAllTrainingFilesForCompany(companyId: string) {
	return prisma.contentLibraryItem.findMany({
		where: { ownerCompanyId: companyId, libraryType: { has: AI_TRAINING_LIBRARY_TYPE } },
		select: { id: true, title: true, type: true, file: true, created: true },
		orderBy: { created: 'desc' }
	});
}
