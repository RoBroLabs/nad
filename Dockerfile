# ==============================================================================
# Stage 1: Dependencies
# ==============================================================================
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS deps
ENV COREPACK_HOME=/opt/corepack
RUN mkdir -p "$COREPACK_HOME" \
    && corepack enable \
    && corepack prepare pnpm@9.15.0 --activate \
    && chown -R node:node "$COREPACK_HOME"
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --strict-peer-dependencies --prod=false

# ==============================================================================
# Stage 2: Build
# ==============================================================================
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS builder
ENV COREPACK_HOME=/opt/corepack
RUN mkdir -p "$COREPACK_HOME" \
    && corepack enable \
    && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
ARG NAD_VERSION=dev
ARG NAD_GIT_REVISION=unknown
ARG NAD_BUILD_DATE=unknown
ARG NAD_SOURCE_URL=https://github.com/robrolabs/nad
ARG NAD_BUILD_PRODUCTION=0

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build Next.js in standalone mode
RUN test "$NAD_VERSION" = "dev" || test "$(tr -d '\r\n' < VERSION)" = "$NAD_VERSION"
RUN if [ "$NAD_BUILD_PRODUCTION" = "1" ]; then \
      test "$NAD_VERSION" != "dev" \
      && test "$NAD_GIT_REVISION" != "unknown" \
      && test "$NAD_BUILD_DATE" != "unknown" \
      && node -e "if (!/^[a-f0-9]{40}$/.test(process.argv[1])) process.exit(1)" "$NAD_GIT_REVISION" \
      && node -e "if (!Number.isFinite(Date.parse(process.argv[1]))) process.exit(1)" "$NAD_BUILD_DATE" \
      && node -e "const value = new URL(process.argv[1]); if (value.protocol !== 'https:') process.exit(1)" "$NAD_SOURCE_URL"; \
    fi
# Application compilation must be reproducible from the frozen source and
# dependency layers. Runtime/catalog access belongs after deployment, never in
# an image build.
RUN --network=none pnpm build
RUN mkdir -p /app/runtime-data

# ==============================================================================
# Stage 3: Pinned isolated Module runtime
# ==============================================================================
FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241 AS deno-runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl python3 \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/ci-install-deno.sh /usr/local/libexec/nad/install-deno
RUN NAD_DENO_INSTALL_DIRECTORY=/usr/local/bin bash /usr/local/libexec/nad/install-deno \
    && rm /usr/local/libexec/nad/install-deno

# Distroless is intentionally minimal, but its current Debian 12 snapshot
# predates the latest Bookworm OpenSSL fixes. Overlay only the pinned runtime
# libraries and package metadata instead of adding apt, a shell, or other
# operating-system tooling to the production image.
FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241 AS runtime-security-updates
ARG NAD_LIBSSL3_VERSION=3.0.20-1~deb12u2
RUN apt-get update \
    && apt-get install -y --no-install-recommends "libssl3=${NAD_LIBSSL3_VERSION}" \
    && ssl_directory="$(dirname "$(find /usr/lib -name libssl.so.3 -print -quit)")" \
    && test -n "$ssl_directory" \
    && mkdir -p "/runtime-security${ssl_directory}" /runtime-security/var/lib/dpkg/status.d \
    && cp "$ssl_directory/libssl.so.3" "$ssl_directory/libcrypto.so.3" "/runtime-security${ssl_directory}/" \
    && dpkg-query --status libssl3 > /runtime-security/var/lib/dpkg/status.d/libssl3 \
    && cp /var/lib/dpkg/info/libssl3*.md5sums /runtime-security/var/lib/dpkg/status.d/libssl3.md5sums

# ==============================================================================
# CI target: native-architecture Node dependencies plus the pinned Deno runtime
# ==============================================================================
FROM deps AS module-runtime-test
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deno-runtime /usr/local/bin/deno /usr/local/bin/deno
COPY --chown=node:node . .
RUN chown node:node /app
USER node
CMD ["bash", "scripts/ci-module-runtime.sh"]

# ==============================================================================
# CI target: complete native/cross-architecture release source gate
# ==============================================================================
FROM module-runtime-test AS release-gate
CMD ["bash", "scripts/ci-release-gate.sh", "--dependencies-installed"]

# ==============================================================================
# CI target: dependency-complete Chromium gate, independent of runner packages
# ==============================================================================
FROM deps AS browser-gate
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pnpm exec playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright
COPY --chown=node:node . .
RUN chown node:node /app
USER node
RUN --network=none pnpm build
CMD ["pnpm", "e2e"]

# ==============================================================================
# Stage 4: Minimal production runtime
# ==============================================================================
FROM gcr.io/distroless/nodejs20-debian12:nonroot@sha256:2cd820156cf039c8b54ae2d2a97e424b6729070714de8707a6b79f20d56f6a9a AS runner
WORKDIR /app

COPY --from=runtime-security-updates /runtime-security/ /

ARG NAD_VERSION=dev
ARG NAD_GIT_REVISION=unknown
ARG NAD_BUILD_DATE=unknown
ARG NAD_SOURCE_URL=https://github.com/robrolabs/nad
LABEL org.opencontainers.image.title="NAD" \
      org.opencontainers.image.description="Self-hosted homelab mission control dashboard" \
      org.opencontainers.image.url="https://github.com/robrolabs/nad" \
      org.opencontainers.image.source="${NAD_SOURCE_URL}" \
      org.opencontainers.image.version="${NAD_VERSION}" \
      org.opencontainers.image.revision="${NAD_GIT_REVISION}" \
      org.opencontainers.image.created="${NAD_BUILD_DATE}" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

ENV NODE_ENV=production \
    NAD_DENO_PATH=/usr/local/bin/deno \
    NAD_DENO_VERSION=2.7.7 \
    NAD_VERSION=${NAD_VERSION} \
    NAD_GIT_REVISION=${NAD_GIT_REVISION} \
    NAD_BUILD_DATE=${NAD_BUILD_DATE} \
    NAD_SOURCE_URL=${NAD_SOURCE_URL} \
    NAD_BUILD_VERSION=${NAD_VERSION} \
    NAD_BUILD_REVISION=${NAD_GIT_REVISION} \
    NAD_BUILD_CREATED=${NAD_BUILD_DATE} \
    NAD_BUILD_SOURCE=${NAD_SOURCE_URL}

COPY --from=deno-runtime /usr/local/bin/deno /usr/local/bin/deno

# Copy standalone build output
COPY --from=builder --chown=1001:1001 /app/public ./public
COPY --from=builder --chown=1001:1001 /app/.next/standalone ./
COPY --from=builder --chown=1001:1001 /app/.next/static ./.next/static

# Database backup utility (runs against the standalone node_modules)
COPY --from=builder --chown=1001:1001 /app/scripts ./scripts

# Create data directory for SQLite
COPY --from=builder --chown=1001:1001 /app/runtime-data ./data

USER 1001:1001

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["server.js"]
