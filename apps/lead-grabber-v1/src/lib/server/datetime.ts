export interface RelativeDateResolution {
	resolvedDate: Date;
	dateConfidence: 'exact' | 'inferred' | 'conflict';
	hasConflict: boolean;
	conflictReason?: string;
	formattedExplicitText?: string;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS: Record<string, number> = {
	jan: 0, january: 0,
	feb: 1, february: 1,
	mar: 2, march: 2,
	apr: 3, april: 3,
	may: 4,
	jun: 5, june: 5,
	jul: 6, july: 6,
	aug: 7, august: 7,
	sep: 8, september: 8,
	oct: 9, october: 9,
	nov: 10, november: 10,
	dec: 11, december: 11
};

export function resolveRelativeDate(
	referenceTime: Date,
	transcriptWeekday?: string | null,
	transcriptDateStr?: string | null,
	hour = 10,
	minute = 0
): RelativeDateResolution {
	const ref = new Date(referenceTime);
	const refDayIndex = ref.getDay();

	// If explicit date string is present, e.g., "August 4th" or "2026-08-04"
	if (transcriptDateStr) {
		const parsedDate = parseDateString(transcriptDateStr, ref.getFullYear());
		if (parsedDate) {
			parsedDate.setUTCHours(hour, minute, 0, 0);

			// Check weekday consistency if weekday was also mentioned
			if (transcriptWeekday) {
				const expectedWeekday = WEEKDAYS[parsedDate.getUTCDay()];
				const actualWeekday = transcriptWeekday.toLowerCase().trim();
				if (!expectedWeekday.startsWith(actualWeekday.slice(0, 3))) {
					return {
						resolvedDate: parsedDate,
						dateConfidence: 'conflict',
						hasConflict: true,
						conflictReason: `Weekday/date conflict: "${transcriptWeekday}" does not match date "${transcriptDateStr}" (which is a ${expectedWeekday})`
					};
				}
			}

			return {
				resolvedDate: parsedDate,
				dateConfidence: 'exact',
				hasConflict: false,
				formattedExplicitText: formatDateExplicit(parsedDate)
			};
		}
	}

	// Bare weekday resolution ("Tuesday at 10")
	if (transcriptWeekday) {
		const targetDayName = transcriptWeekday.toLowerCase().trim();
		const targetDayIndex = WEEKDAYS.findIndex((w) => w.startsWith(targetDayName.slice(0, 3)));

		if (targetDayIndex !== -1) {
			const refDayIndex = ref.getUTCDay();
			let daysAhead = targetDayIndex - refDayIndex;
			if (daysAhead <= 0) daysAhead += 7; // Next occurrence

			const resolved = new Date(ref);
			resolved.setUTCDate(ref.getUTCDate() + daysAhead);
			resolved.setUTCHours(hour, minute, 0, 0);

			return {
				resolvedDate: resolved,
				dateConfidence: 'inferred',
				hasConflict: false,
				formattedExplicitText: formatDateExplicit(resolved)
			};
		}
	}

	return {
		resolvedDate: ref,
		dateConfidence: 'inferred',
		hasConflict: false
	};
}

function parseDateString(str: string, currentYear: number): Date | null {
	const clean = str.toLowerCase().replace(/(\d+)(st|nd|rd|th)/g, '$1').trim();
	const matches = clean.match(/([a-z]+)\s+(\d{1,2})/);
	if (matches) {
		const monthStr = matches[1];
		const dayNum = parseInt(matches[2], 10);
		if (MONTHS[monthStr] !== undefined && !isNaN(dayNum)) {
			return new Date(Date.UTC(currentYear, MONTHS[monthStr], dayNum, 10, 0));
		}
	}
	const dateObj = new Date(str);
	return isNaN(dateObj.getTime()) ? null : dateObj;
}

export function formatDateExplicit(d: Date): string {
	const options: Intl.DateTimeFormatOptions = {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZone: 'America/Toronto'
	};
	return d.toLocaleString('en-US', options);
}
