import { PUBLIC_BASE_URL } from '$env/static/public';
import { normalizeUrl } from '$lib/utils';

export function getLeadboxEmbedCode(id: string = 'default') {
	const url = normalizeUrl(PUBLIC_BASE_URL, `/embed/leadbox/${id}?t=${Date.now()}`);
	return `<script src="${url}"></script>`;
}

export function getLeadformEmbedCode(id: string = 'default') {
	const url = normalizeUrl(PUBLIC_BASE_URL, `/embed/leadform/${id}?t=${Date.now()}`);
	return `<script src="${url}"></script>`;
}
