# Refactoring Users Company ID to Company

## Overview

This refactoring aligns the codebase with the schema change in the `users` collection, where `company_id` has been renamed to `company`. Additionally, the `contacts` collection's `company_id` field has been renamed to `company` (relation), and `company_members` collection fields `user_id`/`company_id` have been normalized to `user`/`company`.

## Changes Made

### 1. Frontend Components

Updated `user.company_id` to `user.company` in:

- `src/routes/(app)/inbox/+page.svelte`
- `src/routes/(app)/leadform/+page.svelte`
- `src/routes/(app)/leadbox/+page.svelte`
- `src/lib/components/nav-main.svelte`
- `src/routes/(app)/settings/company/+page.svelte` (Specifically in `removeMember` function)

### 2. Backend Server Load/Actions

Updated server-side logic to use `user.company` and update `users` collection using `company` field:

- `src/routes/(app)/create-company/+page.server.ts`
- `src/routes/(app)/dialer/+page.server.ts`
- `src/routes/(app)/contacts/+page.server.ts`
- `src/routes/(app)/contacts/create/+page.server.ts`
- `src/routes/(app)/settings/company/+page.server.ts`
- `src/routes/(app)/settings/auto-replies/+page.server.ts`
- `src/routes/(app)/settings/company/+server.ts` (API endpoint)
- `src/routes/(app)/communication-log/+page.server.ts`
- `src/routes/api/invites/accept/+server.ts`
- `src/routes/invite/accept/[id]/+page.server.ts`

### 3. Embed Scripts

Updated embed script generators to use `user.company`:

- `src/routes/embed/leadbox/[id]/+server.ts`
- `src/routes/embed/leadform/[id]/+server.ts`

### 4. Utility Functions

Updated `src/lib/utils/contacts.ts` to map `company_id` interface property to `company` database field when querying/creating `contacts`.

### 5. Related Collections

- **Company Members**: Updated `src/routes/api/invites/accept/+server.ts`, `src/routes/invite/accept/[id]/+page.server.ts` and `src/routes/(app)/settings/company/+page.server.ts` to use `user` and `company` fields instead of `user_id` and `company_id` when interacting with `company_members` collection, aligning with the schema.

### Note on Unchanged Collections

The following collections appear to retain `company_id` in their schema and thus were NOT changed in the code (except where they reference the `user` object):

- `messages`
- `invites`
- `communication_logs`

## Verification Steps

1. **Login/Signup**: Verify user login and session data contains `company` instead of `company_id`.
2. **Dashboard/Inbox**: Ensure data loads correctly for the user's company.
3. **Contacts**: Create and list contacts to verify the `company` field mapping works.
4. **Settings**:
   - Check Company Settings page loads members.
   - Try inviting a member (checks permissions/existing logic).
   - Try removing a member (updates `users` collection).
5. **Invites**: Accept an invite and verify it correctly updates the user's `company` and creates a `company_member` record.
