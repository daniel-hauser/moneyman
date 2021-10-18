# ---- Base Node ----
FROM node:alpine AS base

RUN apk add --no-cache \
      chromium \
      nodejs yarn \
      nss ca-certificates \
      freetype ttf-freefont harfbuzz

# Tell Puppeteer to skip installing Chrome. We'll be using the installed package.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Add user so we don't need --no-sandbox.
RUN addgroup -S pptruser && adduser -S -g pptruser pptruser \
    && mkdir -p /home/pptruser/Downloads /app \
    && chown -R pptruser:pptruser /home/pptruser \
    && chown -R pptruser:pptruser /app
 
USER pptruser

# ---- Dependencies ----
FROM base AS dependencies
WORKDIR /app

COPY package.json .
# RUN npm install --only=production 
RUN npm install

# ---- Release ----
FROM base AS release
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY .env .
COPY tsconfig.json .
COPY package.json .
COPY ./src ./src

CMD ["npm", "run", "start"]