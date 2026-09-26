FROM node:20-alpine

# Install Chromium, dependencies, and Python 3
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
    xvfb \
    python3 \
    py3-pip \
    gcc \
    musl-dev \
    python3-dev \
    postgresql-dev \
    libffi-dev

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Copy package files from both workers and backend
COPY workers/package*.json  ./workers/
COPY backend/package*.json  ./backend/

# Install Node dependencies
RUN cd workers  && npm ci --only=production
RUN cd backend  && npm install --omit=dev

# Copy Python requirements and install in virtualenv
COPY workers/python_engine/requirements.txt ./workers/python_engine/
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir -r ./workers/python_engine/requirements.txt

ENV PATH="/opt/venv/bin:$PATH"

# Copy source code
COPY workers/   ./workers/
COPY backend/   ./backend/

WORKDIR /app/workers

CMD ["node", "src/index.js"]