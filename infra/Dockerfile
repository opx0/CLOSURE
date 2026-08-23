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
COPY --from=deps /srv/node_modules ./node_modules
COPY . .
COPY --from=web /srv/apps/web/dist ./apps/web/dist
# Non-root: the process ingests untrusted repositories, so it runs with no more rights than it needs.
USER node
EXPOSE 3001
CMD ["node", "apps/server/src/index.ts"]

FROM runtime AS worker
CMD ["node", "apps/worker/src/index.ts"]
