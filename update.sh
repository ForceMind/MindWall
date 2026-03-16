#!/usr/bin/env bash
set -euo pipefail

SELF="${BASH_SOURCE[0]:-$0}"
if command -v readlink >/dev/null 2>&1; then
  SELF="$(readlink -f "$SELF" 2>/dev/null || echo "$SELF")"
fi

ROOT_DIR="$(cd "$(dirname "$SELF")" && pwd)"
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
YES="${YES:-0}"

SUDO=""

usage() {
  cat <<'EOF'
MindWall 更新脚本

用法:
  sudo bash update.sh

参数:
  --branch <name>      指定分支，默认 main
  --web-port <port>    Web 端口，默认 3001
  --skip-git           跳过 git 拉取
  --skip-install       跳过 npm 依赖安装
  --skip-migrate       跳过 Prisma migrate deploy
  --no-docker          跳过 Docker 启动
  --yes                非交互模式(保留本地改动并跳过 git pull)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      [[ $# -ge 2 ]] || { echo "错误: --branch 缺少参数"; exit 1; }
      BRANCH="$2"
      shift 2
      ;;
    --web-port)
      [[ $# -ge 2 ]] || { echo "错误: --web-port 缺少参数"; exit 1; }
      WEB_PORT="$2"
      shift 2
      ;;
    --skip-git)
      SKIP_GIT="1"
      shift
      ;;
    --skip-install)
      SKIP_INSTALL="1"
      shift
      ;;
    --skip-migrate)
      SKIP_MIGRATE="1"
      shift
      ;;
    --no-docker)
      NO_DOCKER="1"
      shift
      ;;
    --yes)
      YES="1"
      shift
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "错误: 未识别参数 $1"
      usage
      exit 1
      ;;
  esac
done

have_command() {
  command -v "$1" >/dev/null 2>&1
}

as_root() {
  if [[ -n "$SUDO" ]]; then
    "$SUDO" "$@"
  else
    "$@"
  fi
}

die() {
  echo "错误: $*" >&2
  exit 1
}

warn() {
  echo "警告: $*" >&2
}

get_version() {
  if [[ -f "$VERSION_FILE" ]]; then
    tr -d '[:space:]' < "$VERSION_FILE"
    return
  fi
  echo "unknown"
}

require_root_capability() {
  if [[ "$(id -u)" -eq 0 ]]; then
    SUDO=""
    return
  fi
  if have_command sudo; then
    SUDO="sudo"
    return
  fi
  die "请使用 root 执行，或先安装 sudo。"
}

docker_engine_ready() {
  if ! have_command docker; then
    return 1
  fi
  as_root docker version >/dev/null 2>&1
}

docker_compose_available() {
  if have_command docker && as_root docker compose version >/dev/null 2>&1; then
    return 0
  fi
  if have_command docker-compose; then
    return 0
  fi
  return 1
}

docker_compose_run() {
  if have_command docker && as_root docker compose version >/dev/null 2>&1; then
    as_root docker compose -f "$COMPOSE_FILE" "$@"
    return
  fi
  if have_command docker-compose; then
    as_root docker-compose -f "$COMPOSE_FILE" "$@"
    return
  fi
  die "未检测到 Docker Compose。"
}

ensure_docker_mirrors() {
  local daemon_file="/etc/docker/daemon.json"
  if [[ -f "$daemon_file" ]] && grep -q '"registry-mirrors"' "$daemon_file"; then
    return
  fi
  as_root mkdir -p /etc/docker
  local tmp_file
  tmp_file="$(mktemp)"
  cat > "$tmp_file" <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com"
  ],
  "max-concurrent-downloads": 3
}
EOF
  as_root cp "$tmp_file" "$daemon_file"
  rm -f "$tmp_file"
}

ensure_runtime_files() {
  local config_dir="$API_DIR/config"
  local runtime_file="$config_dir/runtime-config.json"
  local runtime_example="$config_dir/runtime-config.example.json"

  mkdir -p "$config_dir" "$API_DIR/logs"
  if [[ ! -f "$runtime_file" ]]; then
    if [[ -f "$runtime_example" ]]; then
      cp "$runtime_example" "$runtime_file"
    else
      printf "{}\n" > "$runtime_file"
    fi
  fi

  if [[ ! -f "$API_DIR/.env" ]]; then
    if [[ -f "$API_DIR/.env.example" ]]; then
      cp "$API_DIR/.env.example" "$API_DIR/.env"
    elif [[ -f "$ROOT_DIR/.env.example" ]]; then
      cp "$ROOT_DIR/.env.example" "$API_DIR/.env"
    fi
  fi
}

dependencies_missing() {
  local missing=0
  for cmd in node npm pm2; do
    if ! have_command "$cmd"; then
      missing=1
    fi
  done
  if [[ "$NO_DOCKER" != "1" ]]; then
    if ! have_command docker || ! docker_engine_ready || ! docker_compose_available; then
      missing=1
    fi
  fi
  [[ "$missing" -eq 1 ]]
}

update_git_source() {
  if [[ "$SKIP_GIT" == "1" ]]; then
    echo "已跳过 Git 拉取"
    return
  fi
  if ! have_command git; then
    warn "未检测到 git，跳过代码拉取。"
    return
  fi
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    warn "当前目录不是 Git 仓库，跳过代码拉取。"
    return
  fi
  if ! git remote get-url origin >/dev/null 2>&1; then
    warn "未配置 origin 远程仓库，跳过代码拉取。"
    return
  fi

  local dirty
  dirty="$(git status --porcelain || true)"
  if [[ -n "$dirty" ]]; then
    if [[ "$YES" == "1" ]]; then
      warn "检测到本地改动，--yes 模式跳过 git pull。"
      return
    fi
    echo "检测到本地改动："
    git status --short
    local force_update="n"
    read -r -p "是否丢弃本地改动并继续更新？[y/N]: " force_update
    case "${force_update,,}" in
      y|yes)
        git reset --hard
        git clean -fd
        ;;
      *)
        echo "已保留本地改动，跳过 git pull。"
        return
        ;;
    esac
  fi

  git fetch origin "$BRANCH" || return
  local cur
  cur="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ "$cur" != "$BRANCH" ]]; then
    git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH" || return
  fi
  git pull --ff-only origin "$BRANCH" || true
}

try_prepull_images() {
  as_root docker pull docker.m.daocloud.io/library/redis:7-alpine && \
    as_root docker tag docker.m.daocloud.io/library/redis:7-alpine redis:7-alpine || true
  as_root docker pull docker.m.daocloud.io/pgvector/pgvector:pg16 && \
    as_root docker tag docker.m.daocloud.io/pgvector/pgvector:pg16 pgvector/pgvector:pg16 || true
}

wait_for_container() {
  local name="$1"
  local timeout="${2:-120}"
  local waited=0
  while [[ "$waited" -lt "$timeout" ]]; do
    local state
    state="$(as_root docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || true)"
    if [[ "$state" == "healthy" || "$state" == "running" ]]; then
      return
    fi
    sleep 2
    waited=$((waited + 2))
  done
  die "容器 $name 在 ${timeout}s 内未就绪。"
}

start_infra() {
  if [[ "$NO_DOCKER" == "1" ]]; then
    echo "[2/8] 跳过 Docker 启动"
    return
  fi
  echo "[2/8] 启动 PostgreSQL + Redis"
  local ok=0
  for attempt in 1 2 3; do
    if docker_compose_run up -d; then
      ok=1
      break
    fi
    warn "Docker 启动失败，第 ${attempt} 次重试。"
    ensure_docker_mirrors
    if [[ "$attempt" -eq 1 ]]; then
      try_prepull_images
    fi
    if have_command systemctl; then
      as_root systemctl restart docker || true
    fi
    sleep $((attempt * 5))
  done
  [[ "$ok" -eq 1 ]] || die "Docker 镜像拉取失败(redis/pgvector)。"
  wait_for_container "mindwall-postgres" 180
  wait_for_container "mindwall-redis" 90
}

npm_install_with_fallback() {
  local dir="$1"
  cd "$dir"
  if [[ -f package-lock.json ]]; then
    if ! npm ci; then
      warn "npm ci 失败，回退 npm install。"
      npm install
    fi
  else
    npm install
  fi
}

start_services() {
  pm2 describe mindwall-api >/dev/null 2>&1 || \
    pm2 start npm --name mindwall-api --cwd "$API_DIR" -- run start:prod
  pm2 restart mindwall-api --update-env

  pm2 describe mindwall-web >/dev/null 2>&1 || \
    pm2 start npm --name mindwall-web --cwd "$WEB_DIR" -- run start -- --host 0.0.0.0 --port "$WEB_PORT"
  pm2 restart mindwall-web --update-env
  pm2 save
}

main() {
  require_root_capability
  cd "$ROOT_DIR"

  echo "MindWall 更新部署 v$(get_version)"
  echo "目录: $ROOT_DIR"

  if dependencies_missing; then
    warn "检测到依赖缺失，先执行 deploy.sh。"
    local deploy_args=("--branch" "$BRANCH" "--web-port" "$WEB_PORT" "--yes")
    if [[ "$SKIP_GIT" == "1" ]]; then
      deploy_args+=("--skip-git")
    fi
    if [[ "$NO_DOCKER" == "1" ]]; then
      deploy_args+=("--no-docker")
    fi
    as_root bash "$ROOT_DIR/deploy.sh" "${deploy_args[@]}"
  fi

  echo "[1/8] 更新代码"
  update_git_source

  start_infra

  echo "[3/8] 检查运行配置"
  ensure_runtime_files

  if [[ "$SKIP_INSTALL" != "1" ]]; then
    echo "[4/8] 安装 API/Web 依赖"
    npm_install_with_fallback "$API_DIR"
    npm_install_with_fallback "$WEB_DIR"
  else
    echo "[4/8] 已跳过依赖安装"
  fi

  echo "[5/8] Prisma 生成"
  cd "$API_DIR"
  npm run prisma:generate
  if [[ "$SKIP_MIGRATE" != "1" ]]; then
    echo "[6/8] Prisma 迁移"
    npm run prisma:deploy
  else
    echo "[6/8] 已跳过 Prisma 迁移"
  fi

  echo "[7/8] 构建 API/Web"
  cd "$API_DIR"
  npm run build
  cd "$WEB_DIR"
  npm run build

  echo "[8/8] 重启 PM2 服务"
  start_services

  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  ip="${ip:-<服务器IP>}"
  echo "更新完成: http://${ip}:${WEB_PORT}"
}

main "$@"
