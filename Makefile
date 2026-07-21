.DEFAULT_GOAL := help
BACKEND := backend

.PHONY: help install run evaluator ingestor notifier format up down reset dev logs db-up tools tools-down migration migrate migrate-down migrate-check

help: ## Показать доступные команды
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Sync all workspace members into the shared venv
	uv sync --all-packages

run: ## Запустить API-сервер
	cd $(BACKEND) && uv run python -m backend.run

evaluator: ## Run the alert evaluator (FastStream consumer)
	cd $(BACKEND) && uv run faststream run backend.consumers.app:app

ingestor: ## Run the Bybit tick ingestor
	cd ingestor && uv run faststream run ingestor.app:app

notifier: ## Run the notifier (FastStream consumer)
	cd notifier && uv run faststream run notifier.app:app

lint: ## Ruff check across the whole workspace
	uv run ruff check .

format: ## Ruff format across the whole workspace
	uv run ruff format .

up: ## Поднять postgres в docker
	docker compose up -d --build

down: ## Остановить docker-сервисы (but not tools like pgadmin)
	docker compose down

all-down: ## Down with optional tooling
	docker compose --profile tools down

stop-apps: ## Stop app containers, keep infrastructure (for local dev)
	docker compose stop api evaluator ingestor notifier

reset: ## DESTROY volumes and start fresh (db data will be lost!)
	docker compose down -v
	docker compose up -d --build

dev: ## Стек с live-reload по правкам src/
	docker compose up --build --watch

logs: ## Логи API
	docker compose logs -f api

db-up: ## Только инфраструктура (db, redis, rabbitmq)
	docker compose up -d db redis rabbitmq mailpit

tools: ## Start optional tooling (pgadmin)
	docker compose up -d pgadmin

migration: ## Новая autogenerate-миграция: make migration m="сообщение"
	@test -n "$(m)" || (echo 'использование: make migration m="сообщение"'; exit 1)
	cd $(BACKEND) && uv run alembic revision --autogenerate -m "$(m)"

migrate: ## Применить миграции до head
	cd $(BACKEND) && uv run alembic upgrade head

migrate-down: ## Откатить одну миграцию
	cd $(BACKEND) && uv run alembic downgrade -1

migrate-check: ## Проверить обратимость последней миграции и синхронность моделей
	cd $(BACKEND) && uv run alembic downgrade -1
	cd $(BACKEND) && uv run alembic upgrade head
	cd $(BACKEND) && uv run alembic check