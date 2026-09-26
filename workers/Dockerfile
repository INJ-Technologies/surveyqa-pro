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

WORKDIR /app

# Copy package files from both workers and backend
COPY workers/package*.json  ./workers/
COPY backend/package*.json  ./backend/

# Install Node dependencies
RUN cd workers  && npm ci --only=production
RUN cd backend  && npm install --omit=dev

# Copy Python requirements, create virtualenv, install packages and Chromium browser with OS deps
COPY workers/python_engine/requirements.txt ./workers/python_engine/
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir -r ./workers/python_engine/requirements.txt && \
    /opt/venv/bin/playwright install --with-deps chromium

ENV PATH="/opt/venv/bin:$PATH"

# Copy source code
COPY workers/   ./workers/
COPY backend/   ./backend/

WORKDIR /app/workers

CMD ["node", "src/index.js"]