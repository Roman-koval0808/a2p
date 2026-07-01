// Shared calendar helpers (no external deps) used by the orchestrator and the conversational
// SMS reply handler.

/** Checks if a requested datetime is within business hours of any location; falls back to 9-5 M-F. */
export function checkCalendarAvailability(datetimeStr: string, locations: any[]): boolean {
	const lower = (datetimeStr || '').toLowerCase();

	let reqDay: string | null = null;
	let reqHour24 = -1;

	const d = new Date(datetimeStr);
	if (!isNaN(d.getTime())) {
		const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thurs', 'Fri', 'Sat'];
		reqDay = days[d.getDay()];
		reqHour24 = d.getHours();
	} else {
		if (lower.includes('mon')) reqDay = 'Mon';
		else if (lower.includes('tue')) reqDay = 'Tue';
		else if (lower.includes('wed')) reqDay = 'Wed';
		else if (lower.includes('thu')) reqDay = 'Thurs';
		else if (lower.includes('fri')) reqDay = 'Fri';
		else if (lower.includes('sat')) reqDay = 'Sat';
		else if (lower.includes('sun')) reqDay = 'Sun';

		const amMatch = lower.match(/(\d{1,2})(?::\d{2})?\s*am/);
		const pmMatch = lower.match(/(\d{1,2})(?::\d{2})?\s*pm/);

		if (amMatch) {
			let h = parseInt(amMatch[1]);
			if (h === 12) h = 0;
			reqHour24 = h;
		} else if (pmMatch) {
			let h = parseInt(pmMatch[1]);
			if (h < 12) h += 12;
			reqHour24 = h;
		} else {
			const milMatch = lower.match(/(\d{1,2}):\d{2}/);
			if (milMatch) {
				reqHour24 = parseInt(milMatch[1]);
			}
		}
	}

	if (locations && locations.length > 0 && reqDay) {
		let isAvailableInAnyLocation = false;

		for (const loc of locations) {
			const hoursObj = loc.hours || {};
			const dayHours = hoursObj[reqDay];

			if (!dayHours || dayHours.toLowerCase() === 'closed') {
				continue;
			}

			if (reqHour24 !== -1) {
				const locMatch = dayHours
					.toLowerCase()
					.match(/(\d{1,2})(?::\d{2})?\s*(am|pm)\s*-\s*(\d{1,2})(?::\d{2})?\s*(am|pm)/);
				if (locMatch) {
					let startH = parseInt(locMatch[1]);
					if (locMatch[2] === 'pm' && startH < 12) startH += 12;
					if (locMatch[2] === 'am' && startH === 12) startH = 0;

					let endH = parseInt(locMatch[3]);
					if (locMatch[4] === 'pm' && endH < 12) endH += 12;
					if (locMatch[4] === 'am' && endH === 12) endH = 0;

					if (reqHour24 >= startH && reqHour24 < endH) {
						isAvailableInAnyLocation = true;
						break;
					}
				} else {
					// Hours string exists but isn't parseable → assume open.
					isAvailableInAnyLocation = true;
					break;
				}
			} else {
				// No hour specified, but the location is open on this day.
				isAvailableInAnyLocation = true;
				break;
			}
		}

		return isAvailableInAnyLocation;
	}

	// No location hours configured: fall back to standard business hours (9-5, Mon-Fri).
	if (reqDay) {
		if (reqDay === 'Sat' || reqDay === 'Sun') return false;
		if (reqHour24 === -1) return true; // weekday, no specific time requested
		return reqHour24 >= 9 && reqHour24 < 17;
	}

	// Couldn't determine the requested day → don't claim availability.
	return false;
}

/** Formats an ISO string into a readable date/time. Leaves relative strings alone. */
export function formatDatetime(datetimeStr: string): string {
	const d = new Date(datetimeStr);
	if (!isNaN(d.getTime()) && datetimeStr.includes('T')) {
		return d
			.toLocaleString('en-US', {
				weekday: 'long',
				month: 'long',
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit'
			})
			.replace(/, 20\d\d/, '');
	}
	return datetimeStr;
}

/** Human-readable summary of a company's business hours (for prompts / replies). */
export function describeBusinessHours(locations: any[]): string {
	if (locations && locations.length > 0) {
		const loc = locations.find((l) => l.hours) || locations[0];
		const hours = loc?.hours;
		if (hours && typeof hours === 'object') {
			const parts = Object.entries(hours)
				.filter(([, v]) => v && String(v).toLowerCase() !== 'closed')
				.map(([day, v]) => `${day} ${v}`);
			if (parts.length) return parts.join(', ');
		}
	}
	return 'Monday to Friday, 9am to 5pm';
}
