# The deployed artifact, exercised before deploy day (STACK §16). Node 24 is the runtime; Bun is the
# package manager and never executes production code.
FROM oven/bun:1.4.0 AS deps
WORKDIR /srv
COPY package.json bun.lock bunfig.toml ./
COPY apps/cli/package.json apps/cli/
COPY apps/server/package.json apps/server/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/prompts/package.json packages/prompts/
COPY packages/observability/package.json packages/observability/
COPY benchmarks/package.json benchmarks/
# --frozen-lockfile everywhere: a dependency tree that drifts between runs is not reproducible, and
# reproducibility is the product claim.
RUN bun install --frozen-lockfile

FROM deps AS web
ARG LEVELHEAD_PREVIEW_MODE=false
ENV VITE_LEVELHEAD_PREVIEW_MODE=${LEVELHEAD_PREVIEW_MODE}
COPY . .
RUN bun run --cwd apps/web build

FROM node:24-bookworm-slim AS runtime
# git is the repository reader; nothing else in the image needs it, and repository code is parsed,
# never executed.
RUN apt-get update \
 && apt-get install --no-install-recommends -y git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
ENV NODE_ENV=production
# The whole built tree from the web stage: source, the built web dist, and every workspace's
# node_modules. Bun installs into a `.bun` store with per-workspace symlinks (apps/server/node_modules
# → the store), so copying only the root node_modules loses `pg` and every other workspace dependency.
# Copying /srv wholesale preserves those symlinks and is what makes the runtime resolve them.
COPY --from=web /srv /srv
# Non-root: the process ingests untrusted repositories, so it runs with no more rights than it needs.
USER node
EXPOSE 3001
# Parameter properties in core require transformation, not Node's strip-only TS loader.
CMD ["node", "--experimental-transform-types", "apps/server/src/index.ts"]

FROM runtime AS worker
CMD ["node", "apps/worker/src/index.ts"]
