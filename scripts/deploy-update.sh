#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${BRANCH:-main}"
WEB_PORT="${WEB_PORT:-3001}"
API_DIR="$ROOT_DIR/apps/api"
WEB_DIR="$ROOT_DIR/apps/web"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1"
    exit 1
  fi
}

require_command git
require_command docker
require_command npm

echo "[1/7] Updating code on branch: $BRANCH"
cd "$ROOT_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "[2/7] Starting/updating infrastructure containers"
docker compose -f "$COMPOSE_FILE" up -d

echo "[3/7] Installing API dependencies"
cd "$API_DIR"
npm ci

echo "[4/7] Running Prisma generate + migrate deploy"
npm run prisma:generate
npm run prisma:deploy

echo "[5/7] Building API"
npm run build

echo "[6/7] Installing and building Web"
cd "$WEB_DIR"
npm ci
npm run build

echo "[7/7] Restarting app services"
if command -v pm2 >/dev/null 2>&1; then
  if ! pm2 describe mindwall-api >/dev/null 2>&1; then
    pm2 start npm --name mindwall-api --cwd "$API_DIR" -- run start:prod
  fi
  pm2 restart mindwall-api --update-env

  if ! pm2 describe mindwall-web >/dev/null 2>&1; then
    pm2 start npm --name mindwall-web --cwd "$WEB_DIR" -- start -- -p "$WEB_PORT"
  fi
  pm2 restart mindwall-web --update-env
  pm2 save
  echo "Deploy complete. Services restarted by pm2."
else
  echo "pm2 not found. Code, migration, and build are complete."
  echo "Please restart services manually:"
  echo "  API: cd $API_DIR && npm run start:prod"
  echo "  Web: cd $WEB_DIR && npm start -- -p $WEB_PORT"
fi
