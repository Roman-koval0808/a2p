# 2026-08-24 Path references clean

## Goal

Remove all local username path references from repo documentation and replace with `{user}`.

## Changed

- **`history/2026-08-19-viewroom-port.md`** — sanitized local user directory path reference to `/Users/{user}/code/viewroom`.
- **`history/2026-08-20-2-viewroom-session-merge-fingerprints.md`** — sanitized local user directory path reference to `/Users/{user}/code/clearsky-website/...`.
- **`history/2026-08-20-signal-tracking-wiring.md`** — sanitized local user directory path reference to `/Users/{user}/code/clearsky-website`.
- **`history/2026-08-21-ai-assistants-knowledge-base-port.md`** — sanitized local user directory path reference to `/Users/{user}/code/viewroom`.

## Root causes

- Past session logs recorded local absolute paths with specific user names directly from prompts and test runs.

## Rejected

- None.

## Not verified

- None. Documentation-only change.

## Open decisions

- None.
