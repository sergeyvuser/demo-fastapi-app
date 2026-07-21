# syntax=docker/dockerfile:1

FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app

# layer 1: manifests only — cached until dependencies change
COPY pyproject.toml uv.lock ./
COPY backend/pyproject.toml backend/pyproject.toml
COPY shared/pyproject.toml shared/pyproject.toml
COPY ingestor/pyproject.toml ingestor/pyproject.toml
COPY notifier/pyproject.toml notifier/pyproject.toml
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-workspace --package notifier

# layer 2: sources — rebuilt on every code change
COPY notifier/ notifier/
COPY shared/ shared/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --package notifier

FROM python:3.14-slim-bookworm AS runtime
RUN groupadd -r app && useradd -r -g app -d /app app
COPY --from=builder --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1
USER app
WORKDIR /app/notifier
CMD ["faststream", "run", "notifier.app:app"]