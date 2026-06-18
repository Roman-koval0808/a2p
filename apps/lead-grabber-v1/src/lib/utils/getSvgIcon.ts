export async function getSvgIcon(name: string) {
	try {
		const response = await fetch(`/icons/lucide/${name}.svg`);
		const svgText = await response.text();
		return svgText;
	} catch (error) {
		console.error(`Error loading SVG icon ${name}:`, error);
		return '';
	}
}
