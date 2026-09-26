FROM node:20-bookworm-slim

# Install Python 3, venv, and system utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PATH="/opt/venv/bin:$PATH"

# ── 1. Pre-install Python venv + Playwright + Chromium browser in its own layer ──
# This layer does NOT depend on project files, package.json, or requirements.txt.
# Once built on the server, Docker will permanently CACHE this layer.
# It will NEVER re-download Chrome (186MB), Headless Shell (114MB), or FFmpeg on deployments!
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir playwright>=1.40.0 && \
    /opt/venv/bin/playwright install --with-deps chromium && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── 2. Install Node dependencies (cached unless package*.json changes) ──
COPY workers/package*.json  ./workers/
COPY backend/package*.json  ./backend/
RUN cd workers  && npm ci --only=production
RUN cd backend  && npm install --omit=dev

# ── 3. Install project Python requirements (Playwright is already satisfied; only installs small wheels) ──
COPY workers/python_engine/requirements.txt ./workers/python_engine/
RUN /opt/venv/bin/pip install --no-cache-dir -r ./workers/python_engine/requirements.txt

# ── 4. Copy source code (only this layer invalidates on code changes, taking <1 second) ──
COPY workers/   ./workers/
COPY backend/   ./backend/

WORKDIR /app/workers

CMD ["node", "src/index.js"]