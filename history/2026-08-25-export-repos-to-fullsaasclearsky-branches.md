# 2026-08-25 Exporting satellite repositories into fullsaasclearsky branches

## Goal

Export local satellite repositories (`a2p`, `clearsky-website`, `seo-rank-grid-tracker`, `viewroom`, `contentradar`, `clearsky-reviews`, `chatbot`, and `revenue-model` from clearsky-homepage) into isolated branches on `https://github.com/RoryClearSky/fullsaasclearsky`, each sitting inside its own dedicated top-level folder, without modifying or merging into `main`.

## Changed

- **`RoryClearSky/fullsaasclearsky` remote branches created**:
  - `Romana2p`: contains `a2p/` subfolder with the complete `a2p` codebase.
  - `clearsky-website`: contains `clearsky-website/` subfolder with the website codebase.
  - `seo-rank-grid-tracker`: contains `seo-rank-grid-tracker/` subfolder with the SEO grid tracker codebase (exported from `table-and-category-fix`).
  - `viewroom`: contains `viewroom/` subfolder with the complete viewroom codebase.
  - `contentradar`: contains `contentradar/` subfolder with the complete contentradar codebase.
  - `clearsky-reviews`: contains `clearsky-reviews/` subfolder with the complete clearsky-reviews codebase.
  - `chatbot`: contains `chatbot/` subfolder with the complete chatbot backend & frontend codebases.
  - `revenue-model`: contains `revenue-model/` subfolder with the clearsky-homepage revenue layers (Layer 1, Layer 2, Calc APIs, Capacity model, and data reports).
- Added `sync-to-client.sh` and `sync-a2p.sh` automation scripts.

## Root causes / Workflow details

- Direct git push of satellite roots into `fullsaasclearsky`'s `main` would overwrite root configuration and conflicting files.
- Used `git archive <source-branch> | tar -x -C <folder>/` (and rsync for multi-project repos) on branches created from `upstream/main` to cleanly isolate each repo into its own folder before pushing.
- All commits were authored solely by Roman Kovalenko (`Roman Kovalenko <roman.kovalenko0808@outlook.com>`) to preserve clean author attribution without carrying over external contributor histories.
- Configured GitHub Personal Access Token authentication for the `upstream` remote.

## Rejected

- Using raw `cp -R .../.[!.]*` inside `zsh` triggered zsh history expansion error on `!]`. `git archive` and `rsync` were used instead as deterministic, clean extraction mechanisms.
- Pushing satellite repo roots directly to root of `fullsaasclearsky` branches (rejected to keep repo clean and allow side-by-side comparison).

## Not verified

- Merge conflicts and feature integration into `fullsaasclearsky/main` (intentionally kept on separate branches per user instructions).
- CI/CD build pipelines on `fullsaasclearsky` for the newly added branches.

## Open decisions

- How the individual satellite folders (`a2p/`, `viewroom/`, `clearsky-website/`, `seo-rank-grid-tracker/`, `contentradar/`, `clearsky-reviews/`, `chatbot/`, `revenue-model/`) will be merged into `fullsaasclearsky`'s unified project structure or monorepo workspace.
