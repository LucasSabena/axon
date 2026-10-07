# Pinned by digest for reproducible builds; refresh with:
#   docker buildx imagetools inspect oven/bun:1.4.2-slim
FROM oven/bun:1.4.2-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    coreutils \
    iproute2 \
    lm-sensors \
    python3 \
    python3-pip \
    python3-venv \
    python-is-python3 \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    fonts-crosextra-carlito \
    fonts-crosextra-caladea \
    fonts-liberation \
    bubblewrap \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (needed to run Next.js/Vite projects launched from the panel)
# NodeSource publishes no versioned setup URL; the major line is fixed to Node 24.
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && corepack enable \
    && corepack prepare pnpm@12.5.1 --activate \
    && corepack prepare yarn@4.18.1 --activate \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY . .

# Build local web components from the locked production dependency.
RUN bun run scripts/build-ui.ts

ARG AXON_VERSION=1.3.1
ARG AXON_REVISION=development
ENV AXON_VERSION=$AXON_VERSION AXON_REVISION=$AXON_REVISION
LABEL org.opencontainers.image.source="https://github.com/LucasSabena/axon" org.opencontainers.image.version=$AXON_VERSION org.opencontainers.image.revision=$AXON_REVISION

ENV NODE_ENV=production
ENV CONFIG_PATH=/app/data/config.json
ENV CLOUDFLARED_CONFIG=/app/cloudflared-config.yml

EXPOSE 3457

# /api/health is unauthenticated and cheap — the right standalone healthprobe
# for compose/Portainer when no Compose healthcheck overrides this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS --max-time 4 "http://127.0.0.1:${PORT:-3457}/api/health" || exit 1

CMD ["bun", "run", "src/index.ts"]
