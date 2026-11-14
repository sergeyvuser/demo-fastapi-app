# syntax=docker/dockerfile:1

# The builder is the runtime's own image plus the uv binary, so the two stages
# share glibc and the interpreter path. uv's version is the root pyproject's
# required-version (tests/deploy/test_uv_version.py).
FROM python:3.14-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:0.13.8 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app

# layer 1: manifests only — cached until dependencies change
COPY pyproject.toml uv.lock ./
COPY backend/pyproject.toml backend/pyproject.toml
COPY shared/pyproject.toml shared/pyproject.toml
COPY ingestor/pyproject.toml ingestor/pyproject.toml
COPY notifier/pyproject.toml notifier/pyproject.toml
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-workspace --package ingestor

# layer 2: sources — rebuilt on every code change
COPY ingestor/ ingestor/
COPY shared/ shared/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --package ingestor

FROM python:3.14-slim-bookworm AS runtime
RUN groupadd -r app && useradd -r -g app -d /app app
COPY --from=builder --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1
USER app
WORKDIR /app/ingestor
CMD ["faststream", "run", "ingestor.app:app"]