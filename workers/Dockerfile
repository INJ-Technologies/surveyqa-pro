FROM node:20-alpine

# Install Chromium for Playwright (Phase 2)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

WORKDIR /app
COPY package.json .
RUN npm install --production
COPY src/ ./src/

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

CMD ["node", "src/index.js"]