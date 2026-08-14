# NAD

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

NAD is a self-hosted homelab Dashboard. The core owns identity, permissions,
encrypted configuration, Workspaces, audit, notifications and safe Plugin
execution. Features are installed as independently released `.nadmod` packages;
no feature Plugin is compiled into the core image.

> **Release status — 14 August 2026:** core `0.3.2` is an initial-public-release
> source candidate. There is no public `v0.3.2` tag or anonymously pullable NAD
> image yet. The latest recorded safe live deployment remains core `0.2.8`.
> See [Project Status](./docs/STATUS.md) and the
> [Initial Public Release Board](./docs/INITIAL_PUBLIC_RELEASE.md).

The withdrawn `v0.3.0` canary exposed a Deno cache problem under the non-root
container user. `v0.3.1` fixed execution but its canary exposed unsafe routing
of migrated Workspace identifiers. The `0.3.2` candidate contains both fixes,
and the browser packaging defect exposed by CI run `1404` is fixed. The clean
exported-source browser gate now passes locally, but public CI, image and live
promotion remain outstanding, so it is not a supported release.

## Repository boundary

| Repository | Responsibility |
|---|---|
| `nad` | Self-hosted Dashboard core and isolated Plugin host |
| `nad-marketplace` | Hosted catalogue, signed metadata and immutable downloads |
| `nad-plugins` | Plugin Development Kit and reviewed Plugin source |

Private Gitea repositories remain the working history until reviewed release
snapshots are published to GitHub. Unfinished Plugins and private operator
evidence are not included in public snapshots.

## Implemented core

- First-run administrator setup, local credential login, session invalidation,
  `admin`, `member` and `restricted` roles, and server-side authorization.
- SQLite persistence, ordered migrations, audit history, personal/shared
  Workspaces, layouts and profile-level access.
- Schema-v1 settings and schema-v2 named connections with AES-256-GCM encrypted
  secrets that never reach browsers or Add-ons.
- Core-owned email/SMTP, Telegram and ntfy notification channels. Plugins
  request delivery through the Host API.
- Signed package verification, bounded archive handling, compatibility checks,
  persistent active/retained artifacts, restart-free activation, rollback,
  disable and uninstall.
- Short-lived Deno execution with external HTTP and notifications brokered by
  core; direct network, environment, write, subprocess, FFI and runtime-import
  access is denied.
- Core-rendered schema-v1 UI and schema-v2 Widget/page surfaces in an opaque
  sandbox with a bounded bridge.
- Online Marketplace browsing plus the same verifier for offline manual upload.
- Verified backup tooling that includes SQLite and installed Plugin artifacts.

A fresh NAD installation starts with zero Plugins.

## Candidate Plugin state

Plugin source and releases are independent of core readiness. None should be
presented as public-stable until it passes its own final-image gate.

| Plugin | Current evidence |
|---|---|
| System Monitor `1.0.3` | Reference package; restart, notification, rollback and restore evidence exists |
| Proxmox VE `1.0.2` | Credentialed read/action, hot-update and restore evidence exists |
| Network / Pi-hole `1.0.0` | Preview; dual-instance credentialed proof outstanding |
| Unraid `1.0.0` | Preview; approved-target credentialed proof outstanding |
| Docker Operations | Deferred until a distinct fleet-level use case justifies its trust boundary |

## Stack

Next.js 15, React 19, strict TypeScript, Tailwind CSS 4, SQLite with Drizzle and
`better-sqlite3`, Auth.js, TanStack Query, React Grid Layout, Docker Compose and
pinned Deno `2.7.7`.

## Local development

Requirements: Node.js 20+, the repository-pinned pnpm version, and Deno `2.7.7`
when executing installed Plugins outside Docker.

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
cp .env.example .env.local
openssl rand -base64 32  # APP_SECRET
openssl rand -base64 32  # AUTH_SECRET
pnpm dev
```

Open <http://localhost:3000>. The first request redirects to `/setup` until an
administrator exists. Set `NAD_ALLOW_UNSIGNED_MODULES=true` only for disposable
local Plugin development.

For a contributor source-built container:

```bash
docker compose --env-file .env.local \
  -f docker-compose.yml -f docker-compose.build.yml up --build -d
```

The normal Compose file is intended to pull a reviewed multi-architecture
release. That public image does not exist yet, so it is not currently a usable
public installation path. Once published, end users will pull it without
installing Node dependencies or compiling NAD.

## Commands

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm audit --prod
pnpm db:backup
pnpm db:backup:maintain
pnpm admin:recover
```

Run typecheck and build sequentially because Next.js regenerates generated
types.

## Documentation

- [Documentation index](./docs/README.md)
- [Project status](./docs/STATUS.md)
- [Initial public release board](./docs/INITIAL_PUBLIC_RELEASE.md)
- [Outstanding roadmap](./docs/ROADMAP.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Operations](./docs/OPERATIONS.md)
- [Release checklist](./docs/RELEASE_CHECKLIST.md)
- [Support policy](./docs/SUPPORT.md)
- [External Module Guide](./docs/MODULE_GUIDE.md)

## License

NAD is licensed under the [GNU Affero General Public License v3.0](./LICENSE)
(`AGPL-3.0-only`). If you run a modified copy as a network service, you must
offer the source of your modified version to its users.
