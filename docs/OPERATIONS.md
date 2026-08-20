# Core operations and recovery

> Current release note: there is no supported public NAD image yet. Substitute
> only an exact reviewed image digest; do not use an invented or mutable tag.

This runbook covers NAD's supported target shape: one Linux container/replica,
SQLite and Plugin artifacts on a persistent local volume, behind a trusted TLS
reverse proxy. Reviewed images target `linux/amd64` and `linux/arm64`.

## Deployment identity

Production configuration requires strong, independent `APP_SECRET` and
`AUTH_SECRET` values, matching HTTPS `APP_URL`/`AUTH_URL`, a persistent
`/app/data` volume and either:

```text
NAD_MARKETPLACE_MODE=online
NAD_MARKETPLACE_URL=https://nad.robrolabs.com
```

or `NAD_MARKETPLACE_MODE=manual`, which retains uploads and must perform no
Marketplace requests.

Pin an immutable image digest in the retained Compose definition. After start:

- `/api/health` must report healthy and the expected migration;
- admin-protected `/api/build-info` must match OCI version, full revision,
  creation time, source, Host/UI API and schema versions;
- the container must run as UID/GID `1001:1001`, use Debian Bookworm and report
  Deno `2.7.7`;
- a fresh volume must contain zero installed feature Plugins.

The normal public installation will pull a combined `amd64`/`arm64` image.
Source builds use the explicit `docker-compose.build.yml` contributor override
and are not an end-user installation path.

## Versioned installation bundle

Each supported release supplies a small `NAD-<version>-installation-bundle.zip`
and adjacent `.sha256` file. The archive contains only `compose.yaml`, a blank
environment example, concise operator instructions, a file checksum list and a
machine-readable release manifest. It contains no source tree, build context,
credentials, private hostname or mutable image tag.

Release maintainers generate it only after the combined registry manifest is
available:

```bash
node scripts/generate-install-bundle.mjs \
  --version <version> \
  --revision <full-git-sha> \
  --image-repository ghcr.io/robrolabs/nad \
  --image-digest sha256:<combined-manifest-digest> \
  --out <empty-release-directory> \
  --validate-compose
```

The generator rejects missing or malformed identities, mutable image references
and output replacement. Its fixed-time ZIP format makes identical inputs produce
identical bytes. The tag workflow repeats generation after publishing the
combined manifest, verifies the archive and attaches both files to the GitHub
Release. End users should extract that bundle, copy `.env.example` to `.env`,
set independent secrets and run `docker compose -f compose.yaml up -d`; they
must not clone this repository or add a `build:` override.

## Backups

`scripts/backup.mjs` uses SQLite's online backup API and writes manifest-v2
bundles containing database migration/digest/size and every active or retained
Plugin file with its SHA-256 and size. Directories use mode `0700`; files use
`0600`.

Create, verify and retain a backup:

```bash
docker exec <nad-container> \
  /nodejs/bin/node scripts/backup-maintenance.mjs

docker exec <nad-container> \
  /nodejs/bin/node scripts/verify-backup.mjs \
  /app/data/backups/<bundle> --disposable
```

Defaults retain 14 bundles in `/app/data/backups`. Configure
`NAD_BACKUP_DIRECTORY` and `NAD_BACKUP_RETENTION_COUNT` if needed. Pruning begins
only after the new bundle passes database integrity, foreign-key, migration,
digest and artifact-inventory checks.

Schedule the maintenance command daily through a sidecar or the hosting
platform. Resolve the active service using Compose labels, require exactly one
match and do not bind automation to a generated container name. Run a new
schedule manually once. Copy at least one verified bundle to storage outside
the NAD volume; a volume-local copy does not protect against volume loss.

## Restore drill

Restore only while the target NAD process is stopped:

1. Keep the source bundle immutable.
2. Create a uniquely named disposable volume/container.
3. Restore `nad.db` and the bundle's complete `modules/` tree together.
4. Start the exact compatible image and matching Compose definition.
5. Verify database integrity, migration, login, users, notifications,
   Workspaces, connections, grants, active/retained inventory and artifact
   digests.
6. Execute representative installed Plugins.
7. Record evidence, then remove only the disposable resources.

A database-only copy is not a complete backup when Plugins are installed. Do
not copy `nad.db` directly while WAL writes may be active.

## Offline administrator recovery

NAD deliberately has no unauthenticated web password reset. If every admin
credential is unavailable, first take and verify a complete backup, stop NAD,
then run the exact installed image against the stopped volume:

```bash
read -r -s NAD_RECOVERY_PASSWORD
printf '%s' "$NAD_RECOVERY_PASSWORD" | docker run --rm -i \
  --user 1001:1001 \
  -e DATABASE_URL=file:./data/nad.db \
  -v dashboard_data:/app/data \
  --entrypoint /nodejs/bin/node \
  <exact-nad-image@sha256:digest> \
  scripts/admin-recover.mjs \
  --email admin@example.com --password-stdin --confirm-offline
unset NAD_RECOVERY_PASSWORD
```

The command accepts only an existing administrator, hashes the new password,
increments `auth_version` to invalidate sessions and records a safe recovery
audit row. Restart NAD and prove the previous password/session fails.

## Upgrade and rollback

Before upgrading, retain the current image digest, its Compose definition and a
verified external backup. Test the candidate against a copy of production data.

If no migration was applied, the previous image may reuse the existing volume.
After a migration, stop the candidate and restore the complete pre-upgrade
bundle before starting the previous image. Never attach an older core to a
database migration it does not understand. A newer Compose file may also use
runtime or health paths absent from the older image, so roll back image and
definition together.

Record the final container ID, start time, image digest, build-info, migration,
restart count and representative Plugin results. Do not infer release identity
from health alone.
