#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/apps/api"
WEB_DIR="$ROOT_DIR/apps/web"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"
VERSION_FILE="$ROOT_DIR/VERSION"

BRANCH="${BRANCH:-main}"
WEB_PORT="${WEB_PORT:-3001}"
SKIP_GIT="${SKIP_GIT:-0}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
SKIP_MIGRATE="${SKIP_MIGRATE:-0}"
NO_DOCKER="${NO_DOCKER:-0}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令：$1，请先安装后重试。"
    exit 1
  fi
}

get_project_version() {
  if [[ -f "$VERSION_FILE" ]]; then
    local raw
    raw="$(tr -d '[:space:]' < "$VERSION_FILE")"
    if [[ "$raw" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]]; then
      echo "$raw"
      return
    fi
  fi
  echo "1.0.0"
}

ensure_docker_engine() {
  if ! docker info >/dev/null 2>&1; then
    echo "Docker 引擎未运行，请先启动 Docker。"
    exit 1
  fi
}

wait_for_container_health() {
  local container_name="$1"
  local timeout_seconds="${2:-120}"
  local waited=0

  while [[ "$waited" -lt "$timeout_seconds" ]]; do
    local status
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || true)"
    if [[ "$status" == "healthy" || "$status" == "running" ]]; then
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done

  echo "容器 '$container_name' 在 ${timeout_seconds} 秒内未就绪。"
  exit 1
}

ensure_runtime_data_dirs() {
  local config_dir="$API_DIR/config"
  local runtime_file="$config_dir/runtime-config.json"
  local runtime_example="$config_dir/runtime-config.example.json"
  local log_dir="$API_DIR/logs"

  mkdir -p "$config_dir" "$log_dir"
  if [[ ! -f "$runtime_file" ]]; then
    if [[ -f "$runtime_example" ]]; then
      cp "$runtime_example" "$runtime_file"
    else
      printf "{}\n" > "$runtime_file"
    fi
    echo "已创建运行时配置文件：$runtime_file"
  else
    echo "保留现有运行时配置：$runtime_file"
  fi
}

VERSION="$(get_project_version)"

require_command npm
if [[ "$SKIP_GIT" != "1" ]]; then
  require_command git
fi
if [[ "$NO_DOCKER" != "1" ]]; then
  require_command docker
  ensure_docker_engine
fi

echo "MindWall 商业版部署脚本 v$VERSION"
echo "工作目录：$ROOT_DIR"
echo

echo "[1/8] 更新代码"
cd "$ROOT_DIR"
if [[ "$SKIP_GIT" != "1" ]]; then
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
else
  echo "已跳过 Git 拉取（使用当前代码目录）。"
fi

echo "[2/8] 启动基础设施"
if [[ "$NO_DOCKER" != "1" ]]; then
  docker compose -f "$COMPOSE_FILE" up -d
  wait_for_container_health "mindwall-postgres"
  echo "PostgreSQL 容器已就绪。"
else
  echo "已跳过 Docker 步骤。"
fi

echo "[3/8] 校验运行时数据目录（不会同步本地数据）"
ensure_runtime_data_dirs

if [[ "$SKIP_INSTALL" != "1" ]]; then
  echo "[4/8] 安装 API 依赖"
  cd "$API_DIR"
  npm ci

  echo "[5/8] 安装 Web 依赖"
  cd "$WEB_DIR"
  npm ci
else
  echo "[4/8] 已跳过 API 依赖安装"
  echo "[5/8] 已跳过 Web 依赖安装"
fi

echo "[6/8] 生成 Prisma Client 并执行迁移"
cd "$API_DIR"
npm run prisma:generate
if [[ "$SKIP_MIGRATE" != "1" ]]; then
  npm run prisma:deploy
else
  echo "已跳过数据库迁移。"
fi

echo "[7/8] 构建 API + Web"
npm run build
cd "$WEB_DIR"
npm run build

echo "[8/8] 重启线上进程"
if command -v pm2 >/dev/null 2>&1; then
  if ! pm2 describe mindwall-api >/dev/null 2>&1; then
    pm2 start npm --name mindwall-api --cwd "$API_DIR" -- run start:prod
  fi
  pm2 restart mindwall-api --update-env

  if ! pm2 describe mindwall-web >/dev/null 2>&1; then
    pm2 start npm --name mindwall-web --cwd "$WEB_DIR" -- start -- --host 0.0.0.0 --port "$WEB_PORT"
  fi
  pm2 restart mindwall-web --update-env
  pm2 save
  echo "部署完成：pm2 已重启服务。"
  echo "Web 访问地址：http://服务器IP:$WEB_PORT"
else
  echo "未检测到 pm2，已完成代码更新、迁移和构建。"
  echo "请手动启动："
  echo "API: cd $API_DIR && npm run start:prod"
  echo "Web: cd $WEB_DIR && npm start -- --host 0.0.0.0 --port $WEB_PORT"
fi
