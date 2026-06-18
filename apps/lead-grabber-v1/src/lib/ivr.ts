import type { PrismaClient } from '@prisma/client';
import { normalizeUrl } from './utils';

const DAY_MAP: Record<number, string> = {
	0: 'Sun',
	1: 'Mon',
	2: 'Tue',
	3: 'Wed',
	4: 'Thu',
	5: 'Fri',
	6: 'Sat'
};

function parseTime(s: string): number | null {
	if (!s || typeof s !== 'string') return null;
	const trimmed = s.trim();
	const parts = trimmed.split(/[:\s]+/);
	if (parts.length < 2) return null;
	let h = parseInt(parts[0], 10);
	const m = parseInt(parts[1], 10);
	if (Number.isNaN(h) || Number.isNaN(m)) return null;
	const suffix = (parts[2] ?? '').toLowerCase();
	if (suffix === 'pm' || suffix === 'p') {
		if (h < 12) h += 12;
	} else if (suffix === 'am' || suffix === 'a') {
		if (h === 12) h = 0;
	}
	return h * 60 + m;
}

type ScheduleRecord = Record<string, { start?: string; end?: string } | null>;

function normalizeSchedule(raw: unknown): ScheduleRecord | null {
	if (raw == null) return null;
	if (typeof raw === 'string') {
		try {
			raw = JSON.parse(raw) as ScheduleRecord;
		} catch {
			return null;
		}
	}
	if (typeof raw !== 'object' || Array.isArray(raw)) return null;
	return raw as ScheduleRecord;
}

/** True if schedule is empty/null (always active) or current time is within the rule's window. */
function isActiveBySchedule(
	rawSchedule: unknown,
	day: string,
	minutesSinceMidnight: number
): boolean {
	const schedule = normalizeSchedule(rawSchedule);
	// No schedule or empty = default 24/7
	if (!schedule || Object.keys(schedule).length === 0) return true;
	const daySchedule = schedule[day];
	if (daySchedule == null || typeof daySchedule !== 'object') return false;
	// Accept both API shape (start/end) and form shape (start1/end1)
	const start =
		(daySchedule as { start?: string; end?: string; start1?: string; end1?: string }).start ??
		(daySchedule as { start1?: string; end1?: string }).start1;
	const end =
		(daySchedule as { start?: string; end?: string; start1?: string; end1?: string }).end ??
		(daySchedule as { start1?: string; end1?: string }).end1;
	if (!start || !end) return false;
	const startMin = parseTime(start);
	const endMin = parseTime(end);
	if (startMin == null || endMin == null) return false;
	if (startMin <= endMin) return minutesSinceMidnight >= startMin && minutesSinceMidnight <= endMin;
	return minutesSinceMidnight >= startMin || minutesSinceMidnight <= endMin;
}

function isValidTimezone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/** Get day (e.g. "Tue") and minutes-since-midnight in the given IANA timezone. */
function getDayAndMinutesInZone(
	now: Date,
	timezone: string
): { day: string; minutesSinceMidnight: number } {
	const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
	const day = dayFormatter.format(now);
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		hour: 'numeric',
		minute: '2-digit',
		hour12: false
	}).formatToParts(now);
	const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
	const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
	return { day, minutesSinceMidnight: hour * 60 + minute };
}

export async function getActiveCallFlow(
	prisma: PrismaClient,
	companyId: string,
	now: Date = new Date(),
	opts?: { timezone?: string; flowId?: string }
): Promise<{
	flow: { id: string; title: string; greetingAudioUrl: string | null };
	rule: {
		id: string;
		ruleTitle: string;
		promptsAudioUrl: string | null;
		keyPrompts: unknown;
		failoverCount: number;
		failoverDelayMinutes: number;
		failoverAudioUrl: string | null;
		hangupAudioUrl: string | null;
	};
} | null> {
	const where: { companyId: string; id?: string } = { companyId };
	if (opts?.flowId) where.id = opts.flowId;
	const flows = await prisma.callFlow.findMany({
		where,
		include: { rules: true },
		orderBy: { updated: 'desc' }
	});
	const { day, minutesSinceMidnight } =
		opts?.timezone && isValidTimezone(opts.timezone)
			? getDayAndMinutesInZone(now, opts.timezone)
			: {
					day: DAY_MAP[now.getDay()],
					minutesSinceMidnight: now.getHours() * 60 + now.getMinutes()
				};
	for (const flow of flows) {
		for (const rule of flow.rules) {
			if (!isActiveBySchedule(rule.schedule, day, minutesSinceMidnight)) continue;
			return {
				flow: {
					id: flow.id,
					title: flow.title,
					greetingAudioUrl: flow.greetingAudioUrl
				},
				rule: {
					id: rule.id,
					ruleTitle: rule.ruleTitle,
					promptsAudioUrl: rule.promptsAudioUrl,
					keyPrompts: rule.keyPrompts,
					failoverCount: rule.failoverCount,
					failoverDelayMinutes: rule.failoverDelayMinutes,
					failoverAudioUrl: rule.failoverAudioUrl,
					hangupAudioUrl: rule.hangupAudioUrl
				}
			};
		}
	}
	return null;
}

export function toAbsoluteAudioUrl(
	path: string | null | undefined,
	baseUrl: string
): string | null {
	if (!path) return null;
	if (path.startsWith('http')) return path;
	return normalizeUrl(baseUrl, path);
}
