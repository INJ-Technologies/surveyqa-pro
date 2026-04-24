FROM node:20-alpine

# Install Chromium and dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    font-noto-emoji \
    udev \
    xvfb

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production

WORKDIR /app

# Copy package files from both workers and backend
COPY workers/package*.json  ./workers/
COPY backend/package*.json  ./backend/

# Install dependencies
RUN cd workers  && npm ci --only=production
RUN cd backend  && npm install --omit=dev

# Copy source code
COPY workers/   ./workers/
COPY backend/   ./backend/

WORKDIR /app/workers

CMD ["node", "src/index.js"]