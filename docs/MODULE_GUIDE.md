# External App and Module Development Guide

> Last verified: 2026-08-13

NAD core contains no compiled feature Apps or Modules. Installable packages,
their SDK, schemas, testkit, CLI, and first-party source live in the separate
`nad-marketplace-modules` monorepo. The hosted catalog lives in the separate
`nad-marketplace` repository.

## Where to work

```text
nad-marketplace-modules/
  packages/sdk/       public types, validation, deterministic packaging
  packages/testkit/   fake core services and contract tests
  packages/cli/       nad and nad-module create/check/pack/verify/dev
  schemas/            immutable v1 and additive v2 contracts
  examples/           schema-v2 reference App and Add-on pair
  modules/            first-party Module source directories
  keys/               public release keys only
```

Do not add Module code, React components, upstream clients, settings forms, or
provider-specific notification code to the NAD core repository.

## Choose the package model

- Use a schema-v2 **App** for an integration boundary that owns named
  connections, credentials, brokered upstream access and versioned operations.
- Use a schema-v2 **Add-on** for separately installable Widgets/pages that
  depend on an App and invoke only its declared operations. An Add-on must not
  duplicate connection secrets, HTTP credentials or upstream clients.
- A **Collection** is Marketplace-only editorial grouping and an optional
  Workspace template. It contains no executable code and is not a `.nadmod`.
- Schema-v1 **Modules** remain supported for existing packages. Their IDs,
  slugs, `.nadmod` extension, database identity and `/api/modules` routes are
  compatibility contracts, not a reason to author new v1 packages.

## Schema-v2 authoring workflow

1. Run `nad app create <directory> --id <app-id>` or
   `nad addon create <directory> --id <addon-id> --app <app-id>` in the public monorepo. The
   generated `AGENTS.md` is sufficient context for a local Codex task.
2. Give the package an immutable reverse-domain ID and kebab-case slug. Declare
   its exact core, Host API, UI API and package-schema compatibility.
3. For an App, declare a connection schema and exported versioned operations.
   Core encrypts secret fields and browser/user summaries contain only profile
   ID, name and default status. Package code receives opaque secret references;
   core injects their value only into an exact signed HTTP binding.
4. For an Add-on, declare one compatible App dependency, the exact operation
   bindings it consumes and its surface connection slots. It cannot declare the
   App's credential schema or upstream HTTP scopes.
5. Keep `server/main.js` import-free when runtime code is required. A UI-only
   Add-on may omit it. Server code runs in short-lived Deno without direct
   filesystem, network, environment, subprocess, FFI or runtime-import access.
6. Put each custom Widget/page in one self-contained
   `ui/surfaces/*.html` file. Do not use external scripts, styles, images,
   frames, forms, navigation or direct network calls. Use the typed UI bridge
   for declared bindings, connection selection, theme, resize, navigation and
   bounded diagnostics.
7. Exercise operations and surfaces with testkit fixtures, including denied
   access, hostile input, partial upstream responses, secret non-disclosure and
   compatibility boundaries.
8. Run test, lint, typecheck, build, `nad-module check` and deterministic pack.
   Public releases require an approved offline Ed25519 release key and a
   canonical release record.

## Schema-v1 compatibility workflow

1. Copy the smallest relevant schema-v1 Module directory in the official
   monorepo and give it a new immutable reverse-domain ID and kebab-case slug.
2. Declare settings in `manifest.json`. Secret values remain encrypted in core;
   Module code receives opaque secret references, not raw secrets.
3. Declare each endpoint as a query or mutation with its exact permission,
   handler, request/response schemas, timeout class, and byte limits.
4. Request only brokered capabilities the Module actually uses. Initial v1
   services are `config.get`, `http.request`, `notifications.emit`, namespaced
   storage, and safe audit annotation.
5. If requesting `http.request`, declare every allowed scheme, non-secret host
   config field, port source, exact/constrained path, method and read/write
   effect in `httpAccess`. Declare runtime header/query allowlists and an
   enforceable body policy for read-effect POST/DELETE. Core may inject one
   declared credential into one exact header, query key or JSON-body field;
   Module code cannot read or override it. A configured hostname grants no
   other endpoint on that machine.
6. Bundle one import-free `server/main.js`. It runs in a short-lived Deno
   process without direct filesystem, network, environment, subprocess, FFI,
   or runtime-import access.
7. Describe Pages and Widgets with the v1 declarative UI vocabulary. Modules do
   not ship browser JavaScript, HTML, arbitrary CSS, iframes, or external assets.
8. Exercise handlers with the testkit and fixtures. Transform and validate
   upstream data before it reaches core.
9. Run `nad-module check`, test, typecheck, build, then `nad-module pack`.
10. Use unsigned development packages only with the explicit local development
   gate. Public releases must be Ed25519-signed by an approved release key.

## Core-owned services

Authentication, RBAC, configuration UI/storage, encryption, audit identity,
notifications (SMTP, ntfy, Telegram), Marketplace verification,
Workspaces/layout, connections, and package storage belong to core. A package requests these
services through the host API; it must not recreate them.

For example, a Module that detects a fault calls `notifications.emit`. Core
attributes the event to that Module and dispatches it through the operator's
centrally configured channels.

## Installation and compatibility

One `.nadmod` ZIP is used for Marketplace download and manual upload. NAD checks
archive bounds, paths, file types, checksums, Ed25519 signature, immutable ID,
SemVer compatibility, capabilities, permissions, endpoint schemas, and UI
references before storing it under the persistent data directory.

Compatibility is split across core, host API, UI API, and package schema
versions. Keep slugs, permission actions, config keys, Widget IDs, and audit
attribution stable across compatible updates.

Core `0.3.0` accepts compatible schema-v1/Host/UI API `1.0` packages and
schema-v2/Host/UI API `2.0` packages side by side. Each invocation pins its exact
active release. Schema-v2 operations also pin the authorized connection
generation, and Add-on calls pin both caller and target App releases. Access,
dependency compatibility, revocation and input/output schemas are rechecked on
the server.

## Current references

System Monitor `1.0.3` is the current reference package. It preserves the
previous `system-monitor`, `host-grid`, and `uptime-status` identifiers, uses the
core HTTP broker for endpoint-scoped Node Exporter/reachability queries, and is
rendered through declarative UI. Its administrator-only notification-test
mutation calls `notifications.emit`; the live Phase 1 proof delivered the event
through a core-owned ntfy channel. Compatible `1.0.1` and `1.0.2` releases remain
available as rollback and restore fixtures.

The public SDK additionally contains a schema-v2 Proxmox App and a UI-only
Proxmox Guest Controls Add-on. Their real signed proof packages passed install,
two-profile secret isolation, App self-invocation, Add-on-to-App invocation,
opaque-surface browser isolation and restore. They are development references,
not published Marketplace releases.

See [`MODULE_SDK_PLAN.md`](MODULE_SDK_PLAN.md) for the runtime/lifecycle design,
[`MARKETPLACE_PLAN.md`](MARKETPLACE_PLAN.md) for hosted delivery, and the
official monorepo README/AGENTS file for runnable commands.
