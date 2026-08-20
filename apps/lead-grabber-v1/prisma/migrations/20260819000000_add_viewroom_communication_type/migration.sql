-- Add a first-class "viewroom" signal to communication logs.
--
-- Viewroom joins are currently recorded under the generic `web` type, which hides them among
-- ordinary site traffic. This adds a dedicated enum value so the comm log can carry its own
-- signal and be filtered/icon'd independently.
--
-- `ADD VALUE` is additive and never rewrites or locks the table; existing rows are untouched.

ALTER TYPE "CommunicationType" ADD VALUE 'viewroom';
