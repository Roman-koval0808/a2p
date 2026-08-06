-- Telnyx Number Lookup cache, keyed by canonical E.164.
-- Line type gates the tier of every inbound call (§4.3a); caching keeps that to one lookup per
-- number rather than one per call. Failed lookups are never written.
CREATE TABLE "number_lookups" (
    "phoneNumber" TEXT NOT NULL,
    "lineType" TEXT NOT NULL,
    "carrier" TEXT,
    "raw" JSONB,
    "lookedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "number_lookups_pkey" PRIMARY KEY ("phoneNumber")
);
