export function formatDate(dateString: string | null | undefined): string {
	if (!dateString) return 'N/A';
	const date = new Date(dateString);
	if (isNaN(date.getTime())) return 'Invalid date';
	return new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	}).format(date);
}
