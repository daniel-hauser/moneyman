FROM ghcr.io/puppeteer/puppeteer

WORKDIR /app


COPY package.json .
COPY package-lock.json .
COPY ./patches ./patches
RUN npm ci

COPY tsconfig.json .
COPY jest.scraper-access.config.js .
COPY ./src ./src
RUN npm run build

COPY start.sh .
CMD ["./start.sh"]
