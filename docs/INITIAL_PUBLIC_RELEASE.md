# Initial public release board

> Audit date: 2026-08-14
> State: **not ready for public installation**
> Candidate: core `0.3.2`; latest safe live core `0.2.8`

This temporary board is the release authority until the first supported public
version ships. It covers core, Marketplace, official Plugins and the Plugin
Development Kit without reopening completed architecture work.

## Current disposition

| Area | Position |
|---|---|
| Core architecture | Implemented for a single-node homelab deployment |
| Final release gate | Incomplete; run `1404` failed, but its browser packaging defect is fixed and the clean exported-source browser gate now passes locally |
| Public source | No reviewed GitHub snapshots yet |
| Public core image | No anonymous `0.3.2` image or multi-architecture manifest yet |
| Live deployment | Safe rollback is `0.2.8`; `0.3.2` not promoted |
| Marketplace | Live first-party catalogue exists; artifact storage reorganisation outstanding |
| Plugin Development Kit | Source components exist; standalone deterministic download and v2 clean-room proof outstanding |
| Community publishing | Disabled and out of scope |

NAD targets Linux `amd64` and 64-bit `arm64`. It does not support 32-bit ARM.
End users will pull a prebuilt multi-architecture image; ordinary installation
must never run the source build or QEMU.

## Release blockers

### Exact source and CI

- [x] Fix the browser test packaging failure from run `1404`. The test now uses
  `better-sqlite3` directly and passed from a clean public-source export on
  2026-08-14.
- [ ] Merge reviewed changes and record one clean release SHA.
- [ ] Pass frozen install, tests, lint, sequential typecheck/build, production
  audit, browser and secret scans on that exact SHA.
- [ ] Pass native `amd64` image checks and explicitly dispatch the release-only
  `arm64` source/image gate. Do not restore QEMU to normal pushes.
- [ ] Create annotated tag `v0.3.2` only after all exact-SHA checks pass.

### Public source snapshots

- [ ] Create empty public `robrolabs/nad`, `robrolabs/nad-marketplace` and
  `robrolabs/nad-plugins` repositories.
- [ ] Export through explicit allowlists; exclude evidence, private hosts,
  credentials, environment/database/browser files, keys and unfinished Plugins.
- [ ] Run full-history/private-ledger and unpacked-export secret scans.
- [ ] Publish one reviewed snapshot commit and annotated tag per release, then
  run public CI from the exported commit.
- [ ] Record private SHA → public SHA → image/package digest mappings privately.

### Prebuilt images

- [ ] Publish immutable `0.3.2-amd64` and `0.3.2-arm64` images.
- [ ] Publish a combined `0.3.2` manifest so Docker selects the architecture.
- [ ] Record manifest and architecture digests, OCI/build-info identity,
  non-root UID/GID, Debian Bookworm, Deno `2.7.7` and vulnerability scan.
- [ ] Pull on clean native `amd64` and native `arm64` hosts and prove the normal
  Compose flow performs no local build.

### Live promotion and recovery

- [ ] Retain a pre-upgrade database-plus-artifact backup outside the NAD volume.
- [ ] Deploy the exact public digest and verify build-info, migration 10, zero
  built-in Plugins and both online/manual installation controls.
- [ ] Verify login, RBAC, notifications, Workspaces, System Monitor and Proxmox;
  restart and confirm users, settings, connections, grants, layouts and package
  artifacts persist.
- [ ] Run the scheduled backup and restore it into a disposable volume using the
  exact image. Verify login and live Plugin execution before cleanup.
- [ ] Complete reverse-proxy/browser checks and the observation window with no
  unexplained restarts or blocking logs.
- [ ] Add new exact evidence and replace Phase 8 placeholders only with observed
  results.

### Public installation path

- [ ] Add a Marketplace **Get NAD** page containing the versioned Compose file,
  environment template, secret generation, reverse-proxy, upgrade, backup and
  rollback guidance.
- [ ] Publish a versioned installation bundle that references the same immutable
  registry digest and contains no credentials.
- [ ] Prove setup, Marketplace install, manual upload and recovery using only
  public documentation and downloads.

## Plugin release position

- [ ] Revalidate System Monitor `1.0.3` and Proxmox VE `1.0.2` on the final
  public image before listing them as supported reference Plugins.
- [ ] Keep Network/Pi-hole and Unraid Preview-only and unrecommended until their
  approved-target tests pass.
- [ ] Standardize released Widget states, resize behavior, profile selection,
  themes and accessibility, and add real Marketplace screenshots.
- [ ] Ensure every package's source tag, manifest, signature, checksum, byte
  size, release record and catalogue entry agree.

Network/Unraid target proof does not block the core release while those packages
remain clearly Preview. Docker Operations remains deferred.

## Plugin Development Kit gate

The canonical SDK, schemas, CLI, testkit and templates live under `devkit/` in
`nad-plugins`. First-party source lives under `plugins/official/` but is excluded
from the Devkit archive. A Widget command is a shortcut that creates a valid App
or Add-on surface, not a third executable package kind.

- [ ] Generate one deterministic architecture-neutral ZIP containing concise
  human and agent instructions, v2 contracts, templates, local SDK/testkit/CLI
  tarballs, setup/create/check scripts and an empty `custom-plugins/` workspace.
- [ ] Exclude official/community Plugins, `.nadmod` releases, source maps,
  compiled tests, caches, keys, evidence and operator tooling.
- [ ] Make the bundle independent of npm publication and sibling repositories.
- [ ] In a clean extracted directory, create, preview, test and pack one App with
  a Widget and one dependent Add-on; cover profiles, denied access, errors,
  timeouts and unavailable/revoked state.
- [ ] Install the generated packages manually into the final core image and
  prove sandbox, profile selection and secret isolation.
- [ ] Publish the ZIP, checksum, signed version/contract manifest and a
  Marketplace **Build Plugins** page with a five-minute start and agent prompt.

## Artifact and Marketplace dependencies

Before the first public Plugin/Devkit release, Marketplace operations must:

- [ ] serve canonical immutable files from the private R2 bucket through
  same-origin `/downloads/*` routes;
- [ ] reject overwrites and verify digest, size, range responses and immutable
  cache headers before advancing signed metadata;
- [ ] remove duplicated tracked `.nadmod` downloads from website source; and
- [ ] retain GitHub Releases only as public source/artifact mirrors.

## Exit criteria

The release is ready only when a new user can, from public documentation alone:

1. inspect the reviewed source snapshot;
2. pull the immutable multi-architecture image without compiling it;
3. complete setup on native `amd64` or `arm64`;
4. install and use a supported Plugin from the Marketplace;
5. back up and restore core plus active/retained Plugin artifacts; and
6. download the Devkit, build a compatible Widget/App and install it manually.
