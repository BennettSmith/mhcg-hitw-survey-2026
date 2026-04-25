# Survey photo tooling: EXIF → YAML, local viewer, Docker.
# Run from the repository root.

.DEFAULT_GOAL := help

PYTHON      ?= python3
VENV        := .venv
VENV_PY     := $(VENV)/bin/python3
VENV_PIP    := $(VENV)/bin/pip
UVICORN     := $(VENV)/bin/uvicorn
COMPOSE     := docker compose
OPEN_URL    ?= http://127.0.0.1:8765/
SERVICE     := survey-viewer

.PHONY: help install extract serve open \
	docker-build docker-up docker-down docker-restart docker-logs docker-ps docker-open browse

help: ## Show available targets
	@echo "Targets:"
	@grep -hE '^[a-zA-Z0-9_.-]+:.*##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*##"}; {printf "  %-20s %s\n", $$1, $$2}'

install: ## Create .venv and install requirements.txt
	$(PYTHON) -m venv $(VENV)
	$(VENV_PIP) install -r requirements.txt

extract: ## Regenerate survey_photos.yaml from photos/ (EXIF)
	@test -x $(VENV_PY) || (echo "Missing $(VENV); run: make install" >&2 && exit 1)
	$(VENV_PY) scripts/extract_photo_exif_to_yaml.py

serve: ## Run the web viewer locally (uvicorn, port 8765)
	@test -x $(UVICORN) || (echo "Missing $(UVICORN); run: make install" >&2 && exit 1)
	$(UVICORN) webapp.app:app --reload --port 8765

open: ## Open the viewer URL in your default browser
	@case "$$(uname -s)" in \
		Darwin*)  open '$(OPEN_URL)' ;; \
		Linux*)   command -v xdg-open >/dev/null && xdg-open '$(OPEN_URL)' || sensible-browser '$(OPEN_URL)' 2>/dev/null || echo "Open $(OPEN_URL)" ;; \
		MINGW*|MSYS*|CYGWIN*) start '$(OPEN_URL)' ;; \
		*)        echo "Open $(OPEN_URL) in a browser" ;; \
	esac

docker-build: ## Build the Docker image (docker compose build)
	$(COMPOSE) build

docker-up: ## Start the stack in the background (docker compose up -d)
	$(COMPOSE) up -d

docker-up-build: ## Build (if needed) and start the stack (up -d --build)
	$(COMPOSE) up -d --build

docker-down: ## Stop and remove containers (docker compose down)
	$(COMPOSE) down

docker-stop: docker-down ## Alias for docker-down

docker-restart: ## Restart containers (reloads in-memory YAML cache)
	$(COMPOSE) restart $(SERVICE)

docker-logs: ## Follow container logs (^C to stop)
	$(COMPOSE) logs -f

docker-ps: ## Show compose service status
	$(COMPOSE) ps

docker-open: docker-up open ## Start stack (if not running) and open the viewer URL

browse: docker-up-build ## Build, start stack, wait briefly, then open the viewer URL
	sleep 1
	$(MAKE) open
