---
name: cdp-telemetry
description: Guides development, debugging, and expansion of the Centralized CDP & Telemetry API service.
---

# CDP Telemetry Developer Skill

This skill contains the detailed instructions, best practices, and recipes for extending, maintaining, or refactoring the Customer Data Platform (CDP) and Telemetry Ingestion API service.

## Core Directives

### 1. Ingestion Pipelines
* **Identity Merging Strategy**:
  - Always run profile updates and events re-linking in a single database transaction (`prisma.$transaction`) to prevent orphan fingerprints or telemetry records.
  - When merging phone and email profiles due to identifier overlap, the email-matched profile is the **target** and the phone-matched profile is the **source**.
* **Scoring Delta Application**:
  - Apply `scoreDelta` directly to the resolved profile's raw score.
  - Since a telemetry event is registered *now*, reset `scoreLive` to the newly updated `scoreRaw` (no elapsed decay time yet).

### 2. Intent Scoring & Decay
* **Formula**:
  $$\text{scoreLive} = \text{scoreRaw} \times 0.5^{\frac{\text{daysSinceLastEvent} - \text{gracePeriod}}{\text{halfLife}}}$$
* **No-Downgrade Rules**:
  Ensure the helper checks that the intent bucket never moves backwards during event ingestion (e.g. if profile is `emergency`, it cannot move back to `research`).

### 3. API Schemas & Swagger
* Serve dynamic documentation at `/api-docs` using the exported `swaggerDocument` in `src/config/swagger.ts`.
* If adding new routes or parameters, immediately document them in `src/config/swagger.ts`.

---

## Technical Recipies

### Recalculate Live Score on Query
When fetching profiles, recalculate the decayed score on-the-fly and save the updated score back to the database.

```typescript
import { calculateDecayedScore } from '../services/scoring.service';

const now = new Date();
const liveScore = calculateDecayedScore(profile.scoreRaw, profile.lastEventAt, profile.intentBucket, now);
if (liveScore !== profile.scoreLive) {
  await prisma.customerProfile.update({
    where: { id: profile.id },
    data: { scoreLive: liveScore },
  });
}
```

### Run E2E Verification
Always verify changes using the validation script:
```bash
npm run verify
```
This script runs a sequence of requests on port `3009` and asserts proper database updates and merges.
