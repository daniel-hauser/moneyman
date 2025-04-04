FROM ghcr.io/puppeteer/puppeteer

# Install additional dependencies required for running Chrome
RUN apt-get update && apt-get install -y \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY tsconfig.json .
COPY package.json .
COPY package-lock.json .
COPY ./patches ./patches
RUN npm ci

COPY ./src ./src
RUN npm run build

CMD ["xvfb-run", "--auto-servernum", "--server-args='-screen 0 1280x720x24'", "npm", "run", "start"]
