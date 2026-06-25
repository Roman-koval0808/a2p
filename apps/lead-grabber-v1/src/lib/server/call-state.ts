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
    const state = await getState(callId);
    let ids: string[] = [];
    if (state?.voicemailRecordingIds && Array.isArray(state.voicemailRecordingIds)) {
        ids = state.voicemailRecordingIds as string[];
    }
    ids.push(recId);
    await prisma.callState.upsert({
        where: { callId },
        update: { voicemailRecordingIds: ids },
        create: { callId, voicemailRecordingIds: ids }
    });
}

export async function hasVoicemailRecordingId(callId: string, recId: string) {
    const state = await getState(callId);
    if (!state?.voicemailRecordingIds || !Array.isArray(state.voicemailRecordingIds)) return false;
    return (state.voicemailRecordingIds as string[]).includes(recId);
}

export async function removeVoicemailRecordingId(callId: string, recId: string) {
    const state = await getState(callId);
    if (!state?.voicemailRecordingIds || !Array.isArray(state.voicemailRecordingIds)) return;
    let ids = state.voicemailRecordingIds as string[];
    ids = ids.filter((id: string) => id !== recId);
    await prisma.callState.updateMany({
        where: { callId },
        data: { voicemailRecordingIds: ids }
    });
}
