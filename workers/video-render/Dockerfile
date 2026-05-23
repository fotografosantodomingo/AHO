# aho-video-render Dockerfile — Phase 4 4a-container
#
# Container image that runs INSIDE Cloudflare Containers. Exposes an
# HTTP server on $PORT (default 8080) that the sibling Cloudflare
# Worker (workers/video-render/src/index.ts) calls via the containers
# binding. The Worker is bundled separately and deployed via wrangler;
# this Dockerfile only builds the container image.
#
# Why node:20-bookworm-slim and not -alpine: Remotion's Chromium
# dependency (puppeteer-core's bundled Chromium) needs glibc + a
# specific set of shared libraries (libnss3, libatk-1.0-0, etc.) that
# are tedious on Alpine's musl. bookworm-slim ships them or pulls
# them via apt with one layer.
#
# Image size budget: ~600-800 MB compressed. Chromium is the bulk;
# ffmpeg, Node modules, and the bundled composition contribute
# ~50-100 MB combined. CF Containers caches layers across pushes, so
# code-only updates (changing composition.tsx without changing deps)
# only re-push the final ~5 MB layer.

FROM node:20-bookworm-slim

# 1. System deps for Chromium + ffmpeg + native build tools for
#    @remotion/renderer's optional sharp dependency.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libgtk-3-0 \
    fonts-liberation fonts-dejavu-core \
    ca-certificates \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Tell @remotion/renderer to use the system Chromium instead of
# downloading its own (saves ~150 MB image size and avoids the
# version-pinning treadmill).
ENV REMOTION_CHROMIUM_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

# 2. Install Node deps. Copy package files first so the layer caches
# across composition-only edits.
COPY package.json pnpm-lock.yaml* package-lock.json* ./
RUN if [ -f pnpm-lock.yaml ]; then \
      corepack enable && corepack prepare pnpm@9.12.3 --activate && pnpm install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

# 3. Copy source + tsconfig + remotion config. The composition and
# server are TypeScript; we run them via tsx in production (no build
# step needed for ~500 LOC of straightforward TS).
COPY tsconfig.json ./
COPY remotion.config.ts ./
COPY src ./src

EXPOSE 8080

# dumb-init shepherds Node so SIGTERM from CF Containers cleanly
# tears down Chromium child processes — without it, a forced
# shutdown can leave zombie Chromium tabs that pin memory.
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Run the server via tsx (TypeScript executor). The HTTP server keeps
# Chromium warm + the Remotion bundle cached across requests.
CMD ["npx", "tsx", "src/server.ts"]
