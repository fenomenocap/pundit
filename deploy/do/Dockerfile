# syntax=docker/dockerfile:1
# Pundit API image. Mirrors Railway: build `pnpm --filter @sports-predict/api build`,
# run `node packages/api/dist/index.js`. Build context = the git clone (/opt/pundit).
# Only explicit paths are copied, so /opt/pundit/.env.api never enters the image.
ARG NODE_IMAGE=node:22.23.4-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY vendor ./vendor
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/

FROM base AS build
# tsc peaks around 0.6 GB; cap the heap so the 2 GB droplet (+2 GB swap) never OOMs.
ENV NODE_OPTIONS=--max-old-space-size=1024
RUN pnpm install --frozen-lockfile --filter "@sports-predict/api..."
COPY packages/api packages/api
RUN pnpm --filter @sports-predict/api build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@sports-predict/api..."

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/vendor ./vendor
COPY --from=build /app/packages/api/package.json ./packages/api/
COPY --from=build /app/packages/api/dist ./packages/api/dist
# Bundled release artifacts (club strength, EPL goal calibration, fixture registry seed).
COPY --from=build /app/packages/api/data ./packages/api/data
# Read at runtime by the remote chat-eval judge and eval replay paths.
COPY scripts ./scripts
COPY evals ./evals
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3001
CMD ["node", "packages/api/dist/index.js"]
