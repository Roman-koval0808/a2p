import { prisma } from '$lib/db';

/**
 * Cohort 2 trajectory write (Epic 7, T7.5). Called when a job closes: records the
 * customer's trajectory into the aggregate model the orchestrator queries to
 * recognize patterns in future customers. Fire-and-forget; never throws to callers.
 */
export interface Cohort2Input {
	companyId: string;
	contactId?: string | null;
	bucketHistory?: unknown;
	scorePath?: unknown;
	tierProgression?: unknown;
	personaBand?: string | null;
	channelSequence?: unknown;
	bookedJobOutcome?: string | null;
}

export async function writeCohort2Trajectory(input: Cohort2Input): Promise<void> {
	try {
		await prisma.cohort2Trajectory.create({
			data: {
				companyId: input.companyId,
				contactId: input.contactId ?? null,
				bucketHistory: (input.bucketHistory as any) ?? undefined,
				scorePath: (input.scorePath as any) ?? undefined,
				tierProgression: (input.tierProgression as any) ?? undefined,
				personaBand: input.personaBand ?? null,
				channelSequence: (input.channelSequence as any) ?? undefined,
				bookedJobOutcome: input.bookedJobOutcome ?? null
			}
		});
	} catch (err: any) {
		console.error('[cohort2] trajectory write failed:', err?.message || err);
	}
}
