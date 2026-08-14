# Reusable Release Checklist

> Last reviewed: 2026-08-14
>
> This is an unchecked template. Store executed evidence in a dated directory
> under `docs/evidence/`; do not check items permanently in this file.

## 1. Identify the release

- [ ] Record the source commit, core version, image digest, database migration
  version, deployment target, operator, date, and intended release scope.
- [ ] Confirm the worktree contains no secret, database, private key, browser
  state, or unrelated user-owned change.
- [ ] State every accepted limitation and every Module path excluded from the
  release claim.

## 2. Run the sequential source gate

Use the repository-pinned pnpm version and do not run typecheck and build in
parallel.

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm audit --prod
```

- [ ] All commands pass and their versions/counts are recorded.
- [ ] Canonical schema-v1 and schema-v2 contract digests match the SDK, core and
  Marketplace consumers; the generated v1 bundle has no unintended diff.
- [ ] CI passes for the exact release commit.
- [ ] No unresolved high/critical production advisory exists, or an explicit
  accepted-risk record names the owner and expiry.

## 3. Build and inspect the image

- [ ] Build without mutable dependency selection and record the image digest.
- [ ] The explicit pre-release workflow dispatch passes native `amd64` and
  emulated `arm64` source/image gates. Normal development pushes must not run
  the hour-long QEMU build.
- [ ] Confirm the final image runs as non-root, writes only expected volumes,
  contains the intended core version, and has the real `/api/health` probe.
- [ ] Scan the image and bounded startup logs for vulnerabilities and accidental
  secret/config inclusion.
- [ ] Retain the previous verified image and a compatible database backup.

## 4. Fresh-volume behavior

- [ ] The documented end-user Compose command pulls the published immutable
  multi-architecture image without a local source build on both `amd64` and
  `arm64`; source builds require the explicit developer override.
- [ ] Start with a new volume and strong distinct `APP_SECRET`/`AUTH_SECRET`
  values plus canonical HTTPS URLs.
- [ ] `/api/health` becomes healthy with the expected migration version.
- [ ] Setup creates exactly one administrator, stores branding/canonical URL,
  refuses concurrent/repeat completion, and reaches canonical login.
- [ ] Static assets, security headers, JSON API authentication failures, and the
  branded not-found path behave correctly.

## 5. Upgrade and persistence

- [ ] Back up the existing installation with `pnpm db:backup` or the equivalent
  container command before replacing the image; confirm the bundle contains the
  database, manifest, and every required Module artifact.
- [ ] Upgrade a copy of production data first; migrations apply once and
  `foreign_key_check`/integrity checks pass.
- [ ] Restart preserves users, sessions where compatible, app settings, Module
  enablement/config, named connection generations/access, exact-digest trust,
  permissions, Workspaces/layouts, audit rows, and notification channels.
- [ ] Restore the backup into a uniquely named disposable volume and verify
  login plus representative configuration before deleting only the disposable
  resources.

Do not copy only `nad.db` while WAL writes may be active.

## 6. Authentication, access, and authorization

- [ ] Unknown-user and wrong-password failures do not enumerate accounts.
- [ ] Login throttling blocks the documented threshold and a disposable process
  restart restores access as designed.
- [ ] Admin/member/restricted navigation and API isolation pass.
- [ ] Dynamic grant/revoke and last-admin demotion/deletion guards pass.
- [ ] Workspace assignment, surface/operation access, connection-profile access,
  personal-Workspace creation policy and role membership are enforced on every
  server call. Revocation leaves only a generic unavailable layout state.
- [ ] Administrator reset and self-service password change invalidate previous
  sessions and write safe audit records.
- [ ] Canonical access locking redirects pages, rejects foreign-origin APIs with
  JSON `NON_CANONICAL_HOST`, leaves health/setup recovery reachable, and has a
  proven break-glass path.

## 7. Core administration and recovery

- [ ] Schema-v1 configuration and schema-v2 named connections validate their
  signed schemas, encrypt secrets, preserve omitted secret values and never put
  secret masks/values in browser, Add-on, diagnostic or log payloads.
- [ ] Workspace/tab/Widget/surface add/remove/resize/reload, connection selection
  and injected save-failure recovery pass for permitted and inaccessible state.
- [ ] Audit filtering/pagination and historical actor retention pass.
- [ ] A real notification channel passes encrypted CRUD, secret-preserving
  update, Send test, lifecycle trigger delivery, failure sanitisation, and audit.
- [ ] Mobile overflow, keyboard focus restoration, headings, loading/error/empty
  states, light/dark themes, and recovery UI pass.

## 8. Installed Module and Marketplace validation

- [ ] Manual upload and online Marketplace install pass through the same package
  verifier and produce the same release identity/digest.
- [ ] Invalid signatures, untrusted keys, checksum/path/archive attacks,
  incompatible core/API versions, duplicate identities, and oversized packages
  are rejected without activating a release.
- [ ] The administrator sees and explicitly approves the exact capability,
  permission, host-access and data-migration diff before activation.
- [ ] Stored grants—not merely manifest declarations—authorize every host call.
- [ ] A Module cannot directly read environment/secrets, write files, spawn a
  process, import runtime code, or reach the network; broker limits and schema
  validation fail closed.
- [ ] A v2 App with at least two named profiles executes using the exact
  authorized pinned generation. A dependent Add-on invokes only its declared
  operation and never receives App configuration or credentials.
- [ ] Custom Widget/page HTML runs only in the opaque nested sandbox. Constructed
  navigation, external assets, direct fetch, popups/forms/frames, forged/replayed
  bridge messages, repeated loads, oversized messages and diagnostic floods fail
  closed without leaking binding results.
- [ ] Trust/review is bound to the exact release digest, never inherited by an
  update, and cannot override a signed quarantine/revocation.
- [ ] Enable/configure/query/RBAC/degraded behavior, central notification
  emission, timeout/concurrency isolation, and restart-free update pass.
- [ ] Rollback, uninstall/disable, retained artifacts, configuration/layout/
  permission preservation, and backup/restore pass for the release scope.
- [ ] Manual-only mode makes no Marketplace request. Marketplace outage or an
  unavailable catalog does not affect login or installed Module execution.
- [ ] Only explicitly approved real targets and credentials are used; mutation
  final states and safe cleanup are recorded.
- [ ] Excluded or unsafe paths remain explicitly unclaimed.

## 9. Deployment controls and observation

- [ ] HTTPS, split DNS, firewall/reverse-proxy access, proxy-overwritten
  forwarding headers, secure cookies, HSTS policy, and direct port exposure
  match the intended trust boundary.
- [ ] No unauthenticated or publicly exposed Docker Engine endpoint exists.
- [ ] Health, restart count, database growth, backup success, notification
  failure, upstream failure, and bounded logs are observed for the agreed period.
- [ ] Results and cleanup are recorded in a new dated evidence directory.

## 10. Marketplace publication gate

- [ ] The catalog references an immutable, accessible artifact whose SHA-256 and
  byte count match the generated record.
- [ ] The package was built reproducibly from tagged first-party source,
  reviewed, signed outside the Marketplace image, and verified by a clean core.
- [ ] Detail/docs/source/license/review/compatibility fields match the package.
- [ ] `/api/v1` compatibility resources remain stable; `/api/v2` App/Add-on/
  Collection details, connection requirements, surfaces, dependencies and
  selected-Collection permissions match verified signed records.
- [ ] Health, cache policy, TLS, base-path portability, download limits, previous
  version retention, and rollback of a bad catalog publish are tested.
- [ ] Public trust keys, rotation instructions, and any advisory/revocation data
  are current. Community submission gates apply only after that feature opens.

Cross-repository package and Marketplace gates must also use the current
release procedures in `nad-plugins` and `nad-marketplace`. Do not substitute an
old core planning document for those repository-owned instructions.
