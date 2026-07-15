.DEFAULT_GOAL := help
BACKEND := backend

.PHONY: help install run lint format up down dev logs db-up tools tools-down migration migrate migrate-down migrate-check

help: ## Показать доступные команды
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Синхронизировать зависимости всего workspace
	uv sync

run: ## Запустить API-сервер
	cd $(BACKEND) && uv run python -m backend.run

lint: ## Проверка ruff
	uv run ruff check $(BACKEND)/src

format: ## Форматирование ruff
	uv run ruff format $(BACKEND)/src

up: ## Поднять postgres (+pgadmin) в docker
	docker compose up -d --build

down: ## Остановить docker-сервисы
	docker compose down

dev: ## Стек с live-reload по правкам src/
	docker compose up --build --watch

logs: ## Логи API
	docker compose logs -f api

db-up: ## Только инфраструктура (db, redis, rabbitmq)
	docker compose up -d db redis rabbitmq

tools: ## Start optional tooling (pgadmin)
	docker compose --profile tools up -d

tools-down: ## Down with optional tooling
	docker compose --profile tools down

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