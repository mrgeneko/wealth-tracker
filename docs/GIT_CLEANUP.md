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