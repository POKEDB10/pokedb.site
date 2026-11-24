# Multi-stage Dockerfile for pokedb.site
# Compliant with Task P2.9, Hadolint rules, and Alpine non-root security standards

# Stage 1: Obtain Litestream replication binary with TARGETARCH support and pinned SHA256 digests
FROM alpine:3.21 AS litestream
ARG TARGETARCH
ARG LITESTREAM_VERSION=v0.3.13
# Official GitHub release digests (verified from published release assets):
# amd64: eb75a3de5cab03875cdae9f5f539e6aedadd66607003d9b1e7a9077948818ba0
# arm64: 9585f5a508516bd66af2b2376bab4de256a5ef8e2b73ec760559e679628f2d59
# hadolint ignore=DL3018
RUN apk add --no-cache curl ca-certificates \
    && ARCH="${TARGETARCH:-amd64}" \
    && case "$ARCH" in \
         "amd64") SHA256="eb75a3de5cab03875cdae9f5f539e6aedadd66607003d9b1e7a9077948818ba0" ;; \
         "arm64") SHA256="9585f5a508516bd66af2b2376bab4de256a5ef8e2b73ec760559e679628f2d59" ;; \
         *) echo "Unsupported TARGETARCH: $ARCH" >&2; exit 1 ;; \
       esac \
    && curl -sL -o /tmp/litestream.tar.gz "https://github.com/benbjohnson/litestream/releases/download/${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-${ARCH}.tar.gz" \
    && echo "${SHA256}  /tmp/litestream.tar.gz" | sha256sum -c - \
    && tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz \
    && chmod +x /usr/local/bin/litestream

# Stage 2: Install production dependencies
FROM node:25-alpine3.21 AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 3: Runtime container
FROM node:25-alpine3.21 AS runner

WORKDIR /app

# Install tini init and curl for healthcheck; create numeric non-root user (10001)
# hadolint ignore=DL3018
RUN apk add --no-cache tini curl ca-certificates \
    && addgroup -g 10001 -S app \
    && adduser -u 10001 -S app -G app \
    && mkdir -p /app/data /etc/litestream /tmp \
    && chown -R 10001:10001 /app /app/data /etc/litestream /tmp

# Copy Litestream binary
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream

# Copy production node_modules
COPY --from=deps --chown=10001:10001 /app/node_modules ./node_modules

# Copy application source
COPY --chown=10001:10001 . .

# Copy default litestream config
COPY --chown=10001:10001 etc/litestream.yml /etc/litestream.yml

# Make entrypoint executable
RUN chmod +x /app/scripts/docker-entrypoint.sh

ENV NODE_ENV=production \
    PORT=5050 \
    STORE=sqlite \
    SQLITE_DB_PATH=/app/data/pokedb.sqlite

USER 10001:10001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:5050/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/app/scripts/docker-entrypoint.sh"]
CMD ["node", "server.js"]
