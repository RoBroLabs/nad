#!/usr/bin/env bash

set -euo pipefail

readonly deno_version='2.7.7'
readonly tool_directory="${NAD_DENO_INSTALL_DIRECTORY:-.ci-tools}"

case "$(uname -m)" in
  x86_64)
    readonly deno_asset='deno-x86_64-unknown-linux-gnu.zip'
    readonly deno_sha256='0cd918870657ccc3d96ac682290e894dda374e2a742424aae9118b258a6cf7a3'
    ;;
  aarch64)
    readonly deno_asset='deno-aarch64-unknown-linux-gnu.zip'
    readonly deno_sha256='e654ef4b41d8f1369dfe7d69374c8f226660153d077e0ac25353d454e03ef798'
    ;;
  *)
    echo "Unsupported Deno CI architecture: $(uname -m)." >&2
    exit 1
    ;;
esac

mkdir -p "$tool_directory"
curl --fail --location --silent --show-error \
  "https://github.com/denoland/deno/releases/download/v${deno_version}/${deno_asset}" \
  --output "${tool_directory}/${deno_asset}"

(
  cd "$tool_directory"
  printf '%s  %s\n' "$deno_sha256" "$deno_asset" | sha256sum --check
  python3 -m zipfile -e "$deno_asset" .
  rm "$deno_asset"
)
chmod 0755 "${tool_directory}/deno"

if ! "${tool_directory}/deno" --version | head -n 1 | grep --quiet --fixed-strings 'deno 2.7.7'; then
  echo 'Installed Deno version did not match 2.7.7.' >&2
  exit 1
fi
