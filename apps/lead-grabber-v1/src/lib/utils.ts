import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function normalizeUrl(baseUrl: string, path: string): string {
	const normalizedBase = (baseUrl || '').replace(/\/+$/, '');
	const normalizedPath = path.startsWith('/') ? path : `/${path}`;
	return `${normalizedBase}${normalizedPath}`;
}

const getRepInfo = async (representativeId: string) => {
	try {
		if (!representativeId || representativeId === 'null' || representativeId === 'undefined') {
			console.warn('Invalid representative ID provided to getRepInfo:', representativeId);
			return null;
		}

		const response = await fetch(`/api/representatives/${representativeId}`);
		if (response.ok) {
			const data = await response.json();
			return data.representative;
		}
		return null;
	} catch (error) {
		console.error('Error fetching representative:', error);
		return null;
	}
};

export { getRepInfo };
