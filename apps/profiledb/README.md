# Centralized Customer Data Platform (CDP) & Telemetry API Backend

A production-ready Node.js API service designed as a centralized data collector and intent scoring engine for customer profiles across multiple business tenants.

---

## 🚀 Quick Start

### 1. Installation
Install all Node modules:
```bash
npm install
```

### 2. Database Synchronization & Seed
Generate the Prisma Client and migrate the schema, then seed the initial tenants:
```bash
npx prisma db push
npm run prisma:seed
```

### 3. Run Development Server
Start the development server with hot-reloading:
```bash
npm run dev
```

### 4. Interactive API Documentation
Once the server is running, navigate to the Swagger UI page:
* **Swagger Docs**: [http://localhost:3000/api-docs](http://localhost:3000/api-docs) (or whichever port is defined in `PORT`)

### 5. Run Verification & Testing
Execute the end-to-end integration test suite containing assertions for anonymous ingestion, merges, conflict resolution, and analytics:
```bash
npm run verify
```

---

## 🛠️ Architecture & Core Logic

### 1. Database Schema
* **Tenant**: Multi-tenant separation logic.
* **CustomerProfile**: Unified store of customer tracking. Fields include identifiers (`email`, `phone`, `name`) and scoring parameters (`scoreRaw`, `scoreLive`, `intentBucket`, `lastEventAt`).
* **DeviceFingerprint**: Resolves individual browser session tokens and mapping to profiles.
* **TelemetryEvent**: Telemetry log containing event types, metadata, payloads, and score changes.

### 2. Identity Resolution State Machine
When a tracking event is ingested (`POST /api/v1/telemetry/events`), identity resolution behaves as follows:
* **Anonymous Session**: Resolves the input `fingerprintId`. If unknown, a new anonymous `CustomerProfile` is initialized.
* **New Identifier (Scenario A)**: If an email or phone is submitted that doesn't exist, the current profile updates to known with the credentials.
* **Matching Identifier (Scenario B)**: If an email or phone matches an existing profile:
  1. Re-links all browser fingerprints of the temporary anonymous profile to the matched profile.
  2. Re-links all telemetry events of the anonymous profile to the matched profile.
  3. Increments the matched profile's `scoreRaw` with the anonymous profile's raw score.
  4. Deletes the temporary anonymous profile.
* **Conflict Resolution**: If an event has *both* `email` and `phone` pointing to *two different profiles*, the phone-matched profile merges into the email-matched profile, and the phone-matched profile is deleted.

### 3. Intent & Engagement Scoring Decay
Calculates engagement scores dynamically representing visitor cooling:
* **Decay Configs by Intent**:
  - `emergency`: Grace: 1 day, Half-Life: 2 days.
  - `active`: Grace: 3 days, Half-Life: 14 days.
  - `comparison`: Grace: 7 days, Half-Life: 30 days.
  - `research`: Grace: 14 days, Half-Life: 60 days.
* **Formula**:
  If `daysSinceLastEvent > gracePeriod`:
  $$\text{scoreLive} = \text{scoreRaw} \times 0.5^{\frac{\text{daysSinceLastEvent} - \text{gracePeriod}}{\text{halfLife}}}$$

* **No-Downgrade Session Rules**:
  The intent bucket changes sequentially: `unclassified` < `research` < `comparison` < `active` < `emergency`. During event ingestion, a profile's intent bucket can only upgrade or stay the same (no downgrades within session ingestion).

---

## 🤖 For AI Agents & LLM Assistants

When modifying, extending, or maintaining this codebase, observe the following rules:

### 1. Codebase Structure
* [src/index.ts](file:///Users/n3rd/code/profiledb/src/index.ts) - Application entrypoint. Implements Swagger mounting and runs the HTTP server if not in test environment (`process.env.NODE_ENV !== 'test'`).
* [src/config/swagger.ts](file:///Users/n3rd/code/profiledb/src/config/swagger.ts) - OpenAPI 3.0 specification definition. Make sure to update this if API paths or models change.
* [src/services/identity.service.ts](file:///Users/n3rd/code/profiledb/src/services/identity.service.ts) - Primary module for identity resolution state machine and profile merging.
* [src/services/scoring.service.ts](file:///Users/n3rd/code/profiledb/src/services/scoring.service.ts) - Formula implementation for live score decay and intent progression.
* [src/controllers/](file:///Users/n3rd/code/profiledb/src/controllers/) - Route controllers for Telemetry Ingestion, Profile Queries, and Admin Analytics Aggregation.

### 2. Gotchas
* **Hoisting Environment Variables**: Ensure `dotenv.config()` is executed before importing the routes or controllers (where Prisma is initialized).
* **Test Environment**: When running automated tests, set `process.env.NODE_ENV = 'test'` to bypass `app.listen()` port conflicts.
* **Prisma Schema Changes**: If you modify `schema.prisma`, remember to run `npx prisma db push` or `npx prisma migrate dev` to update your database.
