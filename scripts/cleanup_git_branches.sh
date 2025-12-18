#!/usr/bin/env bash
# Safe Git branch cleanup helper
# Usage:
#   ./scripts/cleanup_git_branches.sh --dry-run
#   ./scripts/cleanup_git_branches.sh --delete-local --delete-remote --confirm
# Options:
#   --dry-run           : Show branches that would be deleted (default)
#   --delete-local      : Delete local branches merged into main
#   --delete-remote     : Delete remote branches merged into origin/main
#   --remote <name>     : Remote name (default: origin)
#   --force-local       : Force-delete local branches (-D)
#   --force-remote      : Force-delete remote branches (no extra flag, remote delete is final)
#   --confirm           : Skip confirmation prompt and perform deletions
#   --exclude <regex>   : Additional branch name regex to exclude (can be used multiple times)
#   -h|--help           : Show help

set -euo pipefail
IFS=$'\n\t'

REMOTE="origin"
MAIN_REF="main"
DRY_RUN=true
DELETE_LOCAL=false
DELETE_REMOTE=false
FORCE_LOCAL=false
CONFIRM=false
PROTECTED_REGEX='^(main|master|develop|dev|staging|release|production)$'
EXCLUDES=()

function usage() {
  sed -n '1,120p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true; shift ;;
    --delete-local)
      DELETE_LOCAL=true; DRY_RUN=false; shift ;;
    --delete-remote)
      DELETE_REMOTE=true; DRY_RUN=false; shift ;;
    --remote)
      REMOTE="$2"; shift 2 ;;
    --force-local)
      FORCE_LOCAL=true; shift ;;
    --confirm)
      CONFIRM=true; shift ;;
    --exclude)
      EXCLUDES+=("$2"); shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown arg: $1"; usage; exit 1 ;;
  esac
done

if ! command -v git >/dev/null 2>&1; then
  echo "git is not available on PATH" >&2; exit 1
fi

echo "Fetching remotes and pruning deleted refs..."
git fetch --prune

# Build combined exclude regex
COMBINED_EXCLUDE="$PROTECTED_REGEX"
# Only append additional excludes if any were provided
if [ "${#EXCLUDES[@]:-0}" -gt 0 ]; then
  for e in "${EXCLUDES[@]}"; do
    COMBINED_EXCLUDE="$COMBINED_EXCLUDE|($e)"
  done
fi

# LOCAL: branches merged into main
LOCAL_TO_DELETE=()
if $DELETE_LOCAL || $DRY_RUN; then
  echo "\nIdentifying local branches merged into $MAIN_REF..."
  # ensure main exists locally; otherwise fall back to origin/main
  if git rev-parse --verify --quiet "$MAIN_REF" >/dev/null; then
    MERGED_LOCAL=$(git branch --merged "$MAIN_REF" --format='%(refname:short)')
  else
    MERGED_LOCAL=$(git branch --merged "${REMOTE}/${MAIN_REF}" --format='%(refname:short)')
  fi

  while IFS= read -r b; do
    # skip current branch marker
    b_trimmed=$(echo "$b" | sed 's/^\* //')
    # skip protected
    if echo "$b_trimmed" | grep -Eq "$COMBINED_EXCLUDE"; then continue; fi
    LOCAL_TO_DELETE+=("$b_trimmed")
  done <<< "$MERGED_LOCAL"
fi

# REMOTE: branches merged into origin/main
REMOTE_TO_DELETE=()
if $DELETE_REMOTE || $DRY_RUN; then
  echo "\nIdentifying remote branches merged into ${REMOTE}/${MAIN_REF}..."
  # Use a safe line-oriented read to avoid word-splitting and preserve branch names
  while IFS= read -r r; do
    # Trim leading/trailing whitespace
    r_trim=$(echo "$r" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    # Skip remote/main and remote/HEAD
    if [[ "$r_trim" == "${REMOTE}/${MAIN_REF}" || "$r_trim" == "${REMOTE}/HEAD" ]]; then
      continue
    fi
    # If the entry includes the remote prefix (origin/...), strip it
    if [[ "$r_trim" =~ ^${REMOTE}/(.+)$ ]]; then
      short="${BASH_REMATCH[1]}"
    else
      short="$r_trim"
    fi
    # Skip protected or excluded patterns
    if echo "$short" | grep -Eq "$COMBINED_EXCLUDE"; then
      continue
    fi
    REMOTE_TO_DELETE+=("$short")
  done <<< "$(git branch -r --merged "${REMOTE}/${MAIN_REF}")"
fi

# Summary
echo "\nSummary:" 
if [ ${#LOCAL_TO_DELETE[@]} -gt 0 ]; then
  echo "Local branches to delete (${#LOCAL_TO_DELETE[@]}):"
  for b in "${LOCAL_TO_DELETE[@]}"; do echo "  - $b"; done
else
  echo "Local branches to delete: none"
fi

if [ ${#REMOTE_TO_DELETE[@]} -gt 0 ]; then
  echo "Remote branches to delete on ${REMOTE} (${#REMOTE_TO_DELETE[@]}):"
  for b in "${REMOTE_TO_DELETE[@]}"; do echo "  - $b"; done
else
  echo "Remote branches to delete: none"
fi

if $DRY_RUN; then
  echo "\nDry-run mode: no changes will be made. Use --delete-local and/or --delete-remote to perform deletions."
  exit 0
fi

if [ ${#LOCAL_TO_DELETE[@]} -eq 0 ] && [ ${#REMOTE_TO_DELETE[@]} -eq 0 ]; then
  echo "\nNo branches to delete. Exiting."
  exit 0
fi

if ! $CONFIRM; then
  echo -n "\nProceed with deleting the above branches? Type 'yes' to continue: "
  read -r yn
  if [ "$yn" != "yes" ]; then
    echo "Aborted by user."; exit 1
  fi
fi

# Perform deletions
if [ ${#LOCAL_TO_DELETE[@]} -gt 0 ]; then
  echo "\nDeleting local branches..."
  for b in "${LOCAL_TO_DELETE[@]}"; do
    if $FORCE_LOCAL; then
      git branch -D "$b" && echo "Deleted local $b" || echo "Failed to delete local $b"
    else
      git branch -d "$b" && echo "Deleted local $b" || echo "Failed to delete local $b (use --force-local to force)"
    fi
  done
fi

if [ ${#REMOTE_TO_DELETE[@]} -gt 0 ]; then
  echo "\nDeleting remote branches on ${REMOTE}..."
  for b in "${REMOTE_TO_DELETE[@]}"; do
    git push "$REMOTE" --delete "$b" && echo "Deleted remote ${REMOTE}/${b}" || echo "Failed to delete remote ${REMOTE}/${b}"
  done
fi

echo "\nCleanup complete. Consider running 'git fetch --prune' again to refresh remote refs."