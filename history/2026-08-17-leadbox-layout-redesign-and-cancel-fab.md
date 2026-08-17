# Leadbox Layout Redesign, Enlarged Avatar, and Floating Cancel FAB

## Goal
- Address user feedback on leadbox visual design:
  - Increase logo image size in the open leadbox header.
  - Fix dark font contrast on action buttons and input fields.
  - When opened, display a floating circular cancel/close FAB button at the bottom right instead of the closed pill or secondary button.
  - Update main view and subform views ("Text Us", "Request a Call") to match the provided Leadferno-style layout with white card containers, clear input fields, and policy links.
  - Resolve SvelteKit payload size limit (413) when uploading logos > 512KB.

## Changed
- `apps/lead-grabber-v1/ecosystem.config.cjs`: Added `BODY_SIZE_LIMIT: '5M'` to PM2 environment config so the `@sveltejs/adapter-node` server handles larger logo uploads without throwing 413.
- `apps/lead-grabber-v1/.env`: Added `BODY_SIZE_LIMIT=5M`.
- `apps/lead-grabber-v1/src/lib/embed/styles.ts`:
  - Enlarged circular avatar badge (`.clearsky-logo`) from 76px to 92px with 4px border and shadow.
  - Added `.clearsky-cancel-fab` styles for the floating circular close button when open.
  - Updated card containers, header texts, subform fields (`.clearsky-field-row`, `.clearsky-field-input`, `.clearsky-field-textarea`), time pills, submit buttons, and footer policy links.
- `apps/lead-grabber-v1/src/lib/embed/leadbox-builder.ts`:
  - Rendered `createOpenLeadbox` with the floating cancel FAB button (`clearsky-cancel-fab`) when open.
  - Added back button navigation `←` and dynamic subform titles in the top banner.
  - Formatted channel buttons and subforms with white card containers and footer links.
- `apps/lead-grabber-v1/src/routes/(app)/leadbox/+page.svelte`:
  - Updated builder preview to match all embed changes (enlarged logo, subform headers, clean input fields, policy links, and the floating cancel FAB when open).

## Root causes
- SvelteKit's Node adapter defaults to a 512KB request body limit unless `BODY_SIZE_LIMIT` is explicitly specified in the environment.
- Previously, `createOpenLeadbox` appended `createClosedLeadbox()`, rendering the closed pill underneath the open modal. The desired behavior is to show a dedicated circular cancel FAB button at the trigger position when the modal is open.

## Rejected
- Trying to configure SvelteKit's body size limit per-route via `export const config = { ... }`, because `@sveltejs/adapter-node` parses body streams globally via `BODY_SIZE_LIMIT`.

## Not verified
- Uploading a logo larger than 5MB on the production server (requires deploying and restarting PM2).

## Open decisions
- None.
