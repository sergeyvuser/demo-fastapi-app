# syntax=docker/dockerfile:1

# Built from the repository root like the other three images (the CI matrix
# passes context: .), hence the frontend/ prefix on every COPY.

# Pinned to the exact version in .nvmrc and package.json "engines". With
# engine-strict npm refuses any other, so a laptop cannot build what this
# image would not.
FROM node:24.21.0-alpine AS builder
WORKDIR /app

# layer 1: manifests only — cached until dependencies change
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci

# layer 2: sources — rebuilt on every code change
COPY frontend/ ./
RUN npm run build

# A static file server and nothing else: no Node, no sources, no node_modules.
# Same tag as the edge proxy in deploy/compose.prod.yaml — bump both together.
FROM caddy:2.11.4-alpine AS runtime
# The base image runs as root. Caddy still writes to /data on start (storage
# housekeeping) even with TLS off, so the unprivileged user owns both dirs.
RUN addgroup -S app && adduser -S -G app -H app \
    && chown -R app:app /data /config
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /srv
USER app
EXPOSE 8080