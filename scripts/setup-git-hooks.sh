#!/usr/bin/env bash
# One-time setup: point git at the versioned hooks under .githooks/.
#
# Run once per developer machine:
#   bash scripts/setup-git-hooks.sh
#
# This wires up the pre-push hook that runs `pnpm test:unit` before
# every push to prevent broken tests from silently shipping to main +
# failing CI for hours (which happened 2026-05-17 when a Phase 5
# multilingual change broke an ai-drafter test assertion).
#
# Idempotent — running it again does nothing harmful.

set -euo pipefail

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "✗ Not inside a git repo. Run from the AHO project root." >&2
  exit 1
fi

git config core.hooksPath .githooks
echo "✓ git config core.hooksPath = .githooks"
echo ""
echo "Pre-push hook active. Before every push, pnpm test:unit will run."
echo "Bypass with --no-verify if you must (e.g. docs-only emergency)."
