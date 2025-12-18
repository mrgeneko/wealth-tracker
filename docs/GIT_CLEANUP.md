# Git Branch Cleanup Guide

This document explains how to safely clean up stale branches locally and on the remote repository.

Quick summary:

- Use `git fetch --prune` to remove stale remote-tracking refs
- Inspect merged branches (`git branch --merged main` and `git branch -r --merged origin/main`) before deletion
- Use the provided script `scripts/cleanup_git_branches.sh` to preview and safely delete branches

Example usage:

- Dry-run (default):
  ```bash
  ./scripts/cleanup_git_branches.sh --dry-run
  ```

- Delete local branches merged into `main` interactively:
  ```bash
  ./scripts/cleanup_git_branches.sh --delete-local
  ```

- Delete both local and remote branches, skip prompt:
  ```bash
  ./scripts/cleanup_git_branches.sh --delete-local --delete-remote --confirm
  ```

Notes & safety tips:

- Protected branches (main, master, develop, dev, staging, release, production) are excluded by default.
- You can add more excludes with `--exclude 'pattern'` (this is a regex matched against branch name).
- The script will only delete branches that Git reports as "merged" into `main` (or `origin/main` if `main` doesn't exist locally).
- If you prefer interactive GitHub cleanup (PR-based), consider using `gh` (GitHub CLI) to list merged PRs and delete branch refs there.

---

## Cleanup Record (2025-12-18) ✅

**Summary of actions:**

- Performed by: **GitHub Copilot** (local; at user request)
- Commands executed (high level):
  - `git fetch --prune`
  - `./scripts/cleanup_git_branches.sh --delete-local` (interactive) — deleted **231** merged local branches
  - Deleted remaining local branches (deleted **8** more): `add-debug-logs-to-singlefile_wrap.sh`, `add-log-clean-up-script`, `add-retry-and-wait-to-symbolRegistry-Initialization`, `adjust-moomoo-pre-market-price`, `broken-attempt-at-url-retries`, `create-dedicated-chrome-docker-container`, `symbol-to-ticker-change`, `udpate-readme`
  - `./scripts/cleanup_git_branches.sh --delete-remote` — deleted **132** remote branches
  - Deleted remaining remote branches (deleted **6**): `add-debug-logs-to-singlefile_wrap.sh`, `add-log-clean-up-script`, `add-retry-and-wait-to-symbolRegistry-Initialization`, `adjust-moomoo-pre-market-price`, `broken-attempt-at-url-retries`, `create-dedicated-chrome-docker-container`
  - `git fetch --prune` (final)

**Totals:**

- Local branches deleted: **239**
- Remote branches deleted: **138**
- Remaining local branches: **main**
- Remaining remote branches: **origin/main**

**Notes:**

- Protected branches (main, master, develop, etc.) were preserved by default.
- If you need a full audit (CSV of deleted branch names + last commit SHAs), I can generate and save it in `artifacts/`.

---

*(If this summary is incorrect or you want more detail, tell me and I'll add exact logs and SHAs to this file.)*