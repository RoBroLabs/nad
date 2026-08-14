# NAD Core Development Guide

This repository contains the self-hosted NAD Dashboard core. The hosted
catalogue belongs in `nad-marketplace`; the SDK, schemas, testkit, CLI and
Plugin source belong in `nad-plugins`.

## Read first

1. `docs/STATUS.md` — verified current state and limitations.
2. `docs/INITIAL_PUBLIC_RELEASE.md` — temporary initial-release board.
3. `docs/ROADMAP.md` — work after and alongside that release.
4. `docs/RELEASE_CHECKLIST.md` — reusable release gate.
5. `docs/MODULE_GUIDE.md` — compatibility contract; read it before changing
   package, Host API or UI API behavior.

Core `0.3.2` is a source candidate, not a supported public release. It is not
tagged or publicly downloadable. The latest recorded safe live deployment is
core `0.2.8`. CI run `1404` did not complete the browser gate; its packaging
defect is now fixed and the clean exported-source browser test passes locally.
The final public CI, image, live-promotion and recovery evidence remains open.
Do not convert an implemented feature or partial test run into a release claim.

## Product vocabulary

| Term | Meaning |
|---|---|
| Dashboard | A user's NAD home and Workspace views. |
| Plugin | User-facing name for a signed installable feature package. |
| Module | Compatibility term retained in `.nadmod`, IDs, database records and `/api/modules`. |
| App | Schema-v2 integration that owns connections and versioned operations. |
| Add-on | Schema-v2 package that consumes declared App operations without receiving credentials. |
| Widget | A Plugin surface placed in a Dashboard or Workspace. |
| Marketplace | The separately hosted catalogue and download platform. |

## Core boundary

Core owns authentication, RBAC, encrypted connections and configuration,
notifications, audit, package trust/lifecycle, Workspaces, persistence and the
isolated runtime. A fresh image contains no feature Plugins.

- Downloaded server code never runs in the Next.js process. Deno processes
  have direct network, filesystem, environment, subprocess, FFI and runtime
  import access denied; external I/O goes through capability-gated Host APIs.
- Schema-v2 browser code runs in an opaque sandbox through the bounded UI
  bridge. It receives no NAD cookies, raw secrets or same-origin access.
- SMTP, Telegram and ntfy credentials are core-owned. Plugins request delivery
  through `notifications.emit` and must not implement notification providers.
- Marketplace and manual upload use the same archive, signature, compatibility
  and capability verification path. Manual mode performs no Marketplace calls.
- Keep immutable package IDs, slugs, permissions, config keys, Widget IDs,
  layout references and compatibility aliases stable.

## Development and release rules

Use the repository-pinned pnpm version and run the full gate sequentially:

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm audit --prod
```

Do not run typecheck and build concurrently because Next.js regenerates types.
Normal pushes run the native image gate; emulated ARM64 work is release-only.
Production migrations must remain ordered, idempotent and embedded in
`src/lib/db/migrate.ts`.

Keep strict TypeScript, use exact server-side permissions, bound all external
data and time, redact secrets, preserve unrelated dirty-worktree changes and
add focused regression tests. Update current documentation when behavior
changes. Store release results as new dated evidence; never rewrite earlier
evidence or describe a candidate as supported before every applicable release
check has passed.
