# Proposed support and compatibility policy

> Reviewed: 2026-08-14
>
> This policy becomes effective when the first supported public release ships.

NAD is a best-effort homelab project, not a commercial SLA. A supported release
means its documented installation, upgrade, security and recovery paths passed
the reusable release gate.

## Core release windows

| Core line | Current state | Proposed window |
|---|---|---|
| `0.3.x` | Candidate; no supported public release yet | Newest patch receives compatible fixes and security updates until at least 90 days after a successor line is supported |
| `0.2.x` | Private-beta/rollback history | No promised public window |
| `0.1.x` and older | Historical | End of life |

Core migrations are forward-only. Downgrade uses the retained pre-upgrade
image, matching Compose definition and complete backup, not reverse migrations.
There is no forced release cadence.

## API and package compatibility

| Surface | Position |
|---|---|
| Package schema 2, Host API 2.x, UI API 2.x | Current authoring target |
| Package schema 1, Host API 1.x, UI API 1.x | Frozen compatibility surface; removal date begins only after public support starts and notice is published |
| `.nadmod`, immutable IDs/slugs, database IDs and `/api/modules` aliases | Compatibility contract while schema 1 remains supported |
| Marketplace `/api/v2` | Current product catalogue |
| Marketplace `/api/v1` | Deployed compatibility API; removal requires a published transition window |
| Community workflow | Disabled; not a supported public contract |

A normal public-surface removal requires at least 180 days' notice, a
replacement and an upgrade/restore rehearsal. A signed critical digest/key
revocation may quarantine execution immediately while preserving local data;
revocation is a security action, not deprecation.

## Platform target

Release gates cover Linux `amd64` and 64-bit `arm64`, the Node and pnpm versions
pinned by each repository, Deno `2.7.7`, and Docker/Compose on one host. NAD core
uses one process/replica and SQLite on a persistent local volume behind a trusted
TLS reverse proxy. 32-bit ARM, shared-database replicas, network filesystems and
public direct-port exposure are outside the proposed `0.3.x` support boundary.

## Authentication

- Local email/password is the candidate `0.3.x` authentication path.
- There is no unauthenticated password-reset endpoint. Administrators can reset
  another user; users can change their own password with the current password.
- Complete admin loss uses the audited stopped-instance recovery command in
  [`OPERATIONS.md`](OPERATIONS.md).
- OIDC is deferred until linking, identifier collision, provider outage and
  local emergency access have a complete design and test matrix.
- The in-process login limiter is acceptable only for the single-replica target
  behind a proxy that overwrites client-address headers.

## Plugin scope

Core support does not imply support for every Plugin. System Monitor and
Proxmox are candidate reference integrations. Network/Pi-hole dual-instance and
Unraid credentialed validation remain unclaimed. Each Plugin publishes its own
compatibility, review and advisory state.
