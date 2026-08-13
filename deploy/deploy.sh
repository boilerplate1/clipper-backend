#!/usr/bin/env bash
set -euo pipefail

# Quick VPS deployment: backend + worker + RabbitMQ + Postgres in Docker.
# - installs nvidia-container-toolkit automatically when an NVIDIA GPU is present
# - pulls latest worker and backend from git (worker first, hard reset)
# - rebuilds and starts the stack
# Usage: bash deploy.sh [/opt/clipper]

BASE_DIR="${1:-/opt/clipper}"
BACKEND_DIR="$BASE_DIR/backend"
WORKER_DIR="$BASE_DIR/worker"
DEPLOY_DIR="$BACKEND_DIR/deploy"

run_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

echo "==> Checking Docker"
command -v docker >/dev/null 2>&1 || {
  echo "Docker is not installed. Run:"
  echo "  curl -fsSL https://get.docker.com | sh"
  exit 1
}

setup_nvidia() {
  echo "==> NVIDIA GPU detected"
  if docker info 2>/dev/null | grep -q nvidia; then
    echo "==> nvidia runtime already configured"
  else
    echo "==> Installing nvidia-container-toolkit"
    run_root curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
      | run_root gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
      | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
      | run_root tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
    run_root apt-get update
    run_root apt-get install -y nvidia-container-toolkit
    run_root nvidia-ctk runtime configure --runtime=docker
    run_root systemctl restart docker
    echo "==> nvidia-container-toolkit installed, docker restarted"
  fi
}

GPU_FILES="-f docker-compose.yml"
if command -v nvidia-smi >/dev/null 2>&1; then
  setup_nvidia
  GPU_FILES="-f docker-compose.yml -f docker-compose.gpu.yml"
else
  echo "==> No NVIDIA GPU detected - worker uses CPU (libx264)"
fi

echo "==> Cloning repos"
mkdir -p "$BASE_DIR"
[ -d "$WORKER_DIR/.git" ]  || git clone https://github.com/boilerplate1/clipper-worker.git  "$WORKER_DIR"
[ -d "$BACKEND_DIR/.git" ] || git clone https://github.com/boilerplate1/clipper-backend.git "$BACKEND_DIR"

echo "==> Updating worker from git"
cd "$WORKER_DIR"
git fetch origin
git reset --hard origin/master

echo "==> Updating backend from git"
cd "$BACKEND_DIR"
git fetch origin
git reset --hard origin/master

echo "==> Environment"
if [ ! -f "$DEPLOY_DIR/.env" ]; then
  cp "$DEPLOY_DIR/env.example" "$DEPLOY_DIR/.env"
  echo "Created $DEPLOY_DIR/.env"
  echo "  -> edit it (GROQ_API_KEY, S3_*, POSTGRES_PASSWORD) and run: bash deploy.sh"
  exit 1
fi

echo "==> Starting stack"
cd "$DEPLOY_DIR"
docker compose $GPU_FILES up -d --build

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "Done."
echo "  API docs:  http://$IP:4000/api/docs"
echo "  RabbitMQ:  http://$IP:15672  (guest/guest)"
echo "  Logs:      cd $DEPLOY_DIR && docker compose $GPU_FILES logs -f backend worker"
