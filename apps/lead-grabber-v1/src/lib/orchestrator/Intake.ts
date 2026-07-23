import { prisma } from '../db';
import { toE164 } from '../company-numbers';

export interface IntakeEvent {
    companyId: string;
    direction: 'inbound' | 'outbound';
    channel: 'voice' | 'sms' | 'email' | 'form';
    from_party?: string;
    to_party?: string;
    occurred_at: Date;
    recording_url?: string;
    // For inbound, this is the IVR option + keyword extraction or initial classification
    initial_thread_type?: string; 
}

export async function processIntake(event: IntakeEvent) {
    // 1. Identity Resolution (Step 1 - ANI match)
    const phone = event.direction === 'inbound' ? event.from_party : event.to_party;
    const cleanPhone = phone ? toE164(phone) : null;
    
    let personId: string | null = null;
    let identityConfidence = 0.0;
    let identityMethod = 'none';

    if (cleanPhone) {
        // Find person by phone identifier
        const persons = await prisma.person.findMany({
            where: { companyId: event.companyId }
        });
        
        const matches = persons.filter(p => {
            const ids = (p.identifiers as any[]) || [];
            return ids.some(id => id.type === 'phone' && id.value === cleanPhone);
        });

        if (matches.length === 1) {
            personId = matches[0].person_id;
            identityConfidence = 1.0;
            identityMethod = 'ani_exact';
        } else if (matches.length > 1) {
            // Multiple profiles: attach to most recently active (or just first for now) and flag for review.
            personId = matches[0].person_id;
            identityConfidence = 0.5;
            identityMethod = 'ani_exact';
        } else {
            // No match -> create thin profile immediately
            const newPerson = await prisma.person.create({
                data: {
                    companyId: event.companyId,
                    status: 'unknown',
                    identifiers: [{ type: 'phone', value: cleanPhone }],
                    sms_capable: null // learned later
                }
            });
            personId = newPerson.person_id;
            identityConfidence = 1.0;
            identityMethod = 'none';
        }
    } else {
        // No phone (e.g. withheld caller ID) -> create thin profile, flag transcript_only
        const newPerson = await prisma.person.create({
            data: {
                companyId: event.companyId,
                status: 'unknown',
                identifiers: []
            }
        });
        personId = newPerson.person_id;
        identityConfidence = 0.0;
        identityMethod = 'none';
    }

    // 2. Intake Suppression Gate
    // Same person + open container of same thread_type inside join window
    const threadType = event.initial_thread_type || 'general';
    let actionsSuppressed = false;
    let joinWindowMs = 24 * 60 * 60 * 1000; // 24 hours default
    
    if (threadType === 'emergency') joinWindowMs = 2 * 60 * 60 * 1000; // 2 hours
    if (threadType === 'support') joinWindowMs = 3 * 24 * 60 * 60 * 1000; // 3 days
    if (threadType === 'sales') joinWindowMs = 14 * 24 * 60 * 60 * 1000; // 14 days

    const windowStart = new Date(Date.now() - joinWindowMs);

    const openContainers = await prisma.container.findMany({
        where: {
            person_id: personId,
            thread_type: threadType,
            state: 'open',
            opened_at: { gte: windowStart }
        }
    });

    let activeContainerId: string | null = null;
    if (openContainers.length > 0) {
        actionsSuppressed = true;
        activeContainerId = openContainers[0].comm_id;
        console.log(`[Intake] Suppression gate triggered for person ${personId}. Actions suppressed.`);
    }

    // Create the Container
    const commRef = `#${Math.floor(Math.random() * 9000) + 1000}`; // Random for now
    
    const container = await prisma.container.create({
        data: {
            comm_ref: commRef,
            companyId: event.companyId,
            person_id: personId,
            thread_type: threadType,
            lifecycle: 'provisional',
            state: 'open',
            actions_suppressed: actionsSuppressed,
            inactivity_timeout: `${joinWindowMs / 3600000} hours`
        }
    });

    // If suppressed, route the signal into the existing container's escalation
    if (actionsSuppressed && activeContainerId && threadType === 'emergency') {
        await advanceEscalationLadder(activeContainerId);
    }

    // Create Entry
    const entry = await prisma.entry.create({
        data: {
            comm_id: container.comm_id,
            person_id: personId,
            direction: event.direction,
            channel: event.channel,
            from_party: event.from_party,
            to_party: event.to_party,
            party_type: event.direction === 'inbound' ? 'customer' : 'system',
            occurred_at: event.occurred_at,
            recording_url: event.recording_url,
            identity_confidence: identityConfidence,
            identity_method: identityMethod
        }
    });

    return { container, entry, personId };
}

async function advanceEscalationLadder(commId: string) {
    console.log(`[Escalation] Advancing ladder for comm_id ${commId} immediately due to repeat contact.`);
    const { advanceLadder } = await import('./DialLadder');
    await advanceLadder(commId);
}
