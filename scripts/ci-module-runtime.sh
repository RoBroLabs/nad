#!/usr/bin/env bash

set -euo pipefail

# This is deliberately the immutable currently released package. Candidate
# packages are built and verified in the separate official Modules monorepo;
# core CI proves that the published compatibility baseline still runs on HEAD.
readonly system_monitor_version='1.0.3'
readonly system_monitor_sha256='6003c2f43b99d79865508a808ea42dbf35214de38480f64347bace877caf98de'
readonly artifact_directory='.ci-artifacts'
readonly artifact_path="${artifact_directory}/system-monitor-${system_monitor_version}.nadmod"

if [[ -z "${EXPECTED_MACHINE:-}" ]]; then
  echo 'EXPECTED_MACHINE is required.' >&2
  exit 1
fi

if [[ "$(uname -m)" != "$EXPECTED_MACHINE" ]]; then
  echo "Expected machine $EXPECTED_MACHINE but found $(uname -m)." >&2
  exit 1
fi

if ! deno --version | head -n 1 | grep --quiet --fixed-strings 'deno 2.7.7'; then
  echo 'Deno 2.7.7 is required.' >&2
  exit 1
fi

mkdir -p "$artifact_directory"
curl --fail --location --silent --show-error \
  --connect-timeout 10 --max-time 120 --retry 4 --retry-all-errors \
  "https://nad.robrolabs.com/downloads/system-monitor/${system_monitor_version}/system-monitor-${system_monitor_version}.nadmod" \
  --output "$artifact_path"
printf '%s  %s\n' "$system_monitor_sha256" "$artifact_path" | sha256sum --check

NAD_DENO_PATH="$(command -v deno)" \
NAD_SYSTEM_MONITOR_PACKAGE="$PWD/$artifact_path" \
  pnpm exec vitest run \
    src/lib/modules/installed/runner.integration.test.ts \
    src/lib/modules/installed/system-monitor.integration.test.ts
