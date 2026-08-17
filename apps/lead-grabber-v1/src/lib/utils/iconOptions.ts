/**
 * Single source of truth for the icons offered in the leadbox builder UI.
 *
 * Every name here must have a matching file in `static/icons/lucide/<name>.svg`
 * (loaded at runtime by `getSvgIcon`) *and* an inline entry in
 * `src/lib/embed/icons.ts` (used by the embed script, which cannot fetch).
 */
export const iconOptions = [
	{ icon: 'Phone', name: 'Phone' },
	{ icon: 'Smartphone', name: 'Mobile' },
	{ icon: 'MessageSquare', name: 'Message' },
	{ icon: 'Play', name: 'Play' },
	{ icon: 'PlayCircle', name: 'Play Circle' },
	{ icon: 'Mail', name: 'Mail' },
	{ icon: 'Map', name: 'Map' },
	{ icon: 'Target', name: 'Target' },
	{ icon: 'Clock', name: 'Clock' },
	{ icon: 'Calendar', name: 'Calendar' },
	{ icon: 'CreditCard', name: 'Card' },
	{ icon: 'Search', name: 'Search' }
] as const;

export const iconNames = iconOptions.map((o) => o.icon);
