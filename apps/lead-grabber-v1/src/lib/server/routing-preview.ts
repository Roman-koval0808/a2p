// Routing preview for the Leadbox editor.
//
// The leadbox edit page wants to show the business owner, before they ship the widget, what will
// actually happen when a customer uses each channel — given the reps they currently have and the
// auto-reply rules they currently have. This assembles that snapshot from the SAME pure functions
// the live dispatch paths use, so the preview cannot drift from what runs in production:
//
//   • Text Us        → text-message-routing.ts  (decideTextMessage, officeClosedReply)
//   • Request a Call → callback-routing.ts      (decideCallback, buildRepRota, isOpenAt, …)
//   • reps + hours   → callback-dispatch.ts     (loadReps, timeZoneFor, businessHoursFor)
//
// Nothing here decides; it only asks those functions "what happens right now?". The snapshot is
// taken at load time, so edits to reps or hours in another tab need a refresh to show up.

import { prisma } from '$lib/db';
import { getDefaultAutoReplySettings } from '$lib/utils/auto-reply';
import {
	decideCallback,
	buildRepRota,
	isOpenAt,
	isRepOnDuty,
	nextOpening,
	windowConfigFrom,
	DEFAULT_BUSINESS_TIME_ZONE,
	type RepRecord
} from './callback-routing';
import { loadReps, timeZoneFor, businessHoursFor } from './callback-dispatch';
import { decideTextMessage, officeClosedReply } from './text-message-routing';

export interface RepPreview {
	name: string;
	phone: string;
	onDutyNow: boolean;
	schedule: { day: string; start: string; end: string }[];
}

export interface BusinessHoursPreviewDay {
	day: string;
	isOpen: boolean;
	hours: string | null;
}

export interface RoutingPreview {
	timeZone: string;
	textAutoReply: boolean;
	now: string;
	openNow: boolean;
	nextOpening: string | null;
	nextOpeningText: string | null;
	onDutyNow: string[];
	onDutyAtOpening: string[];
	businessHours: BusinessHoursPreviewDay[];
	businessHoursMessage: string;
	afterHoursMessage: string;
	reps: RepPreview[];
	text: {
		action: 'route_to_rep' | 'after_hours';
		repName: string | null;
		reply: string | null;
	};
	call: {
		action: 'bridge_now' | 'schedule' | 'manual';
		repName: string | null;
		scheduleFor: string | null;
		reason: string;
	};
}

const WEEKDAYS = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday'
] as const;

function formatOpening(at: Date, timeZone: string): string {
	return at.toLocaleString('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZone
	});
}

function formatRepSchedule(rep: RepRecord): RepPreview['schedule'] {
	const schedule = rep.schedule ?? {};
	return WEEKDAYS.map((day) => {
		const shift = schedule[day] ?? schedule[day.charAt(0).toUpperCase() + day.slice(1)];
		return {
			day: day.charAt(0).toUpperCase() + day.slice(1),
			start: shift?.start ?? '',
			end: shift?.end ?? ''
		};
	});
}

export async function buildRoutingPreview(companyId: string): Promise<RoutingPreview> {
	const company = await prisma.company.findUnique({
		where: { id: companyId },
		select: { settings: true }
	});
	const settings = (company?.settings || {}) as Record<string, any>;
	const defaults = getDefaultAutoReplySettings();

	const timeZone = timeZoneFor(settings);
	const businessHours = businessHoursFor(settings);
	const textAutoReply = settings?.autoReply?.textAutoReply === true;
	const afterHoursMessage = settings?.autoReply?.afterHoursMessage ?? defaults.afterHoursMessage;
	const businessHoursMessage =
		settings?.autoReply?.businessHoursMessage ?? defaults.businessHoursMessage;

	const reps = await loadReps(companyId);
	const now = new Date();
	const openNow = isOpenAt(now, businessHours, timeZone);
	const opening = nextOpening(now, businessHours, timeZone);
	const rotaNow = buildRepRota({ reps, at: now, timeZone });
	const rotaAtOpening = buildRepRota({ reps, at: opening ?? now, timeZone });

	const textNow = decideTextMessage({ now, businessHours, timeZone });
	const callbackNow = decideCallback({
		preference: 'ASAP',
		now,
		businessHours,
		config: windowConfigFrom(settings),
		timeZone
	});

	// The person the text/call lands on: on-duty now, or on-duty at the next opening after hours.
	// Falls back to the first rep so a task still lands on a named person when nobody is rostered.
	const fallback = reps[0]?.name ?? null;

	// Sunday → Saturday, regardless of how the settings JSON stored its keys. The preview must read
	// in calendar order; a plain Object.entries() inherits the JSON's insertion order.
	const businessHoursDays: BusinessHoursPreviewDay[] = WEEKDAYS.map((day) => ({
		day: day.charAt(0).toUpperCase() + day.slice(1),
		isOpen: !!businessHours[day]?.isOpen,
		hours: businessHours[day]?.hours ?? null
	}));

	return {
		timeZone,
		textAutoReply,
		now: now.toISOString(),
		openNow,
		nextOpening: opening ? opening.toISOString() : null,
		nextOpeningText: opening ? formatOpening(opening, timeZone) : null,
		onDutyNow: rotaNow.map((r) => r.name),
		onDutyAtOpening: rotaAtOpening.map((r) => r.name),
		businessHours: businessHoursDays,
		businessHoursMessage,
		afterHoursMessage,
		reps: reps.map((r) => ({
			name: r.name,
			phone: r.phone,
			onDutyNow: isRepOnDuty(r, now, timeZone),
			schedule: formatRepSchedule(r)
		})),
		text: {
			action: textNow.action,
			repName:
				(textNow.action === 'route_to_rep' ? rotaNow[0]?.name : rotaAtOpening[0]?.name) ??
				fallback,
			reply:
				textNow.action === 'after_hours'
					? officeClosedReply({ template: afterHoursMessage, openAt: opening, timeZone })
					: null
		},
		call: {
			action: callbackNow.action,
			repName:
				(callbackNow.action === 'bridge_now' ? rotaNow[0]?.name : rotaAtOpening[0]?.name) ??
				fallback,
			scheduleFor:
				callbackNow.action === 'schedule'
					? formatOpening(callbackNow.callAt, timeZone)
					: null,
			reason: callbackNow.reason
		}
	};
}
