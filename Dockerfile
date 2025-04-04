FROM ghcr.io/puppeteer/puppeteer

ENV DISPLAY=:99

WORKDIR /app

COPY tsconfig.json .
COPY package.json .
COPY package-lock.json .
COPY ./patches ./patches
RUN npm ci

COPY ./src ./src
RUN npm run build

# Start Xvfb and then run the application
CMD Xvfb :99 -screen 0 1280x720x16 -ac -nolisten tcp -nolisten unix & \
    npm run start
