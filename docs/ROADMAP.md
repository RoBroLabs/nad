# NAD outstanding roadmap

> Reviewed: 2026-08-14
>
> Scope: work that is incomplete, unverified or deliberately deferred.

The temporary first-release sequence is maintained in
[`INITIAL_PUBLIC_RELEASE.md`](INITIAL_PUBLIC_RELEASE.md). Completed phase plans
have been removed from the active documentation; immutable evidence remains in
the private repository.

## P0 — Initial public release

- [ ] Freeze one exact `0.3.2` revision and make the source, browser, secret,
  native `amd64` and release-only `arm64` gates pass. The run `1404`
  Playwright/TypeScript import defect is fixed and the clean exported-source
  browser test passes locally; public CI and image gates remain outstanding.
- [ ] Create reviewed public snapshot repositories for `nad`,
  `nad-marketplace` and `nad-plugins`; run allowlist, licence, link and secret
  checks before the first push.
- [ ] Tag `v0.3.2` only after the exact release SHA passes. Publish immutable
  `amd64` and `arm64` images plus a combined manifest and record all digests.
- [ ] Prove clean native pulls, fresh setup, upgrade, restart persistence,
  scheduled backup, disposable restore and rollback using only public bytes.
- [ ] Complete live browser, reverse-proxy and observation checks, then add new
  immutable evidence without rewriting the rejected canaries.
- [ ] Publish a versioned installation bundle and Marketplace **Get NAD** page.
- [ ] Publish a deterministic, first-party-free Plugin Development Kit and
  prove an App/Widget plus dependent Add-on through clean-room creation,
  packaging and manual installation.

## P1 — First-party Plugin quality

- [ ] Revalidate System Monitor `1.0.3` and Proxmox VE `1.0.2` on the final
  public core image before describing them as supported.
- [ ] Keep Network/Pi-hole and Unraid labelled Preview and unrecommended until
  their approved-target credentialed tests pass.
- [ ] Standardize Widget names, resize bounds, connection selection,
  loading/empty/error/degraded states, themes and accessibility.
- [ ] Add real screenshots for every released Widget and Plugin Page.
- [ ] Evidence-back every advertised oldest-core compatibility value.
- [ ] Publish provider-neutral source links and make package, checksum,
  signature, release record, catalogue and source tag agree exactly.

## P1 — Marketplace and artifact publication

- [ ] Move canonical immutable Plugin and Devkit downloads to the planned
  private R2 bucket through same-origin `/downloads/*` routes.
- [ ] Reject artifact overwrites; verify content length, digest, range reads and
  immutable cache headers before advancing signed catalogue metadata.
- [ ] Stop tracking duplicate `.nadmod` files in Marketplace source after R2
  migration and preserve GitHub Releases only as inspected-source/artifact
  mirrors.
- [ ] Keep ordinary website builds independent of R2 write credentials.
- [ ] Keep community intake disabled until production identity, moderation,
  isolated validation, recovery and key-custody responsibilities are assigned.

## P1 — Developer product

- [ ] Restructure the private Plugin workbench into `devkit/`,
  `plugins/official/`, `plugins/community/` and `policies/` without including
  unfinished Plugins in public exports.
- [ ] Fix scaffold dependency/version and licence metadata.
- [ ] Remove tests, source maps, cache and compiled clutter from published local
  SDK/testkit/CLI tarballs.
- [ ] Complete v2 surface preview for profiles, bridge failures, timeouts,
  access loss and revocation/unavailable states.
- [ ] Give generated Apps and Add-ons executable profile/access/error tests.
- [ ] Establish a private `nad-personal-plugins` workspace that consumes the
  same released Devkit and is excluded from every public export.

## P2 — Product hardening after launch

- [ ] Add deeper browser coverage for install review, offline Marketplace,
  package updates and declarative/sandboxed Widget states.
- [ ] Consider an optional first-run Plugin chooser; Marketplace failure must
  never block core setup.
- [ ] Rehearse quarterly dependency, support-window, signing-key and restore
  reviews.
- [ ] Measure image size, idle memory, startup and cold Plugin invocation on
  both supported architectures before optimizing further.

## Explicitly deferred

- Generic Docker/Compose administration without a distinct safe fleet-level
  product case.
- Community accounts, public submission intake, ratings and comments.
- Public npm publication, visual Widget builder and IDE extensions.
- OIDC, multi-replica or PostgreSQL core, shared job services, webhooks and
  streaming.
- Same-origin trusted Plugin UI, alternative runtime fleets, payments and
  analytics.

Deferred items require a concrete user need, security boundary and acceptance
test before they enter an active milestone.
