/**
 * Client-safe utility for getting file URLs
 * This can be used in both client and server code
 */
export function getFileUrl(filePath: string | null | undefined): string | null {
	if (!filePath) return null;
	// If it's already a full URL, return as-is
	if (filePath.startsWith('http')) return filePath;
	// Otherwise, return the static path
	return filePath.startsWith('/') ? filePath : `/${filePath}`;
}
