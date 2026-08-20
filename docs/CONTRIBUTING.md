# Contributing

NAD `0.3.2` is a source candidate, not a supported public release. Keep changes
small, testable, and aligned with the real implementation described in
[`STATUS.md`](STATUS.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and the
outstanding work in [`ROADMAP.md`](ROADMAP.md).

## Setup

Requirements: Git, Node.js 20+, pnpm 9.x, and SQLite tooling for manual inspection.

```bash
git clone <configured-repository-url> nad
cd nad
pnpm install --frozen-lockfile --strict-peer-dependencies
cp .env.example .env.local
pnpm dev
```

Generate and configure explicit `APP_SECRET` and `AUTH_SECRET` values before testing encrypted Module config or production mode.

The normal `docker-compose.yml` intentionally pulls the published release so
homelab users never compile NAD. To exercise a source-built container, opt in
to the developer override:

```bash
docker compose --env-file .env.local \
  -f docker-compose.yml -f docker-compose.build.yml up --build -d
```

## Repository map

```text
src/app/                 pages, layouts, Route Handlers, Module proxy
src/components/          shell, Workspaces, sandbox host, Settings, shared UI
src/lib/auth/            Auth.js, rate limiting, permissions
src/lib/db/              schema, startup migrations, audit
src/lib/modules/         v1/v2 contracts, connections, provider/runtime/lifecycle
src/lib/workspaces/      Workspace, assignment, tab, instance and layout services
src/lib/marketplace/     configured hosted-catalog client
docs/                    active guidance and private dated evidence
```

Read [`MODULE_GUIDE.md`](MODULE_GUIDE.md) before changing the installed Module
contract. Plugin source belongs in the separate `nad-plugins` monorepo. Do not
add a `src/modules/` tree or compile
feature-specific clients and React components into core.

## Workflow

1. Start from an up-to-date branch.
2. Confirm `git status --short` and preserve unrelated work.
3. Add or update tests with the behavior.
4. Run focused tests during development.
5. Run the full gate sequentially before review:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm audit --prod
```

Do not run `typecheck` concurrently with `build`; both use `.next/types`.

Normal pushes deliberately run only the native-amd64 architecture image gate.
Before a release tag, manually dispatch **Native arm64 preflight** with the
exact candidate SHA. It uses a native `ubuntu-24.04-arm` runner and local-only
image tags; it cannot publish to a registry. It must not add an hour to ordinary
edit/push feedback.

After the release workflow has published the combined image manifest, it
generates and attaches the deterministic end-user installation bundle. Do not
hand-edit that ZIP or point it at a tag: use
`pnpm release:bundle -- --version … --revision … --image-repository …
--image-digest … --out … --validate-compose` with the exact immutable digest.

There is currently no `format` script. Follow the existing style and ESLint output.

## Database changes

Update both `src/lib/db/schema.ts` and the ordered migrations in `src/lib/db/migrate.ts`. Migrations must be safe for a fresh DB and an existing installation, synchronous, and idempotent through their recorded version. Add a migration test.

`pnpm db:push` is development-only. Production schema initialization occurs inside the app before requests can query the DB.

`pnpm db:generate`, `pnpm db:migrate`, and `pnpm db:studio` are also Drizzle
development tools. They do not replace ordered embedded migrations in
`src/lib/db/migrate.ts`, which remain the deployment path.

## Module changes

Changes to core package/runtime behavior generally require matching work in all
three repositories:

1. Update the portable types, verifier, lifecycle, runner, host service, or
   declarative renderer in `nad`.
2. Update the versioned schema/SDK/testkit and one first-party fixture in
   `nad-plugins`.
3. Rebuild and sign the Module with an offline release key; keep only public key
   material in source.
4. Promote the verified release record/artifact through `nad-marketplace`; do
   not hand-copy or replace bytes at an existing immutable URL.
5. Test both Marketplace install and manual upload through the same core
   verifier and include backward-compatibility fixtures.
6. Update current status, contract, compatibility, and release documentation.

Module code contacts external services only through approved core host calls.
All state changes require an exact backend permission and audit attribution.
Hidden UI controls are never authorization.

Stable public contract changes require an API/schema version decision. Do not
silently change an immutable Module ID, slug, permission action, config key,
Widget ID, endpoint schema, or stored-data meaning.

Schema-v2 App/Add-on changes must also preserve connection secrecy,
dependency/operation allowlists, exact-release and connection-generation
pinning, opaque-sandbox bridge limits, surface/profile RBAC and safe unavailable
Workspace references. Never add a same-origin path for downloaded UI code.

## Code standards

- Strict TypeScript; avoid `any` and unsafe assertions at trust boundaries.
- Named exports except framework-required default Page/Layout exports.
- `kebab-case` files, `PascalCase` React components.
- `import type` for type-only imports.
- Server Components by default; add `'use client'` only for interaction/browser APIs.
- Return `{ data: T }` or `{ error: string, code: string }` from APIs.
- Bound upstream time and response size; transform rather than expose raw payloads.
- Never log secrets, authentication headers, raw config, or upstream session IDs.
- Use owned shadcn/Radix primitives and existing theme tokens.

## Git conventions

Branches created through Codex use `codex/...`; other contributors may use
`feature/...`, `fix/...`, or `module/...`. Commit messages follow Conventional
Commits, for example `fix: initialise database before serving requests`.

Pull requests should state:

- the problem and user-visible outcome;
- security/data migration implications;
- automated commands run;
- manual scenarios tested;
- remaining limitations or follow-up work;
- screenshots for material UI changes.

## Review checklist

- [ ] Scope is intentional and unrelated work is preserved.
- [ ] Authentication and exact server authorization are correct.
- [ ] Secrets remain server-only and encrypted where stored.
- [ ] Data writes are transactional/unique where races matter.
- [ ] Upstream failures, partial failures, timeouts, and oversized responses are handled.
- [ ] Package capabilities are least-privilege, visible to the installer, and
      enforced from the stored grant generation.
- [ ] Marketplace and manual installs use the same verification path.
- [ ] Core/API/UI/package compatibility and stable identifiers are preserved.
- [ ] Tests cover the changed behavior and failure path.
- [ ] Full sequential gate passes.
- [ ] Documentation describes the resulting code, not the intended design.
- [ ] No new high/critical production advisory is introduced.
- [ ] The reusable [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) is executed for
      release/deployment changes and results are stored as dated evidence.

## Conduct and licensing

Be respectful, specific, and constructive. NAD is licensed under the GNU AGPL-3.0-only; by contributing, you agree that your contributions are licensed under the same terms.
