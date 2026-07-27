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

function offsetMsAt(instant: Date, timeZone: string): number {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
	const p: Record<string, string> = {};
	for (const part of dtf.formatToParts(instant)) p[part.type] = part.value;
	const rendered = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
	return rendered - instant.getTime();
}

export function zonedNaiveToUtc(naive: string, timeZone = 'America/Toronto'): Date {
	const asIfUtc = new Date(`${naive}Z`);
	if (isNaN(asIfUtc.getTime())) return new Date(naive);
	const first = offsetMsAt(asIfUtc, timeZone);
	const refined = offsetMsAt(new Date(asIfUtc.getTime() - first), timeZone);
	return new Date(asIfUtc.getTime() - refined);
}

function pad(n: number) {
	return String(n).padStart(2, '0');
}

export function resolveRelativeDate(
	referenceTime: Date,
	transcriptWeekday?: string | null,
	transcriptDateStr?: string | null,
	hour = 10,
	minute = 0
): RelativeDateResolution {
	const ref = new Date(referenceTime);
	// We use the actual timezone offset for the current time to determine what day it is locally
	// But it's safer to just do a simple fallback if needed.

	// If explicit date string is present, e.g., "August 4th" or "2026-08-04"
	if (transcriptDateStr) {
		const parsedDate = parseDateString(transcriptDateStr, ref.getFullYear());
		if (parsedDate) {
			const naiveStr = `${parsedDate.getUTCFullYear()}-${pad(parsedDate.getUTCMonth() + 1)}-${pad(parsedDate.getUTCDate())}T${pad(hour)}:${pad(minute)}:00`;
			const finalDate = zonedNaiveToUtc(naiveStr, 'America/Toronto');

			// Check weekday consistency if weekday was also mentioned
			if (transcriptWeekday) {
				const expectedWeekday = WEEKDAYS[parsedDate.getUTCDay()];
				const actualWeekday = transcriptWeekday.toLowerCase().trim();
				if (!expectedWeekday.startsWith(actualWeekday.slice(0, 3))) {
					return {
						resolvedDate: finalDate,
						dateConfidence: 'conflict',
						hasConflict: true,
						conflictReason: `Weekday/date conflict: "${transcriptWeekday}" does not match date "${transcriptDateStr}" (which is a ${expectedWeekday})`
					};
				}
			}

			return {
				resolvedDate: finalDate,
				dateConfidence: 'exact',
				hasConflict: false,
				formattedExplicitText: formatDateExplicit(finalDate)
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
			const naiveStr = `${resolved.getUTCFullYear()}-${pad(resolved.getUTCMonth() + 1)}-${pad(resolved.getUTCDate())}T${pad(hour)}:${pad(minute)}:00`;
			const finalDate = zonedNaiveToUtc(naiveStr, 'America/Toronto');

			return {
				resolvedDate: finalDate,
				dateConfidence: 'inferred',
				hasConflict: false,
				formattedExplicitText: formatDateExplicit(finalDate)
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
