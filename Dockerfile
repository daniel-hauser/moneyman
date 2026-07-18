FROM node:24-bookworm-slim AS builder

ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org/

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NPM_CONFIG_REGISTRY=$NPM_CONFIG_REGISTRY
WORKDIR /workspace

RUN npm install --global pnpm@10.34.5

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm typecheck
RUN pnpm --filter @moneyman/config-init deploy --prod /deploy/config-init && \
    pnpm --filter @moneyman/egress deploy --prod /deploy/egress && \
    pnpm --filter @moneyman/notifier deploy --prod /deploy/notifier && \
    pnpm --filter @moneyman/exporter deploy --prod /deploy/exporter && \
    pnpm --filter @moneyman/scraper deploy --prod /deploy/scraper

FROM scratch AS orchestrator
COPY docker-compose.yml docker-compose.prod.yml /

FROM node:24-bookworm-slim AS runtime-base

ENV NODE_ENV=production \
    MONEYMAN_UNSAFE_STDOUT=false \
    MONEYMAN_PRIVATE_LOG_PATH=/run/moneyman/private.log
WORKDIR /app
RUN mkdir -p /run/moneyman && chown node:node /run/moneyman
USER node

FROM runtime-base AS config-init
COPY --from=builder --chown=node:node /deploy/config-init ./
USER root
CMD ["node", "--import", "tsx", "src/main.ts"]

FROM runtime-base AS egress
COPY --from=builder --chown=node:node /deploy/egress ./
CMD ["node", "--import", "tsx", "src/main.ts"]

FROM runtime-base AS notifier
COPY --from=builder --chown=node:node /deploy/notifier ./
CMD ["sh", "-c", "if [ \"$MONEYMAN_UNSAFE_STDOUT\" = \"true\" ]; then exec node --import tsx src/main.ts; else exec node --import tsx src/main.ts >>\"$MONEYMAN_PRIVATE_LOG_PATH\" 2>&1; fi"]

FROM runtime-base AS exporter
COPY --from=builder --chown=node:node /deploy/exporter ./
CMD ["sh", "-c", "if [ \"$MONEYMAN_UNSAFE_STDOUT\" = \"true\" ]; then exec node --import tsx src/main.ts; else exec node --import tsx src/main.ts >>\"$MONEYMAN_PRIVATE_LOG_PATH\" 2>&1; fi"]

FROM runtime-base AS scraper
USER root
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      chromium \
      fonts-noto-core \
      fonts-noto-unhinted \
      libatk-bridge2.0-0 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnss3 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=node:node /deploy/scraper ./
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
USER node
CMD ["sh", "-c", "if [ \"$MONEYMAN_UNSAFE_STDOUT\" = \"true\" ]; then exec node --import tsx src/main.ts; else exec node --import tsx src/main.ts >>\"$MONEYMAN_PRIVATE_LOG_PATH\" 2>&1; fi"]
