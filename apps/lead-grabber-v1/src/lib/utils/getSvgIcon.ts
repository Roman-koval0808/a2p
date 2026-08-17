export async function getSvgIcon(name: string) {
	try {
		// ?v= busts browser caches of the old copies, which hardcoded stroke="#ffffff"
		// and were therefore invisible on light backgrounds. Bump on any icon edit.
		const response = await fetch(`/icons/lucide/${name}.svg?v=2`);
		const svgText = await response.text();
		return svgText;
	} catch (error) {
		console.error(`Error loading SVG icon ${name}:`, error);
		return '';
	}
}
