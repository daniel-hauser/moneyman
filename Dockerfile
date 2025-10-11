FROM node:24-trixie

ENV DEBIAN_FRONTEND noninteractive
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && \
    apt-get install -y fonts-freefont-ttf libxss1 libgtk2.0-0 libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 && \
    apt-get install -y chromium && \
    apt-get clean

WORKDIR /app

COPY tsconfig.json .
COPY package.json .
COPY package-lock.json .
COPY jest.scraper-access.config.js .
COPY ./patches ./patches
RUN npm ci

COPY ./src ./src
RUN npm run build

CMD ["npm", "run", "start"]
