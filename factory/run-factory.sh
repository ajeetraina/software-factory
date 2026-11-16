#!/usr/bin/env bash
#
# TaskFlow software factory: five Docker Sandbox stages chained over a git branch.
# Each stage is a throwaway microVM fed a headless prompt; artifacts are handed
# forward via `--clone` + `git fetch sandbox-<stage>`.
#
# Usage:
#   ./factory/run-factory.sh "Add PATCH /tasks/:id to update title and completed"
#
# Prereqs (one-time): see README.md -> "Running the factory".

set -euo pipefail

FEATURE="${1:?Usage: run-factory.sh \"<feature request>\"}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"   # repo root = taskflow/
cd "$REPO"

# Your registry namespace for the custom test/release templates (see README).
REGISTRY="${FACTORY_REGISTRY:-docker.io/youruser}"
TEST_IMG="${REGISTRY}/factory-test:v1"
RELEASE_IMG="${REGISTRY}/factory-release:v1"

BRANCH="factory/$(date +%s)"
CLAUDE="claude --dangerously-skip-permissions"   # headless; never prompts

echo ">> Factory branch: $BRANCH"
echo ">> Feature: $FEATURE"
git checkout -b "$BRANCH"

# run_stage <name> <agent-or-template-image> <prompt> [agent_cmd] [prompt_flag]
#   agent_cmd   defaults to Claude headless; prompt_flag defaults to "-p".
#   For Codex, pass "codex exec --full-auto" and "" (prompt is positional).
run_stage () {
  local name="$1" agent="$2" prompt="$3"
  local agent_cmd="${4:-$CLAUDE}" prompt_flag="${5--p}"
  echo ""
  echo "=================== STAGE: ${name} (${agent}) ==================="
  sbx create --name "$name" --clone --no-progress "$agent" "$REPO"
  # shellcheck disable=SC2086  # agent_cmd/prompt_flag are intentionally word-split
  sbx exec "$name" -- $agent_cmd $prompt_flag "$prompt"
  # Pull the stage's commits back onto our branch.
  git fetch "sandbox-${name}" "$BRANCH" 2>/dev/null || git fetch "sandbox-${name}"
  git merge --no-edit FETCH_HEAD
  sbx rm --force "$name"
}

# ---- 1) SPEC — one line in, a testable SPEC.md out. No network needed. --------
sbx policy set-default deny-all
run_stage spec claude \
"Read the repo to learn its conventions. The requested feature is: \"${FEATURE}\".
 Write SPEC.md with: HTTP method+path, request body schema, success response +
 status, every validation rule, every error case + status, and a numbered list
 of acceptance criteria. Do NOT write application code or tests.
 Commit SPEC.md to branch ${BRANCH}."

# ---- 2) CODING — implement strictly against SPEC.md. npm allowed. ------------
sbx policy allow network "registry.npmjs.org,*.npmjs.org"
run_stage coding claude \
"Implement the feature in src/ so it satisfies SPEC.md exactly. Match the existing
 code style (ES modules, the db.js repository pattern, the routes/ structure).
 Add a db.update() function if needed. Do NOT write tests.
 Commit your changes to branch ${BRANCH}."

# ---- 3) REVIEW — cross-model audit (Codex reviews Claude's code). ------------
# Needs the OpenAI credential + network: `sbx secret set -g openai`.
sbx policy allow network "api.openai.com"
run_stage review codex \
"Review the diff on branch ${BRANCH} against SPEC.md for correctness, security,
 input validation, and style. Write REVIEW.md as a checklist of findings, each as
 'file:line [SEVERITY] description' where SEVERITY is BLOCKER/MAJOR/MINOR.
 Fix any BLOCKER findings directly in the code. Commit REVIEW.md plus any fixes." \
"codex exec --full-auto" ""

# Gate: stop if the reviewer recorded an unresolved blocker.
if git show "FETCH_HEAD:REVIEW.md" 2>/dev/null | grep -qi "BLOCKER"; then
  echo "!! Reviewer flagged BLOCKER findings in REVIEW.md — halting before test/release."
  echo "!! Inspect branch ${BRANCH}, resolve, then re-run from the test stage."
  exit 1
fi

# ---- 4) TEST — write tests, run them, loop until green. ----------------------
run_stage test "$TEST_IMG" \
"Write vitest + supertest tests in test/ covering EVERY acceptance criterion in
 SPEC.md, including all error cases. Run 'npm test'. If anything fails, fix the
 code or the tests and re-run until the whole suite passes. Commit tests + fixes.
 Exit non-zero if you cannot make the suite green."

# Independent verification from the host (don't trust the agent's word).
echo ""
echo "=================== VERIFY (host-driven) ==================="
sbx create --name verify --clone --no-progress "$TEST_IMG" "$REPO"
sbx exec verify -- bash -lc "npm ci && npm test"
sbx rm --force verify

# ---- 5) RELEASE — bump version, build app image, tag, changelog. -------------
sbx policy allow network "registry.npmjs.org,*.npmjs.org,docker.io,*.docker.io,ghcr.io,*.ghcr.io"
run_stage release "$RELEASE_IMG" \
"Bump the patch version in package.json (use semver). Build the app image with
 'docker build -t taskflow:\$(node -p \"require('./package.json').version\") .'
 and confirm it builds successfully. Add a dated CHANGELOG.md entry describing the
 feature. Create an annotated git tag 'v<version>'. Commit everything."

echo ""
echo ">> Factory complete on branch ${BRANCH}."
echo ">> Next: review the diff, then open a PR:  gh pr create --base main --head ${BRANCH}"
