# Core documentation

This directory contains active core guidance and private dated evidence. The
user-facing [`MODULE_GUIDE.md`](MODULE_GUIDE.md) is maintained separately from
this core-documentation cleanup.

## Active documents

| Document | Purpose |
|---|---|
| [`STATUS.md`](STATUS.md) | Canonical implementation, live identity and known limitations |
| [`INITIAL_PUBLIC_RELEASE.md`](INITIAL_PUBLIC_RELEASE.md) | Temporary board for the first supported public release |
| [`ROADMAP.md`](ROADMAP.md) | Outstanding and deliberately deferred work |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Durable core boundaries and data flows |
| [`OPERATIONS.md`](OPERATIONS.md) | Deployment, backup, restore, rollback and recovery |
| [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) | Reusable unchecked release gate |
| [`SUPPORT.md`](SUPPORT.md) | Proposed compatibility and support policy |
| [`PUBLIC_SOURCE.md`](PUBLIC_SOURCE.md) | Reviewed snapshot publication and private-evidence policy |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Development and review workflow |
| [`MODULE_GUIDE.md`](MODULE_GUIDE.md) | Package compatibility and authoring guide |

Marketplace architecture, catalogue publication and incident runbooks belong
in the separate `nad-marketplace` repository. SDK, testkit, CLI, schema and
Plugin development documentation belongs in `nad-plugins`.

## Evidence

[`evidence/`](evidence/README.md) is the private operator ledger. Records are
immutable descriptions of the source and deployment tested at that time; they
do not override current status. The Phase 8 directory is incomplete: it records
rejected `0.3.0` and `0.3.1` canaries plus partial `0.3.2` work, while final
deployment, recovery and live-gate placeholders remain open. A later audit also
confirmed CI run `1404` failed its browser job.

Evidence is deliberately excluded from public release snapshots because it can
contain internal hostnames, addresses and workstation paths.

## Precedence

When active documents disagree:

1. `STATUS.md` states what is currently true.
2. `INITIAL_PUBLIC_RELEASE.md` controls the first public release.
3. `ROADMAP.md` records other outstanding and deferred work.
4. `ARCHITECTURE.md` defines durable security and ownership boundaries.
5. Dated evidence explains earlier tests but never upgrades a current claim.
