# NAD core status

> Last reviewed: 2026-08-20
>
> Current state: **`0.3.2` source candidate; no supported public release**
>
> Latest recorded safe live core: **`0.2.8`**

This is the canonical current-state document. The release blockers are in
[`INITIAL_PUBLIC_RELEASE.md`](INITIAL_PUBLIC_RELEASE.md); other outstanding work
is in [`ROADMAP.md`](ROADMAP.md).

## Assessment

The core architecture is substantially complete for a single-node homelab
Dashboard. NAD contains no built-in feature Plugins. Authentication, RBAC,
encrypted configuration, core-owned notifications, Workspaces, package
verification/lifecycle, isolated execution, signed Marketplace security state
and artifact-aware backup are implemented.

That implementation is not yet a supported public product. The reviewed public
source candidate and its GitHub CI gate now exist, but no public `v0.3.2` tag or
anonymously pullable core image exists. The end-user installation and live
recovery flow have not been proven solely from public bytes.

## Release identity

| Identifier | Verified value |
|---|---|
| Source version (`VERSION`, `package.json`) | `0.3.2` |
| Supported public core | None yet |
| Source candidate identity | Exact private/public SHA mappings are retained in private release staging so status documentation does not become stale when a reviewed pre-release workflow changes |
| Public candidate CI | GitHub run `31796490683` passed source, browser, secrets and native `amd64` image gates for the preceding public snapshot; the current native-arm64 preflight is a separate release blocker |
| Earlier private Phase 8 run `1404` | Revision `7636bf1d3cdddc3b455bc906c1bc4e44a1a03612`; browser job failed because Playwright's CommonJS runtime could not dynamically import a TypeScript module |
| Current browser position | The fix replaced that runtime TypeScript import with direct `better-sqlite3` use; the public snapshot browser job passed in run `31796490683` |
| Current release tag | No `v0.3.2` tag; `v0.3.0` and `v0.3.1` are withdrawn |
| Latest safe live core revision | `99d297554a2b7782969472ba331dc5327485921f` (`0.2.8`) |
| Latest safe live image | `nad:0.2.8-99d297554a2b` |
| Latest safe live image digest | `sha256:3057ff787a5c94aef48f83e536f6dac7262f7aa871f1840ef39006bd1ddcfbb1` |
| Source database migration | `10` |
| Supported package schemas | `1`, `2` |
| Supported Host/UI API versions | `1.0`, `2.0` |
| Pinned Deno | `2.7.7` |
| Public CPU targets | Linux `amd64`, Linux `arm64`; no 32-bit ARM |

The public candidate is not a release tag. Release-only native `arm64` image
publication, anonymous pulls and live validation still must pass before support
is declared. `/api/build-info` and OCI labels, not the health endpoint alone,
must identify a deployed release.

## Implemented core

| Area | Current behavior |
|---|---|
| Identity | First-run admin, Auth.js credentials, session invalidation, three roles and canonical-origin enforcement |
| Authorization | Server-enforced Plugin, surface, operation, connection-profile and Workspace access |
| Persistence | SQLite WAL, foreign keys, ten ordered migrations, audit, package/config/grant state, named connections and Workspaces |
| Secrets | AES-256-GCM encrypted config and connection generations; browsers/Add-ons receive only opaque presence state |
| Notifications | Core-owned email/SMTP, Telegram and ntfy configuration and bounded dispatch through `notifications.emit` |
| Package trust | Bounded ZIP parsing, safe paths/files, complete checksums, Ed25519 signatures, compatibility/capability checks and exact-digest trust |
| Lifecycle | Common Marketplace/upload verification, immutable artifacts, hot activation, rollback, disable and retained uninstall/reinstall |
| Runtime | Short-lived Deno with direct network/env/write/run/sys/FFI/import denied; external operations use Host APIs |
| Apps/Add-ons | Named profiles, pinned generations, versioned App operations and dependency-authorized Add-on calls without credential exposure |
| UI | Core-rendered schema-v1 surfaces and opaque schema-v2 sandbox surfaces with a bounded typed bridge |
| Marketplace security | Signed sequenced recommendations, advisories and revocations; last-known-good cache and exact-digest/key quarantine |
| Recovery | Database plus active/retained artifact backups, disposable verification and offline existing-admin recovery |

## Repository boundary

| Repository | Owns |
|---|---|
| `nad` | Core application, compatibility consumers, package host, Workspaces and private deployment evidence |
| `nad-marketplace` | Public website/catalogue, signed metadata, immutable artifact delivery and Marketplace operations |
| `nad-plugins` | Development Kit, canonical schemas/SDK/CLI/testkit and reviewed Plugin source |

Private Gitea remains the development ledger. The initial GitHub repositories
contain reviewed release snapshots rather than mirrors of private operational
history.

## Plugin evidence

| Plugin | Current state |
|---|---|
| System Monitor `1.0.3` | Reference package with live restart, notification, rollback and artifact-restore evidence |
| Proxmox VE `1.0.2` | Live credentialed read/action, hot-update, restart and restore evidence |
| Network / Pi-hole `1.0.0` | Preview; approved dual-instance credentialed proof outstanding |
| Unraid `1.0.0` | Preview; approved Unraid 7.2+ credentialed proof outstanding |
| Proxmox schema-v2 App/Add-on | Disposable source proof only; not a Marketplace release |

No first-party Plugin is public-stable until its exact public source, package,
signature, release metadata and final-core validation agree. Community intake
is disabled. A generic Docker Operations Plugin remains deferred.

## What has and has not been proved

Proved in earlier immutable evidence:

- external schema-v1 package installation, persistence, update, rollback,
  disable/uninstall and artifact-aware restore;
- core notification brokering and bounded credential/HTTP host services;
- signed Marketplace recommendations, advisories, revocations and recovery;
- schema-v2 Apps/Add-ons, named connections, sandbox surfaces and Workspaces in
  disposable environments;
- Proxmox least-privilege live read/action and System Monitor runtime behavior.

Still unproved for a public release:

- release-tagged native `amd64` and `arm64` images and anonymous pulls (the
  reviewed public source candidate CI is green);
- native clean-machine pulls on both `amd64` and `arm64` without source builds;
- exact-image fresh setup, live upgrade, restart persistence, scheduled backup,
  disposable restore and observation;
- a public core installation bundle and a successful manual install of a
  Devkit-generated App/Add-on into the final public image (Devkit `0.3.0`
  itself is clean-room verified and available from the live Marketplace);
- Network dual-instance and Unraid credentialed live behavior.

The Phase 8 evidence directory intentionally retains placeholders for unfinished
deployment, recovery and live proof. Do not replace them with inferred results.

## Known boundaries

- Supported deployment target is one Linux container/replica using SQLite on a
  persistent local volume behind a trusted TLS reverse proxy.
- Local email/password is the current authentication path. OIDC, multi-replica
  core and a shared rate limiter are deferred.
- Manual Marketplace mode is supported and must make no Marketplace requests.
- Plugins cannot ship notification credentials or bypass the core broker.
- Community publishing remains disabled despite its private foundation work.
- Public support dates in [`SUPPORT.md`](SUPPORT.md) are proposals until the
  first release completes.

## Evidence

Private dated records remain under `docs/evidence/`. They are
excluded from public source snapshots and must never be rewritten to make a
later release appear complete.
