# Security policy

NAD is self-hosted software that executes separately signed packages through a
restricted broker. Reports should name the affected core/package version and
exact artifact digest where applicable.

## Supported versions

NAD has no supported public version yet. Core `0.3.2` is a release candidate and
receives pre-release security fixes; `0.2.8` is the latest recorded safe private
rollback deployment, not a promised public support line. The proposed policy is
in [`docs/SUPPORT.md`](docs/SUPPORT.md) and becomes effective only after the
first public release gate passes.

A signed Marketplace revocation may quarantine an exact artifact or signing key
independently of the core support window.

## Reporting

Until public GitHub private vulnerability reporting is configured, contact the
repository owner through the private source host and request a confidential
channel. Never open a public issue containing credentials, exploit details,
private host data or an unpublished package.

Include:

- affected revision, core/API versions and deployment shape;
- minimal reproduction steps using disposable data and credentials;
- whether authentication, signatures, sandboxing or secret handling is involved;
- the smallest safe evidence needed to reproduce the issue.

Never send production databases, `APP_SECRET`, `AUTH_SECRET`, signing keys,
notification credentials or App connection secrets.

## Response expectations

This is a maintainer-supported hobby project without an SLA. Receipt is
normally acknowledged within seven days. A critical package issue may first be
handled by a signed warning or exact-digest/key quarantine while a clean
replacement is prepared. Security state does not silently delete user
configuration, Workspaces or retained artifacts.
