.DEFAULT_GOAL := help
BACKEND := backend

# Developer tooling (mailpit, pgadmin) sits behind the `tools` profile so the plain
# compose file is the deployable stack. Every make target opts back into it, so local
# habits are unchanged; `docker compose up` without this variable starts neither.
export COMPOSE_PROFILES ?= tools

.PHONY: help install run evaluator ingestor notifier worker scheduler up down stop-apps reset dev logs db-up tools migration migrate migrate-down migrate-check lint format types test test-unit test-integration check-ports docker-clean prod-config

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

worker: ## Run taskiq worker
	cd $(BACKEND) && uv run taskiq worker backend.tasks.worker:broker backend.tasks.email backend.tasks.maintenance backend.tasks.digest

scheduler: ## Run taskiq scheduler (puts scheduled tasks into the queue)
	cd $(BACKEND) && uv run taskiq scheduler backend.tasks.worker:scheduler backend.tasks.maintenance backend.tasks.digest

up: ## Поднять postgres в docker
	docker compose up -d --build

down: ## Остановить docker-сервисы, включая tools (mailpit, pgadmin)
	docker compose down

stop-apps: ## Stop app containers, keep infrastructure (for local dev)
	docker compose stop api evaluator ingestor notifier worker scheduler

reset: ## DESTROY volumes and start fresh (db data will be lost!)
	docker compose down -v
	docker compose up -d --build

dev: ## Стек с live-reload по правкам src/
	docker compose up --build --watch

logs: ## Логи API
	docker compose logs -f api

db-up: ## Всё, что нужно приложению, запущенному на хосте (db, redis, rabbitmq, mailpit)
	docker compose up -d db redis rabbitmq mailpit

tools: ## Start the development tools only (mailpit, pgadmin)
	docker compose up -d mailpit pgadmin

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

lint: ## Ruff check across the whole workspace
	uv run ruff check .

format: ## Ruff format across the whole workspace
	uv run ruff format .

types: ## Static type checking
	uv run mypy

test: ## Run the whole test suite
	uv run pytest

test-unit: ## Fast tests only — no docker required
	uv run pytest -m "not integration"

test-integration: ## Docker-backed tests only
	uv run pytest -m integration

check-ports: ## Check that the container ports are accessible from the host
	@uv run python -c "import socket,sys; \
	bad=[p for p in (8000,3000,9090,16686,15672,5432,6379) \
	     if (lambda s: (s.settimeout(1), s.connect_ex(('127.0.0.1',p)), s.close())[1])(socket.socket())]; \
	print('ports are not available:', bad) if bad else print('all ports are available'); \
	sys.exit(1 if bad else 0)"

docker-clean: ## Убрать кэш сборки, висячие образы и мусор от тестов
	-docker rm -f $$(docker ps -aq --filter "label=org.testcontainers=true") 2>/dev/null
	-docker volume ls -q | grep -E "^[0-9a-f]{64}$$" | xargs -r docker volume rm
	docker image prune -f
	docker builder prune -f --filter until=168h
	@docker system df

prod-config: ## Render the production stack (dummy env, nothing is started)
	COMPOSE_PROFILES="" docker compose -f compose.yaml -f deploy/compose.prod.yaml \
		--env-file deploy/.env.example --env-file deploy/.env.secrets.example config
