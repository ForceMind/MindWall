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

RUNTIME_DIR="$ROOT_DIR/.mw-runtime"
NODE_RUNTIME_DIR="$RUNTIME_DIR/node"
NPM_GLOBAL_PREFIX="$RUNTIME_DIR/npm-global"
PM2_HOME_DIR="$RUNTIME_DIR/pm2-home"
RUNTIME_PORTS_FILE="$RUNTIME_DIR/ports.env"

NODE_BIN="$NODE_RUNTIME_DIR/bin/node"
NPM_BIN="$NODE_RUNTIME_DIR/bin/npm"
PM2_BIN="$NPM_GLOBAL_PREFIX/bin/pm2"

MIN_NODE_VERSION="${MIN_NODE_VERSION:-20.19.0}"
BRANCH="${BRANCH:-main}"
API_PORT="${API_PORT:-3100}"
WEB_PORT="${WEB_PORT:-3001}"
PUBLIC_HOST="${PUBLIC_HOST:-}"
SKIP_GIT="${SKIP_GIT:-0}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
SKIP_MIGRATE="${SKIP_MIGRATE:-0}"
NO_DOCKER="${NO_DOCKER:-0}"
YES="${YES:-0}"
API_PORT_SET=0
WEB_PORT_SET=0

SUDO=""

usage() {
  cat <<'EOF'
MindWall 更新脚本

用法:
  sudo bash update.sh

参数:
  --branch <name>       Git 分支（默认 main）
  --api-port <port>     API 端口（默认读取 .mw-runtime/ports.env，否则 3100）
  --web-port <port>     Web 端口（默认读取 .mw-runtime/ports.env，否则 3001）
  --public-host <host>  对外访问主机/IP（用于前端 API 地址）
  --skip-git            跳过 Git 拉取
  --skip-install        跳过 npm 安装
  --skip-migrate        跳过 Prisma migrate deploy
  --no-docker           跳过 Docker 启动
  --yes                 非交互模式（保留本地改动）
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      [[ $# -ge 2 ]] || { echo "错误: --branch 缺少参数值"; exit 1; }
      BRANCH="$2"
      shift 2
      ;;
    --api-port)
      [[ $# -ge 2 ]] || { echo "错误: --api-port 缺少参数值"; exit 1; }
      API_PORT="$2"
      API_PORT_SET=1
      shift 2
      ;;
    --web-port)
      [[ $# -ge 2 ]] || { echo "错误: --web-port 缺少参数值"; exit 1; }
      WEB_PORT="$2"
      WEB_PORT_SET=1
      shift 2
      ;;
    --public-host)
      [[ $# -ge 2 ]] || { echo "错误: --public-host 缺少参数值"; exit 1; }
      PUBLIC_HOST="$2"
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

validate_port() {
  local v="$1"
  [[ "$v" =~ ^[0-9]+$ ]] || return 1
  (( v >= 1 && v <= 65535 ))
}

project_version() {
  if [[ -f "$VERSION_FILE" ]]; then
    tr -d '[:space:]' < "$VERSION_FILE"
    return
  fi
  echo "未知"
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

version_ge() {
  local a="$1"
  local b="$2"
  [[ "$(printf '%s\n%s\n' "$a" "$b" | sort -V | head -n 1)" == "$b" ]]
}

node_version_of() {
  local node_path="$1"
  "$node_path" -v 2>/dev/null | sed 's/^v//'
}

npm_cmd() {
  PATH="$NODE_RUNTIME_DIR/bin:$PATH" "$NPM_BIN" "$@"
}

pm2_cmd() {
  PATH="$NPM_GLOBAL_PREFIX/bin:$NODE_RUNTIME_DIR/bin:$PATH" PM2_HOME="$PM2_HOME_DIR" "$PM2_BIN" "$@"
}

docker_engine_ready() {
  have_command docker && as_root docker version >/dev/null 2>&1
}

docker_compose_available() {
  if have_command docker && as_root docker compose version >/dev/null 2>&1; then
    return 0
  fi
  have_command docker-compose
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
  die "Docker Compose 不可用。"
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

load_saved_ports() {
  if [[ -f "$RUNTIME_PORTS_FILE" ]]; then
    local saved_api="" saved_web=""
    saved_api="$(grep -E '^API_PORT=' "$RUNTIME_PORTS_FILE" | tail -n 1 | cut -d= -f2- || true)"
    saved_web="$(grep -E '^WEB_PORT=' "$RUNTIME_PORTS_FILE" | tail -n 1 | cut -d= -f2- || true)"
    if [[ "$API_PORT_SET" != "1" && -n "$saved_api" ]]; then
      API_PORT="$saved_api"
    fi
    if [[ "$WEB_PORT_SET" != "1" && -n "$saved_web" ]]; then
      WEB_PORT="$saved_web"
    fi
  fi
}

set_or_append_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  if grep -Eq "^${key}=" "$file"; then
    sed -i "s#^${key}=.*#${key}=\"${value}\"#g" "$file"
  else
    printf '%s="%s"\n' "$key" "$value" >> "$file"
  fi
}

first_host_ip() {
  hostname -I 2>/dev/null | awk '{print $1}'
}

is_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

is_private_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^10\. ]] && return 0
  [[ "$ip" =~ ^192\.168\. ]] && return 0
  [[ "$ip" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] && return 0
  return 1
}

resolve_public_host() {
  if [[ -n "$PUBLIC_HOST" ]]; then
    echo "$PUBLIC_HOST"
    return
  fi

  local detected=""
  if have_command curl; then
    detected="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || true)"
    if is_ipv4 "$detected"; then
      echo "$detected"
      return
    fi
  fi

  detected="$(first_host_ip)"
  if [[ -n "$detected" ]]; then
    echo "$detected"
    return
  fi

  echo "localhost"
}

ensure_runtime_files() {
  local config_dir="$API_DIR/config"
  local runtime_file="$config_dir/runtime-config.json"
  local runtime_example="$config_dir/runtime-config.example.json"

  mkdir -p "$config_dir" "$API_DIR/logs" "$RUNTIME_DIR"
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

port_in_use() {
  local port="$1"
  if have_command lsof; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1
    return
  fi
  if have_command ss; then
    ss -ltn | awk '{print $4}' | grep -Eq "(^|:)$port$"
    return
  fi
  if have_command netstat; then
    netstat -lnt 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)$port$"
    return
  fi
  return 1
}

find_free_port() {
  local base="$1"
  local p="$base"
  while port_in_use "$p"; do
    p=$((p + 1))
  done
  echo "$p"
}

resolve_ports_with_conflict_guard() {
  local api_owned=0 web_owned=0
  if pm2_cmd describe mindwall-api >/dev/null 2>&1; then
    api_owned=1
  fi
  if pm2_cmd describe mindwall-web >/dev/null 2>&1; then
    web_owned=1
  fi

  if port_in_use "$API_PORT" && [[ "$api_owned" != "1" ]]; then
    local next_api
    next_api="$(find_free_port "$API_PORT")"
    warn "API 端口 $API_PORT 被其他服务占用，切换到 $next_api。"
    API_PORT="$next_api"
  fi

  if port_in_use "$WEB_PORT" && [[ "$web_owned" != "1" ]]; then
    local next_web
    next_web="$(find_free_port "$WEB_PORT")"
    warn "Web 端口 $WEB_PORT 被其他服务占用，切换到 $next_web。"
    WEB_PORT="$next_web"
  fi
}

ensure_local_runtime_ready() {
  if [[ ! -x "$NODE_BIN" || ! -x "$NPM_BIN" || ! -x "$PM2_BIN" ]]; then
    return 1
  fi
  local current
  current="$(node_version_of "$NODE_BIN" || true)"
  [[ -n "$current" ]] && version_ge "$current" "$MIN_NODE_VERSION"
}

update_git_source() {
  if [[ "$SKIP_GIT" == "1" ]]; then
    echo "已跳过 Git 拉取。"
    return
  fi
  if ! have_command git; then
    warn "未检测到 git，已跳过 Git 拉取。"
    return
  fi
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    warn "当前目录不是 Git 仓库，已跳过 Git 拉取。"
    return
  fi
  if ! git remote get-url origin >/dev/null 2>&1; then
    warn "未配置 origin 远程仓库，已跳过 Git 拉取。"
    return
  fi

  local dirty
  dirty="$(git status --porcelain || true)"
  if [[ -n "$dirty" ]]; then
    if [[ "$YES" == "1" ]]; then
      warn "检测到本地改动，--yes 模式保留改动并跳过 Git 拉取。"
      return
    fi
    warn "检测到本地改动，保留改动并跳过 Git 拉取。"
    return
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
    echo "[2/9] 跳过 Docker 启动"
    return
  fi
  echo "[2/9] 启动 PostgreSQL + Redis"
  local ok=0
  for attempt in 1 2 3; do
    if docker_compose_run up -d; then
      ok=1
      break
    fi
    warn "Docker 启动失败，第 $attempt 次重试。"
    ensure_docker_mirrors
    if [[ "$attempt" -eq 1 ]]; then
      try_prepull_images
    fi
    if have_command systemctl; then
      as_root systemctl restart docker || true
    fi
    sleep $((attempt * 5))
  done
  [[ "$ok" -eq 1 ]] || die "Docker 服务启动失败（redis/pgvector 镜像拉取失败）。"
  wait_for_container "mindwall-postgres" 180
  wait_for_container "mindwall-redis" 90
}

npm_install_with_fallback() {
  local dir="$1"
  cd "$dir"
  if [[ -f package-lock.json ]]; then
    if ! npm_cmd ci; then
      warn "目录 $dir 执行 npm ci 失败，回退为 npm install。"
      npm_cmd install
    fi
  else
    npm_cmd install
  fi
}

ensure_rollup_optional_dependency() {
  local dir="$1"
  local check_cmd="require.resolve('@rollup/rollup-linux-x64-gnu')"
  if (cd "$dir" && PATH="$NODE_RUNTIME_DIR/bin:$PATH" "$NODE_BIN" -e "$check_cmd") >/dev/null 2>&1; then
    return 0
  fi

  local rollup_opt_ver
  rollup_opt_ver="$(
    cd "$dir" && PATH="$NODE_RUNTIME_DIR/bin:$PATH" "$NODE_BIN" -e "try{const p=require('./node_modules/rollup/package.json');process.stdout.write((p.optionalDependencies&&p.optionalDependencies['@rollup/rollup-linux-x64-gnu'])||'')}catch(e){process.stdout.write('')}"
  )"

  if [[ -z "$rollup_opt_ver" ]]; then
    rollup_opt_ver="$(
      cd "$dir" && PATH="$NODE_RUNTIME_DIR/bin:$PATH" "$NODE_BIN" -e "try{const p=require('./package-lock.json');const r=p.packages&&p.packages['node_modules/rollup'];process.stdout.write((r&&r.optionalDependencies&&r.optionalDependencies['@rollup/rollup-linux-x64-gnu'])||'')}catch(e){process.stdout.write('')}"
    )"
  fi

  if [[ -n "$rollup_opt_ver" ]]; then
    echo "检测到 Rollup 可选依赖缺失，正在补装 @rollup/rollup-linux-x64-gnu@$rollup_opt_ver"
    (cd "$dir" && npm_cmd install --no-save "@rollup/rollup-linux-x64-gnu@$rollup_opt_ver")
  else
    echo "检测到 Rollup 可选依赖缺失，正在补装 @rollup/rollup-linux-x64-gnu（自动版本）"
    (cd "$dir" && npm_cmd install --no-save @rollup/rollup-linux-x64-gnu)
  fi

  if (cd "$dir" && PATH="$NODE_RUNTIME_DIR/bin:$PATH" "$NODE_BIN" -e "$check_cmd") >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

write_app_env_ports() {
  local host
  host="$(resolve_public_host)"
  if [[ -z "$host" ]]; then
    host="localhost"
  fi
  local api_env="$API_DIR/.env"
  set_or_append_env "$api_env" "PORT" "$API_PORT"
  set_or_append_env "$api_env" "WEB_ORIGIN" "http://${host}:${WEB_PORT}"
  set_or_append_env "$api_env" "APP_VERSION" "$(project_version)"

  cat > "$WEB_DIR/.env.production.local" <<EOF
VITE_API_BASE_URL=http://${host}:${API_PORT}
VITE_WS_BASE_URL=ws://${host}:${API_PORT}
EOF

  mkdir -p "$RUNTIME_DIR"
  cat > "$RUNTIME_PORTS_FILE" <<EOF
API_PORT=$API_PORT
WEB_PORT=$WEB_PORT
EOF
}

start_services() {
  pm2_cmd describe mindwall-api >/dev/null 2>&1 || \
    pm2_cmd start "$NPM_BIN" --name mindwall-api --cwd "$API_DIR" -- run start:prod
  pm2_cmd restart mindwall-api --update-env

  pm2_cmd describe mindwall-web >/dev/null 2>&1 || \
    pm2_cmd start "$NPM_BIN" --name mindwall-web --cwd "$WEB_DIR" -- run start -- --host 0.0.0.0 --port "$WEB_PORT"
  pm2_cmd restart mindwall-web --update-env
  pm2_cmd save
}

print_summary() {
  local ip
  ip="$(resolve_public_host)"
  if [[ -z "$ip" ]]; then
    ip="<服务器IP>"
  fi
  echo
  echo "更新完成: MindWall v$(project_version)"
  echo "API 端口: $API_PORT"
  echo "Web 端口: $WEB_PORT"
  echo "Web 地址: http://${ip}:${WEB_PORT}"
  echo "PM2_HOME: $PM2_HOME_DIR"
  if is_ipv4 "$ip" && is_private_ipv4 "$ip"; then
    echo "警告: 当前展示的是内网 IP（$ip），公网访问请设置 --public-host 或环境变量 PUBLIC_HOST。"
  fi
  echo "提示: 若公网仍无法访问，请检查云安全组/防火墙是否放行 $WEB_PORT（以及 $API_PORT）。"
}

main() {
  require_root_capability
  cd "$ROOT_DIR"

  echo "MindWall 更新部署 v$(project_version)"
  echo "目录: $ROOT_DIR"

  load_saved_ports
  validate_port "$API_PORT" || die "API 端口不合法: $API_PORT"
  validate_port "$WEB_PORT" || die "Web 端口不合法: $WEB_PORT"

  if ! ensure_local_runtime_ready; then
    warn "项目本地运行时缺失或版本过低，先执行 deploy.sh。"
    local deploy_args=(
      "--branch" "$BRANCH"
      "--api-port" "$API_PORT"
      "--web-port" "$WEB_PORT"
      "--yes"
    )
    if [[ "$SKIP_GIT" == "1" ]]; then
      deploy_args+=("--skip-git")
    fi
    if [[ "$NO_DOCKER" == "1" ]]; then
      deploy_args+=("--no-docker")
    fi
    if [[ -n "$PUBLIC_HOST" ]]; then
      deploy_args+=("--public-host" "$PUBLIC_HOST")
    fi
    as_root bash "$ROOT_DIR/deploy.sh" "${deploy_args[@]}"
  fi

  if [[ "$NO_DOCKER" != "1" ]]; then
    docker_engine_ready || die "Docker 不可用。"
    docker_compose_available || die "Docker Compose 不可用。"
  fi

  echo "[1/9] 更新代码"
  update_git_source

  start_infra

  echo "[3/9] 检查运行配置"
  ensure_runtime_files
  resolve_ports_with_conflict_guard
  write_app_env_ports

  if [[ "$SKIP_INSTALL" != "1" ]]; then
    echo "[4/9] 安装 API/Web 依赖"
    npm_install_with_fallback "$API_DIR"
    npm_install_with_fallback "$WEB_DIR"
    ensure_rollup_optional_dependency "$WEB_DIR"
  else
    echo "[4/9] 跳过依赖安装"
  fi

  echo "[5/9] 执行 Prisma 生成"
  cd "$API_DIR"
  npm_cmd run prisma:generate

  if [[ "$SKIP_MIGRATE" != "1" ]]; then
    echo "[6/9] 执行 Prisma 迁移"
    npm_cmd run prisma:deploy
  else
    echo "[6/9] 跳过 Prisma 迁移"
  fi

  echo "[7/9] 构建 API/Web"
  cd "$API_DIR"
  npm_cmd run build
  cd "$WEB_DIR"
  if ! npm_cmd run build; then
    warn "Web 构建失败，尝试修复 Rollup 可选依赖后重试。"
    ensure_rollup_optional_dependency "$WEB_DIR" || true
    if ! npm_cmd run build; then
      warn "重试仍失败，正在重装 Web 依赖后再次构建。"
      rm -rf "$WEB_DIR/node_modules"
      npm_install_with_fallback "$WEB_DIR"
      ensure_rollup_optional_dependency "$WEB_DIR"
      npm_cmd run build
    fi
  fi

  echo "[8/9] 重启 PM2 服务"
  start_services

  echo "[9/9] 完成"
  print_summary
}

main "$@"
