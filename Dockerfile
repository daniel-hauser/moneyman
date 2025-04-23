FROM ghcr.io/puppeteer/puppeteer

WORKDIR /app


COPY package.json .
COPY package-lock.json .
COPY ./patches ./patches
COPY ./packages/*/package.json ./packages/*/package.json
RUN npm ci

COPY tsconfig.json .
COPY jest.scraper-access.config.js .
COPY ./packages/*/src ./packages/*/src
RUN npm run build

COPY start.sh .
CMD ["./start.sh"]
