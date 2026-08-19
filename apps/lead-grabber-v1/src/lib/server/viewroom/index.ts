import { prisma } from '$lib/db';
import type { CompanyMember } from 'clearsky-db-client';

type AuthUser = {
	id: string;
	companyId?: string | null;
	company?: { id: string } | null;
};

const DEFAULT_SCHEDULE: Record<string, string> = {
	monday: '9:00 AM - 5:00 PM',
	tuesday: '9:00 AM - 5:00 PM',
	wednesday: '9:00 AM - 5:00 PM',
	thursday: '9:00 AM - 5:00 PM',
	friday: '9:00 AM - 5:00 PM',
	saturday: '',
	sunday: ''
};

export function resolveCompanyId(user: AuthUser): string | null {
	return user.companyId ?? user.company?.id ?? null;
}

function to12h(hhmm: string): string {
	const [h, m] = hhmm.split(':').map(Number);
	if (isNaN(h)) return hhmm;
	const period = h >= 12 ? 'PM' : 'AM';
	const hour12 = h % 12 || 12;
	return `${hour12}:${String(m ?? 0).padStart(2, '0')} ${period}`;
}

function convertSchedule(schedule: unknown): Record<string, string> {
	if (!schedule || typeof schedule !== 'object') return { ...DEFAULT_SCHEDULE };
	const out: Record<string, string> = { ...DEFAULT_SCHEDULE };
	const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
	const caps = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	for (let i = 0; i < days.length; i++) {
		const raw = (schedule as any)[days[i]] ?? (schedule as any)[caps[i]] ?? (schedule as any)[days[i].toUpperCase()];
		if (!raw) {
			out[days[i]] = '';
			continue;
		}
		if (typeof raw === 'string') {
			out[days[i]] = raw;
		} else if (raw && typeof raw === 'object' && raw.start != null && raw.end != null) {
			if (!raw.start || !raw.end) {
				out[days[i]] = '';
			} else {
				out[days[i]] = `${to12h(String(raw.start))} - ${to12h(String(raw.end))}`;
			}
		} else {
			out[days[i]] = '';
		}
	}
	return out;
}

function memberProfile(member: CompanyMember): any {
	return member.profileData && typeof member.profileData === 'object' ? member.profileData : {};
}

/** Map a2p CompanyMember (+User) into the viewroom representative record shape. */
export function toRepresentative(member: CompanyMember & { user?: { id: string; name?: string | null; email?: string | null; avatar?: string | null } | null }): any {
	const profile = memberProfile(member);
	const user = member.user;
	const name = user?.name ?? profile.name ?? (profile.firstName && profile.lastName ? `${profile.firstName} ${profile.lastName}` : (user?.email ?? 'Unknown'));
	const schedule = (member as any).viewroomSchedule ?? convertSchedule(profile.schedule);
	const scheduledMeetings = (member as any).viewroomScheduledMeetings ?? null;
	const location = (member as any).viewroomLocation ?? (profile.location ? { name: String(profile.location), address: '' } : null);

	return {
		id: member.id,
		name,
		first_name: profile.firstName ?? user?.name ?? null,
		last_name: profile.lastName ?? null,
		email: user?.email ?? '',
		phone: profile.phone ?? '',
		avatar: user?.avatar ?? null,
		company: member.companyId,
		is_active: member.status === 'active',
		schedule: schedule ?? { ...DEFAULT_SCHEDULE },
		scheduled_meetings: scheduledMeetings ?? null,
		location: location ? (typeof location === 'string' ? location : location.name) : null,
		expand: {
			location: location && typeof location === 'object' && location.name
				? { id: member.id, name: location.name, address: location.address ?? '' }
				: null
		}
	};
}

export async function getCompanyReps(companyId: string): Promise<any[]> {
	const members = await prisma.companyMember.findMany({
		where: { companyId, role: 'member', status: 'active' },
		include: { user: { select: { id: true, name: true, email: true, avatar: true } } },
		orderBy: { created: 'desc' }
	});
	return members.map(toRepresentative);
}

export async function getCompanyRepsIncludeInactive(companyId: string): Promise<any[]> {
	const members = await prisma.companyMember.findMany({
		where: { companyId, role: 'member' },
		include: { user: { select: { id: true, name: true, email: true, avatar: true } } },
		orderBy: { created: 'desc' }
	});
	return members.map(toRepresentative);
}

export async function getRepById(repId: string): Promise<any | null> {
	const member = await prisma.companyMember.findUnique({
		where: { id: repId },
		include: { user: { select: { id: true, name: true, email: true, avatar: true } } }
	});
	return member ? toRepresentative(member) : null;
}

export function toContentItem(item: any): any {
	return {
		id: item.id,
		title: item.title,
		description: item.description,
		type: item.type,
		file: item.file,
		thumbnail: item.thumbnail,
		owner_company: item.ownerCompanyId,
		shared_with: item.sharedWith ?? [],
		library_type: item.libraryType ?? [],
		active: item.active ?? true,
		created: item.created,
		updated: item.updated
	};
}

export async function getCompanyContent(companyId: string): Promise<any[]> {
	const items = await prisma.contentLibraryItem.findMany({
		where: { ownerCompanyId: companyId },
		orderBy: { created: 'desc' }
	});
	return items.map(toContentItem);
}

export async function getContentById(id: string): Promise<any | null> {
	const item = await prisma.contentLibraryItem.findUnique({ where: { id } });
	return item ? toContentItem(item) : null;
}

export function toRoom(room: any): any {
	return {
		id: room.id,
		room_id: room.roomId,
		title: room.title,
		owner_company: room.ownerCompanyId,
		is_active: room.isActive,
		host_content: room.hostContent ?? [],
		representative_content: room.representativeContent ?? [],
		representative: room.representative ?? [],
		scheduled: room.scheduled ?? false,
		schedule_time: room.scheduleTime ?? null,
		customer_name: room.customerName ?? null,
		customer_email: room.customerEmail ?? null,
		customer_phone: room.customerPhone ?? null,
		additional_information: room.additionalInformation ?? null,
		representative_id: room.representativeId ?? null,
		content_active_state: room.contentActiveState ?? null,
		created: room.created,
		updated: room.updated
	};
}

export async function getRoomByRoomIdOrId(roomIdParam: string): Promise<any | null> {
	const room = await prisma.viewRoom.findFirst({
		where: { OR: [{ roomId: roomIdParam }, { id: roomIdParam }] }
	});
	return room ? toRoom(room) : null;
}

export async function getRoomFull(roomIdParam: string): Promise<any | null> {
	const room = await prisma.viewRoom.findFirst({
		where: { OR: [{ roomId: roomIdParam }, { id: roomIdParam }] },
		include: { ownerCompany: { select: { id: true, name: true } } }
	});
	if (!room) return null;

	const out = toRoom(room);

	let roomRepresentatives: any[] = [];
	const repIds: string[] = room.representative ?? [];
	if (repIds.length > 0) {
		const members = await prisma.companyMember.findMany({
			where: { id: { in: repIds } },
			include: { user: { select: { id: true, name: true, email: true, avatar: true } } }
		});
		roomRepresentatives = members.map(toRepresentative);
	}

	let expandedHostContent: any[] = [];
	let expandedRepContent: any[] = [];
	const hostContentIds: string[] = room.hostContent ?? [];
	const repContentIds: string[] = room.representativeContent ?? [];
	if (hostContentIds.length > 0) {
		const items = await prisma.contentLibraryItem.findMany({
			where: { id: { in: hostContentIds }, active: true }
		});
		expandedHostContent = items.map(toContentItem);
	}
	if (repContentIds.length > 0) {
		const items = await prisma.contentLibraryItem.findMany({
			where: { id: { in: repContentIds }, active: true }
		});
		expandedRepContent = items.map(toContentItem);
	}

	const contentActiveState = (room.contentActiveState as Record<string, Record<string, boolean>> | null) ?? {};

	return {
		...out,
		representatives: roomRepresentatives,
		host_content_active: contentActiveState.host_content_active ?? {},
		representative_content_active: contentActiveState.representative_content_active ?? {},
		expand: {
			representative: roomRepresentatives,
			host_content: expandedHostContent,
			representative_content: expandedRepContent
		},
		company: room.ownerCompany
			? { id: room.ownerCompany.id, name: room.ownerCompany.name ?? null }
			: null
	};
}

export async function getRoomsForCompany(companyId: string): Promise<any[]> {
	const rooms = await prisma.viewRoom.findMany({
		where: { ownerCompanyId: companyId },
		orderBy: { created: 'desc' }
	});
	return rooms.map(toRoom);
}