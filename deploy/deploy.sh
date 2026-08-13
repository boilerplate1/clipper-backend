#!/usr/bin/env bash
set -euo pipefail

# Quick VPS deployment: backend + worker + RabbitMQ + Postgres in Docker.
# Usage: bash deploy.sh [/opt/clipper]

BASE_DIR="${1:-/opt/clipper}"
BACKEND_DIR="$BASE_DIR/backend"
WORKER_DIR="$BASE_DIR/worker"
DEPLOY_DIR="$BACKEND_DIR/deploy"

echo "==> Checking Docker"
command -v docker >/dev/null 2>&1 || {
  echo "Docker is not installed. Run:"
  echo "  curl -fsSL https://get.docker.com | sh"
  exit 1
}

echo "==> Cloning repos"
mkdir -p "$BASE_DIR"
[ -d "$BACKEND_DIR/.git" ] || git clone https://github.com/boilerplate1/clipper-backend.git "$BACKEND_DIR"
[ -d "$WORKER_DIR/.git" ]  || git clone https://github.com/boilerplate1/clipper-worker.git  "$WORKER_DIR"

cd "$BACKEND_DIR"; git pull --ff-only 2>/dev/null || true
cd "$WORKER_DIR";  git pull --ff-only 2>/dev/null || true

echo "==> Environment"
if [ ! -f "$DEPLOY_DIR/.env" ]; then
  cp "$DEPLOY_DIR/env.example" "$DEPLOY_DIR/.env"
  echo "Created $DEPLOY_DIR/.env"
  echo "  -> edit it (GROQ_API_KEY, S3_*, POSTGRES_PASSWORD) and run: bash deploy.sh"
  exit 1
fi

echo "==> Starting stack"
cd "$DEPLOY_DIR"
docker compose up -d --build

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "Done."
echo "  API docs:  http://$IP:4000/api/docs"
echo "  RabbitMQ:  http://$IP:15672  (guest/guest)"
echo "  Logs:      cd $DEPLOY_DIR && docker compose logs -f backend worker"
