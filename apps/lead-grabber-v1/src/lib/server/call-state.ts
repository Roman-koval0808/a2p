import { prisma } from '$lib/db';

export async function setIntent(callId: string, digit: string, intentName: string, confidence: string) {
    await prisma.callState.upsert({
        where: { callId },
        update: { intentDigit: digit, intentName, intentConfidence: confidence, intentTimestamp: new Date() },
        create: { callId, intentDigit: digit, intentName, intentConfidence: confidence, intentTimestamp: new Date() }
    });
}

export async function setVoicemail(callId: string) {
    await prisma.callState.upsert({
        where: { callId },
        update: { hasVoicemail: true },
        create: { callId, hasVoicemail: true }
    });
}

export async function removeVoicemail(callId: string) {
    await prisma.callState.updateMany({
        where: { callId },
        data: { hasVoicemail: false }
    });
}

export async function getState(callId: string) {
    return prisma.callState.findUnique({ where: { callId } });
}

export async function deleteState(callId: string) {
    await prisma.callState.deleteMany({ where: { callId } }).catch(() => {});
}

export async function addVoicemailRecordingId(callId: string, recId: string) {
    await prisma.$transaction(async (tx) => {
        const state = await tx.callState.findUnique({ where: { callId } });
        let ids: string[] = [];
        if (state?.voicemailRecordingIds && Array.isArray(state.voicemailRecordingIds)) {
            ids = state.voicemailRecordingIds as string[];
        }
        ids.push(recId);
        await tx.callState.upsert({
            where: { callId },
            update: { voicemailRecordingIds: ids },
            create: { callId, voicemailRecordingIds: ids }
        });
    });
}

export async function hasVoicemailRecordingId(callId: string, recId: string) {
    const state = await getState(callId);
    if (!state?.voicemailRecordingIds || !Array.isArray(state.voicemailRecordingIds)) return false;
    return (state.voicemailRecordingIds as string[]).includes(recId);
}

export async function removeVoicemailRecordingId(callId: string, recId: string) {
    await prisma.$transaction(async (tx) => {
        const state = await tx.callState.findUnique({ where: { callId } });
        if (!state?.voicemailRecordingIds || !Array.isArray(state.voicemailRecordingIds)) return;
        let ids = state.voicemailRecordingIds as string[];
        ids = ids.filter((id: string) => id !== recId);
        await tx.callState.updateMany({
            where: { callId },
            data: { voicemailRecordingIds: ids }
        });
    });
}

// Cleanup stale call states older than 1 hour
export async function cleanupStaleCallStates() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const result = await prisma.callState.deleteMany({
        where: { intentTimestamp: { lt: oneHourAgo } }
    });
    if (result.count > 0) console.log(`🧹 Cleaned up ${result.count} stale call states`);
}

// Run cleanup every 10 minutes
setInterval(cleanupStaleCallStates, 10 * 60 * 1000);

