# NAD

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

A self-hosted control plane for your homelab. NAD gives you one dashboard over
the services you already run — Proxmox, Unraid, Pi-hole, bare metal — with
Workspaces you arrange yourself and Widgets you choose.

NAD ships with nothing installed. You decide what it can see.

## Install

```bash
curl -O https://raw.githubusercontent.com/RoBroLabs/nad/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/RoBroLabs/nad/main/.env.example
mv .env.example .env

# Generate the two required secrets and put them in .env
openssl rand -base64 32   # APP_SECRET
openssl rand -base64 32   # AUTH_SECRET

docker compose up -d
```

Open <http://localhost:3000>. The first visit takes you to `/setup` to create
the administrator account.

Images are published to the GitHub Container Registry for `linux/amd64` and
`linux/arm64`, so a Raspberry Pi, an ARM VPS and an x86 server all pull the same
tag with nothing to build:

```bash
docker pull ghcr.io/robrolabs/nad:0.3.3
```

[`docs/OPERATIONS.md`](docs/OPERATIONS.md) covers reverse proxies, backup,
restore, rollback and account recovery.

## Adding plugins

Features arrive as signed `.nadmod` packages, released independently of the
Dashboard. Install them from the Marketplace inside NAD, or upload a `.nadmod`
file directly if your NAD has no internet access.

First-party plugins today: System Monitor, Proxmox VE, Pi-hole and Unraid.

Writing your own is a supported path, not an afterthought — the Development Kit,
schemas, templates and CLI are in
[`nad-plugins`](https://github.com/RoBroLabs/nad-plugins), along with the source
of every first-party plugin.

## How plugins are kept safe

Running someone else's code against your infrastructure is the whole risk of a
dashboard like this, so the boundaries are explicit:

- **Signed and verified.** Every package is checked against a trusted key and an
  exact digest before it is installed. Revocations and advisories arrive through
  the same signed channel.
- **Sandboxed.** Plugin code runs in a short-lived Deno isolate. Direct network,
  filesystem, environment, subprocess, FFI and runtime-import access is denied.
- **Brokered.** Outbound HTTP and notifications go through the core, restricted
  to the scopes the plugin declared in its manifest and you approved.
- **Secrets stay server-side.** Connection credentials are encrypted with
  AES-256-GCM and never reach a browser or a plugin.
- **Custom UI is contained.** Plugin surfaces render in an opaque sandbox with a
  bounded message bridge — no ambient access to your session.

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) documents these boundaries in full.

## What the core does

Identity and first-run setup, `admin`/`member`/`restricted` roles with
server-side authorization, personal and shared Workspaces with saved layouts,
encrypted connection profiles, an audit log, core-owned email/Telegram/ntfy
notifications, package install, activation, rollback and uninstall without a
restart, and verified backups that include installed plugin artifacts.

## Built with

Next.js 15, React 19, TypeScript, Tailwind CSS 4, SQLite with Drizzle and
`better-sqlite3`, Auth.js, TanStack Query, React Grid Layout, and a pinned Deno
`2.7.7` sandbox.

## Development

Requirements: Node.js 20+, the pnpm version pinned in `package.json`, and Deno
`2.7.7` to execute installed plugins outside Docker.

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
cp .env.example .env.local   # then set APP_SECRET and AUTH_SECRET
pnpm dev
```

Set `NAD_ALLOW_UNSIGNED_MODULES=true` only on a disposable instance used for
local plugin development.

```bash
pnpm test        # unit and integration
pnpm lint
pnpm typecheck   # run before build; Next.js regenerates types
pnpm build
pnpm db:backup
pnpm admin:recover
```

To build the container from source instead of pulling it:

```bash
docker compose --env-file .env.local \
  -f docker-compose.yml -f docker-compose.build.yml up --build -d
```

## Security

Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).
Please do not open a public issue for a suspected sandbox escape, signature
bypass or credential exposure.

## Licence

[GNU Affero General Public License v3.0](./LICENSE) (`AGPL-3.0-only`). If you run
a modified copy as a network service, you must offer its source to your users.
