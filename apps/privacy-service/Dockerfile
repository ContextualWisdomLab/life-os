FROM node:22.23.0-bookworm-slim AS build

ENV NODE_ENV=development
WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/privacy-service/package.json apps/privacy-service/package.json

RUN pnpm install --frozen-lockfile --filter @life-os/privacy-service...

COPY apps/privacy-service apps/privacy-service

RUN pnpm --filter @life-os/privacy-service build \
    && pnpm --filter @life-os/privacy-service deploy --prod /out

FROM node:22.23.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system --gid 10001 lifeos \
    && useradd --system --uid 10001 --gid lifeos --home-dir /nonexistent --shell /usr/sbin/nologin lifeos

COPY --from=build --chown=lifeos:lifeos /out/ ./
COPY --from=build --chown=lifeos:lifeos /workspace/apps/privacy-service/dist/ ./dist/

USER 10001:10001
EXPOSE 4108

CMD ["node", "dist/server.js"]
