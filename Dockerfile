FROM node:24-trixie AS builder

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY patches ./patches

RUN npm ci

COPY src ./src

RUN npm run build && \
    npm prune --omit=dev && \
    npm cache clean --force && \
    rm -rf src

FROM node:24-trixie-slim AS runner

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        chromium libnss3 \
        fonts-noto-core fonts-noto-unhinted \
        libatk-bridge2.0-0 libgtk-3-0 libdrm2 libgbm1 \
        libx11-xcb1 libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dst ./dst

CMD ["node", "dst/index.js"]
