PYTHON ?= python3
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
VENV ?= $(ROOT)/.venv
PIP := $(VENV)/bin/pip
UVICORN := $(VENV)/bin/uvicorn
# Keep in sync with API_PORT in frontend/app.js (or set window.WORDLE_API_PORT when using split UI).
PORT ?= 8010

.PHONY: setup backend frontend serve dev clean-db doctor

setup:
	$(PYTHON) -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r $(ROOT)/backend/requirements.txt

backend:
	@echo "Wordle: project $(ROOT)"
	@echo "If curl http://127.0.0.1:$(PORT)/health is not JSON, another process may be on $(PORT) — see make doctor"
	$(UVICORN) app.main:app --app-dir $(ROOT)/backend --reload --host 0.0.0.0 --port $(PORT)

serve: backend

frontend:
	cd $(ROOT)/frontend && $(PYTHON) -m http.server 5173

dev:
	@echo "Recommended (one terminal): open http://127.0.0.1:$(PORT)/"
	@echo "  make backend"
	@echo "Optional split UI/API:"
	@echo "  Terminal 1: make backend"
	@echo "  Terminal 2: make frontend  -> http://127.0.0.1:5173/"

clean-db:
	rm -f $(ROOT)/backend/data/wordle.db

doctor:
	@echo "=== /health (expect JSON with service=wordle-multiplayer) ==="
	@curl -sS http://127.0.0.1:$(PORT)/health || { echo ""; echo "FAILED: nothing on $(PORT) or connection error"; exit 1; }
	@echo ""
	@echo "=== /api/wordle-ping ==="
	@curl -sS http://127.0.0.1:$(PORT)/api/wordle-ping || exit 1
	@echo ""
	@echo "If you see plain text 'Not Found', port $(PORT) is NOT this app. Find the process: lsof -nP -iTCP:$(PORT) -sTCP:LISTEN"
