#!/usr/bin/env bash
set -euo pipefail

expected_machine="${EXPECTED_MACHINE:-}"
test_timeout_ms="${NAD_CI_TEST_TIMEOUT_MS:-5000}"
hook_timeout_ms="${NAD_CI_HOOK_TIMEOUT_MS:-10000}"

if [[ ! "$test_timeout_ms" =~ ^[0-9]+$ ]] ||
   ((test_timeout_ms < 1000 || test_timeout_ms > 60000)); then
  printf 'NAD_CI_TEST_TIMEOUT_MS must be between 1000 and 60000.\n' >&2
  exit 1
fi
if [[ ! "$hook_timeout_ms" =~ ^[0-9]+$ ]] ||
   ((hook_timeout_ms < 1000 || hook_timeout_ms > 120000)); then
  printf 'NAD_CI_HOOK_TIMEOUT_MS must be between 1000 and 120000.\n' >&2
  exit 1
fi
if [[ -n "$expected_machine" && "$(uname -m)" != "$expected_machine" ]]; then
  printf 'Expected architecture %s, got %s\n' "$expected_machine" "$(uname -m)" >&2
  exit 1
fi
if [[ "$(pnpm --version)" != "9.15.0" ]]; then
  printf 'Expected pnpm 9.15.0, got %s\n' "$(pnpm --version)" >&2
  exit 1
fi

if [[ "${1:-}" != "--dependencies-installed" ]]; then
  pnpm install --frozen-lockfile --strict-peer-dependencies
fi

if ! command -v deno >/dev/null 2>&1; then
  bash scripts/ci-install-deno.sh
  export PATH="$PWD/.ci-tools:$PATH"
fi
deno_version="$(deno --version | sed -n '1p' | awk '{print $2}')"
[[ "$deno_version" == "2.7.7" ]] || { printf 'Expected Deno 2.7.7.\n' >&2; exit 1; }

pnpm contracts:check
NAD_BUILD_EPHEMERAL_DB=1 pnpm exec vitest run \
  --testTimeout "$test_timeout_ms" \
  --hookTimeout "$hook_timeout_ms"
pnpm lint
pnpm typecheck
if [[ "${NAD_CI_SKIP_BUILD:-0}" == "1" ]]; then
  printf 'Production image job owns the architecture-specific build.\n'
else
  pnpm build
fi
pnpm audit --prod
EXPECTED_MACHINE="${expected_machine:-$(uname -m)}" bash scripts/ci-module-runtime.sh
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git diff --check
fi

printf 'Core release source gate passed on %s.\n' "$(uname -m)"
