#!/usr/bin/env bash
if head -n 1 "$0" | grep -q $'\r'; then
  sed -i 's/\r$//' "$0"
  exec bash "$0" "$@"
fi

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERR]${NC} $*"; }
log_step()  { echo -e "\n${CYAN}${BOLD}$*${NC}"; }
die()       { log_error "$*" >&2; exit 1; }

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
NODE_BIN="$NODE_RUNTIME_DIR/bin/node"
NPM_BIN="$NODE_RUNTIME_DIR/bin/npm"
RUNTIME_PORTS_FILE="$RUNTIME_DIR/ports.env"
BACKUP_DIR="$RUNTIME_DIR/backups"
RUNTIME_WEB_SERVER_FILE="$RUNTIME_DIR/mindwall-web-server.cjs"

API_ENV_FILE="$API_DIR/.env"
WEB_ENV_FILE="$WEB_DIR/.env.production.local"

SYSTEMD_API_SERVICE="mindwall-api"
SYSTEMD_WEB_SERVICE="mindwall-web"
SYSTEMD_API_FILE="/etc/systemd/system/${SYSTEMD_API_SERVICE}.service"
SYSTEMD_WEB_FILE="/etc/systemd/system/${SYSTEMD_WEB_SERVICE}.service"

DEFAULT_API_PORT=3100
DEFAULT_WEB_PORT=3001
DEFAULT_PG_PORT=5433
DEFAULT_REDIS_PORT=6380

CURRENT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ -z "$CURRENT_BRANCH" || "$CURRENT_BRANCH" == "HEAD" ]]; then
  CURRENT_BRANCH="main"
fi

BRANCH="${BRANCH:-$CURRENT_BRANCH}"
API_PORT="${API_PORT:-$DEFAULT_API_PORT}"
WEB_PORT="${WEB_PORT:-$DEFAULT_WEB_PORT}"
PG_PORT="${PG_PORT:-$DEFAULT_PG_PORT}"
REDIS_PORT="${REDIS_PORT:-$DEFAULT_REDIS_PORT}"
PUBLIC_HOST="${PUBLIC_HOST:-}"
SKIP_GIT="${SKIP_GIT:-0}"
NO_DOCKER="${NO_DOCKER:-0}"
SKIP_SYSTEM_INSTALL="${SKIP_SYSTEM_INSTALL:-0}"
YES="${YES:-0}"

ADMIN_USERNAME="${ADMIN_USERNAME:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

MIN_NODE_VERSION="${MIN_NODE_VERSION:-20.19.0}"
LOCAL_NODE_VERSION="${LOCAL_NODE_VERSION:-20.19.5}"

SUDO=""
PKG_MANAGER=""

usage() {
  cat <<'EOF'
MindWall 部署脚本 v2.1（独立模式，不修改 Nginx/PM2）

用法:
  sudo bash deploy.sh [选项]

选项:
  --branch <name>           Git 分支（默认当前分支）
  --api-port <port>         API 端口（默认 3100，仅监听 127.0.0.1）
  --web-port <port>         Web 端口（默认 3001，对外监听）
  --pg-port <port>          PostgreSQL 端口（默认 5433）
  --redis-port <port>       Redis 端口（默认 6380）
  --public-host <host>      公网域名或 IP（用于 CORS 和展示）
  --skip-git                跳过 Git 拉取
  --no-docker               跳过 Docker（外部自备 PG/Redis）
  --skip-system-install     跳过系统依赖安装（更新模式常用）
  --yes                     非交互模式
  -h, --help                显示帮助

安全策略:
  1) 不修改全局 Nginx 配置
  2) 不接管/修改 PM2
  3) 不占用 80/443
  4) 不杀死非 MindWall 进程
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) [[ $# -ge 2 ]] || die "--branch 缺少参数"; BRANCH="$2"; shift 2 ;;
    --api-port) [[ $# -ge 2 ]] || die "--api-port 缺少参数"; API_PORT="$2"; shift 2 ;;
    --web-port) [[ $# -ge 2 ]] || die "--web-port 缺少参数"; WEB_PORT="$2"; shift 2 ;;
    --pg-port) [[ $# -ge 2 ]] || die "--pg-port 缺少参数"; PG_PORT="$2"; shift 2 ;;
    --redis-port) [[ $# -ge 2 ]] || die "--redis-port 缺少参数"; REDIS_PORT="$2"; shift 2 ;;
    --public-host) [[ $# -ge 2 ]] || die "--public-host 缺少参数"; PUBLIC_HOST="$2"; shift 2 ;;
    --skip-git) SKIP_GIT="1"; shift ;;
    --no-docker) NO_DOCKER="1"; shift ;;
    --skip-system-install) SKIP_SYSTEM_INSTALL="1"; shift ;;
    --yes) YES="1"; shift ;;
    -h|--help|help) usage; exit 0 ;;
    *) die "未知参数: $1（使用 --help 查看）" ;;
  esac
done

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

as_root() {
  if [[ -n "$SUDO" ]]; then
    "$SUDO" "$@"
  else
    "$@"
  fi
}

confirm_yes() {
  local prompt="$1"
  if [[ "$YES" == "1" ]]; then
    return 0
  fi
  read -r -p "$prompt" ans
  [[ "$ans" =~ ^[Yy]$ ]]
}

project_version() {
  if [[ -f "$VERSION_FILE" ]]; then
    tr -d '[:space:]' < "$VERSION_FILE"
  else
    echo "unknown"
  fi
}

read_kv() {
  local file="$1"
  local key="$2"
  if [[ ! -f "$file" ]]; then
    return 1
  fi
  grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- || true
}

read_env_value() {
  local file="$1"
  local key="$2"
  local default_value="${3:-}"
  if [[ -f "$file" ]]; then
    local raw
    raw="$(grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- || true)"
    if [[ -n "$raw" ]]; then
      raw="${raw%\"}"
      raw="${raw#\"}"
      echo "$raw"
      return 0
    fi
  fi
  echo "$default_value"
}

append_csv_item() {
  local csv="$1"
  local item="$2"
  if [[ -z "$item" ]]; then
    echo "$csv"
    return 0
  fi
  if [[ -z "$csv" ]]; then
    echo "$item"
    return 0
  fi
  case ",$csv," in
    *",$item,"*) echo "$csv" ;;
    *) echo "$csv,$item" ;;
  esac
}

normalize_public_host() {
  local host="$1"
  host="${host#http://}"
  host="${host#https://}"
  host="${host%%/*}"
  echo "$host"
}

require_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    SUDO=""
    return
  fi
  if have_cmd sudo; then
    SUDO="sudo"
    return
  fi
  die "请使用 root 或 sudo 执行。"
}

detect_pkg_manager() {
  if have_cmd apt-get; then
    PKG_MANAGER="apt"
  elif have_cmd dnf; then
    PKG_MANAGER="dnf"
  elif have_cmd yum; then
    PKG_MANAGER="yum"
  elif have_cmd zypper; then
    PKG_MANAGER="zypper"
  elif have_cmd pacman; then
    PKG_MANAGER="pacman"
  else
    PKG_MANAGER="unknown"
  fi
}

pkg_update_cache() {
  case "$PKG_MANAGER" in
    apt) as_root apt-get update -y ;;
    dnf) as_root dnf makecache -y || true ;;
    yum) as_root yum makecache -y || true ;;
    zypper) as_root zypper --gpg-auto-import-keys refresh || true ;;
    pacman) as_root pacman -Sy --noconfirm || true ;;
    *) ;;
  esac
}

pkg_install() {
  case "$PKG_MANAGER" in
    apt) as_root apt-get install -y "$@" ;;
    dnf) as_root dnf install -y "$@" ;;
    yum) as_root yum install -y "$@" ;;
    zypper) as_root zypper --non-interactive install "$@" ;;
    pacman) as_root pacman -S --noconfirm --needed "$@" ;;
    *) die "未识别包管理器，请手动安装: $*" ;;
  esac
}

validate_port() {
  local p="$1"
  [[ "$p" =~ ^[0-9]+$ ]] && (( p >= 1024 && p <= 65535 ))
}

port_in_use() {
  local p="$1"
  if have_cmd ss; then
    ss -lnt "( sport = :$p )" 2>/dev/null | grep -q ":$p"
    return $?
  fi
  if have_cmd lsof; then
    lsof -iTCP:"$p" -sTCP:LISTEN -Pn >/dev/null 2>&1
    return $?
  fi
  return 1
}

port_owner_summary() {
  local p="$1"
  if have_cmd ss; then
    ss -lntp "( sport = :$p )" 2>/dev/null | tail -n +2 | head -3
    return 0
  fi
  if have_cmd lsof; then
    lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -3
    return 0
  fi
  echo "无法识别占用进程"
}

version_ge() {
  [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1)" == "$2" ]]
}

node_version_of() {
  "$1" -v 2>/dev/null | sed -E 's/^v([0-9]+(\.[0-9]+){0,2}).*/\1/'
}

retry_cmd() {
  local max_retries="$1"
  shift
  local i=1
  while true; do
    if "$@"; then
      return 0
    fi
    if (( i >= max_retries )); then
      return 1
    fi
    sleep $((i * 2))
    i=$((i + 1))
  done
}

resolve_host_for_display() {
  if [[ -n "$PUBLIC_HOST" ]]; then
    echo "$(normalize_public_host "$PUBLIC_HOST")"
    return
  fi
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  if [[ -n "$ip" ]]; then
    echo "$ip"
  else
    echo "127.0.0.1"
  fi
}

load_saved_ports() {
  if [[ ! -f "$RUNTIME_PORTS_FILE" ]]; then
    return 0
  fi

  local val
  val="$(read_kv "$RUNTIME_PORTS_FILE" API_PORT || true)"
  if [[ -n "$val" && "$API_PORT" == "$DEFAULT_API_PORT" ]]; then
    API_PORT="$val"
  fi

  val="$(read_kv "$RUNTIME_PORTS_FILE" WEB_PORT || true)"
  if [[ -n "$val" && "$WEB_PORT" == "$DEFAULT_WEB_PORT" ]]; then
    WEB_PORT="$val"
  fi

  val="$(read_kv "$RUNTIME_PORTS_FILE" PG_PORT || true)"
  if [[ -n "$val" && "$PG_PORT" == "$DEFAULT_PG_PORT" ]]; then
    PG_PORT="$val"
  fi

  val="$(read_kv "$RUNTIME_PORTS_FILE" REDIS_PORT || true)"
  if [[ -n "$val" && "$REDIS_PORT" == "$DEFAULT_REDIS_PORT" ]]; then
    REDIS_PORT="$val"
  fi

  val="$(read_kv "$RUNTIME_PORTS_FILE" PUBLIC_HOST || true)"
  if [[ -n "$val" && -z "$PUBLIC_HOST" ]]; then
    PUBLIC_HOST="$val"
  fi
}

save_runtime_ports() {
  mkdir -p "$RUNTIME_DIR"
  cat > "$RUNTIME_PORTS_FILE" <<EOF
API_PORT=$API_PORT
WEB_PORT=$WEB_PORT
PG_PORT=$PG_PORT
REDIS_PORT=$REDIS_PORT
PUBLIC_HOST=$PUBLIC_HOST
EOF
}

backup_runtime_files() {
  mkdir -p "$BACKUP_DIR"
  local ts
  ts="$(date +%Y%m%d-%H%M%S)"
  local target="$BACKUP_DIR/$ts"
  mkdir -p "$target"

  [[ -f "$API_ENV_FILE" ]] && cp "$API_ENV_FILE" "$target/api.env"
  [[ -f "$WEB_ENV_FILE" ]] && cp "$WEB_ENV_FILE" "$target/web.env.production.local"
  [[ -f "$RUNTIME_PORTS_FILE" ]] && cp "$RUNTIME_PORTS_FILE" "$target/ports.env"

  log_info "已备份现有配置到: $target"

  local count
  count="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d '[:space:]')"
  if [[ -n "$count" ]] && (( count > 10 )); then
    find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | sort | head -n $((count - 10)) | xargs rm -rf
  fi
}

validate_project_tree() {
  [[ -d "$API_DIR" ]] || die "缺少目录: $API_DIR"
  [[ -d "$WEB_DIR" ]] || die "缺少目录: $WEB_DIR"
  [[ -f "$API_DIR/package.json" ]] || die "缺少文件: $API_DIR/package.json"
  [[ -f "$WEB_DIR/package.json" ]] || die "缺少文件: $WEB_DIR/package.json"
}

install_system_packages() {
  if [[ "$SKIP_SYSTEM_INSTALL" == "1" ]]; then
    log_info "跳过系统依赖安装（--skip-system-install）"
    return 0
  fi

  log_step "[1/8] 安装基础工具"
  pkg_update_cache
  case "$PKG_MANAGER" in
    apt)
      pkg_install ca-certificates curl git tar xz-utils lsof jq
      ;;
    dnf|yum)
      pkg_install ca-certificates curl git tar xz lsof jq
      ;;
    zypper|pacman)
      pkg_install ca-certificates curl git tar xz lsof jq
      ;;
    *)
      die "无法自动安装依赖，请手动安装 curl/git/tar/xz/lsof/jq"
      ;;
  esac
}

ensure_docker_engine() {
  if [[ "$NO_DOCKER" == "1" ]]; then
    log_info "跳过 Docker（--no-docker）"
    return 0
  fi

  log_step "[2/8] 准备 Docker（PostgreSQL + Redis）"

  if have_cmd docker && as_root docker info >/dev/null 2>&1; then
    log_info "Docker 已可用"
  else
    if [[ "$SKIP_SYSTEM_INSTALL" == "1" ]]; then
      die "Docker 不可用，请去掉 --skip-system-install 或手动安装 Docker"
    fi

    case "$PKG_MANAGER" in
      apt)
        pkg_install docker.io docker-compose-plugin || pkg_install docker.io
        ;;
      dnf)
        as_root dnf install -y dnf-plugins-core || true
        as_root dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo || true
        pkg_install docker-ce docker-ce-cli containerd.io docker-compose-plugin || pkg_install docker docker-compose-plugin
        ;;
      yum)
        as_root yum install -y yum-utils || true
        if have_cmd yum-config-manager; then
          as_root yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo || true
        fi
        pkg_install docker-ce docker-ce-cli containerd.io docker-compose-plugin || pkg_install docker docker-compose-plugin
        ;;
      *)
        die "当前系统无法自动安装 Docker，请手动安装后重试"
        ;;
    esac

    if have_cmd systemctl; then
      as_root systemctl daemon-reload || true
      as_root systemctl enable docker || true
      as_root systemctl restart docker || true
    fi
  fi

  as_root docker info >/dev/null 2>&1 || die "Docker 引擎不可用，请检查 docker 服务状态"
}

docker_compose() {
  local env_file="$ROOT_DIR/infra/.env"
  local args=(-f "$COMPOSE_FILE")
  [[ -f "$env_file" ]] && args+=(--env-file "$env_file")

  if as_root docker compose version >/dev/null 2>&1; then
    as_root docker compose "${args[@]}" "$@"
  elif have_cmd docker-compose; then
    as_root docker-compose "${args[@]}" "$@"
  else
    die "未找到 docker compose"
  fi
}

start_infra() {
  if [[ "$NO_DOCKER" == "1" ]]; then
    return 0
  fi

  [[ -f "$COMPOSE_FILE" ]] || die "缺少文件: $COMPOSE_FILE"

  cat > "$ROOT_DIR/infra/.env" <<EOF
MW_PG_PORT=$PG_PORT
MW_REDIS_PORT=$REDIS_PORT
MW_PG_PASSWORD=mindwall
EOF

  docker_compose up -d postgres redis

  log_info "等待 PostgreSQL 就绪..."
  local retries=60
  while (( retries > 0 )); do
    if as_root docker exec mindwall-postgres pg_isready -U mindwall -d mindwall >/dev/null 2>&1; then
      log_info "PostgreSQL/Redis 已就绪"
      return 0
    fi
    sleep 2
    retries=$((retries - 1))
  done

  as_root docker logs --tail 30 mindwall-postgres 2>/dev/null || true
  die "PostgreSQL 启动超时"
}

download_with_fallback() {
  local out="$1"
  shift
  local url
  for url in "$@"; do
    if curl -fL --connect-timeout 10 --retry 2 --retry-delay 2 "$url" -o "$out"; then
      return 0
    fi
  done
  return 1
}

install_local_node_runtime() {
  local arch
  local node_arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) die "不支持的 CPU 架构: $arch" ;;
  esac

  local tmp
  tmp="$(mktemp -d)"
  local tarball="node-v${LOCAL_NODE_VERSION}-linux-${node_arch}.tar.xz"

  log_info "下载 Node.js v${LOCAL_NODE_VERSION}..."
  if ! download_with_fallback "$tmp/$tarball" \
    "https://nodejs.org/dist/v${LOCAL_NODE_VERSION}/${tarball}" \
    "https://npmmirror.com/mirrors/node/v${LOCAL_NODE_VERSION}/${tarball}"; then
    rm -rf "$tmp"
    die "Node.js 下载失败，请检查网络"
  fi

  tar -xJf "$tmp/$tarball" -C "$tmp"
  rm -rf "$NODE_RUNTIME_DIR"
  mkdir -p "$RUNTIME_DIR"
  mv "$tmp/node-v${LOCAL_NODE_VERSION}-linux-${node_arch}" "$NODE_RUNTIME_DIR"
  chmod +x "$NODE_RUNTIME_DIR/bin/node" "$NODE_RUNTIME_DIR/bin/npm" "$NODE_RUNTIME_DIR/bin/npx"
  rm -rf "$tmp"
}

ensure_node_runtime() {
  log_step "[3/8] 准备本地 Node.js 运行时"

  local current=""
  if [[ -x "$NODE_BIN" ]]; then
    current="$(node_version_of "$NODE_BIN" || true)"
  fi

  if [[ -n "$current" ]] && version_ge "$current" "$MIN_NODE_VERSION"; then
    log_info "Node.js 已就绪: v$current"
  else
    install_local_node_runtime
    local installed
    installed="$(node_version_of "$NODE_BIN" || true)"
    [[ -n "$installed" ]] || die "Node.js 安装失败"
    version_ge "$installed" "$MIN_NODE_VERSION" || die "Node.js 版本过低: v$installed"
    log_info "Node.js 已安装: v$installed"
  fi
}

npm_exec() {
  PATH="$NODE_RUNTIME_DIR/bin:$PATH" "$NPM_BIN" "$@"
}

npm_install_dir() {
  local dir="$1"

  if [[ -f "$dir/package-lock.json" ]]; then
    if ! (cd "$dir" && retry_cmd 2 npm_exec ci --no-audit --no-fund); then
      log_warn "$dir: npm ci 失败，改用 npm install"
      rm -rf "$dir/node_modules"
      (cd "$dir" && npm_exec install --no-audit --no-fund)
    fi
  else
    (cd "$dir" && npm_exec install --no-audit --no-fund)
  fi
}

ensure_rollup_native() {
  local arch
  arch="$(uname -m)"
  local pkg=""
  case "$arch" in
    x86_64|amd64) pkg="@rollup/rollup-linux-x64-gnu" ;;
    aarch64|arm64) pkg="@rollup/rollup-linux-arm64-gnu" ;;
    *) return 0 ;;
  esac

  (cd "$WEB_DIR" && npm_exec install --no-save --no-audit --no-fund "$pkg") || true
}

random_alnum() {
  local len="$1"
  tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$len"
}

write_api_env() {
  log_step "[6/8] 写入环境配置 + 启动数据库"

  local db_url
  db_url="postgresql://mindwall:mindwall@127.0.0.1:${PG_PORT}/mindwall?schema=public"

  local existing_admin_user
  local existing_admin_pass
  local existing_admin_token
  local existing_api_base
  local existing_api_key
  local existing_embed_key
  local existing_model
  local existing_embed_model
  local existing_cors

  existing_admin_user="$(read_env_value "$API_ENV_FILE" "ADMIN_USERNAME" "admin")"
  existing_admin_pass="$(read_env_value "$API_ENV_FILE" "ADMIN_PASSWORD" "")"
  existing_admin_token="$(read_env_value "$API_ENV_FILE" "ADMIN_TOKEN" "")"
  existing_api_base="$(read_env_value "$API_ENV_FILE" "OPENAI_BASE_URL" "https://api.openai.com/v1")"
  existing_api_key="$(read_env_value "$API_ENV_FILE" "OPENAI_API_KEY" "")"
  existing_embed_key="$(read_env_value "$API_ENV_FILE" "OPENAI_EMBEDDING_API_KEY" "")"
  existing_model="$(read_env_value "$API_ENV_FILE" "OPENAI_MODEL" "gpt-4.1-mini")"
  existing_embed_model="$(read_env_value "$API_ENV_FILE" "OPENAI_EMBEDDING_MODEL" "text-embedding-3-small")"
  existing_cors="$(read_env_value "$API_ENV_FILE" "CORS_ALLOWED_ORIGINS" "")"

  if [[ -z "$ADMIN_USERNAME" ]]; then
    ADMIN_USERNAME="$existing_admin_user"
  fi
  [[ -n "$ADMIN_USERNAME" ]] || ADMIN_USERNAME="admin"

  if [[ -z "$ADMIN_PASSWORD" ]]; then
    ADMIN_PASSWORD="$existing_admin_pass"
  fi
  # 如果密码仍为空或是不安全的默认值，自动生成
  if [[ -z "$ADMIN_PASSWORD" || "$ADMIN_PASSWORD" == "change-this-admin-password" || "$ADMIN_PASSWORD" == "mindwall-admin" ]]; then
    ADMIN_PASSWORD="mw$(random_alnum 12)"
    log_warn "管理员密码未设置或为默认值，已自动生成: ${BOLD}${ADMIN_PASSWORD}${NC}"
  fi

  local admin_token
  admin_token="$existing_admin_token"
  if [[ -z "$admin_token" ]]; then
    admin_token="tok_$(random_alnum 32)"
  fi

  local norm_host
  norm_host="$(normalize_public_host "$PUBLIC_HOST")"

  local web_origin
  if [[ -n "$norm_host" ]]; then
    web_origin="https://${norm_host}"
  else
    web_origin="http://127.0.0.1:${WEB_PORT}"
  fi

  local cors_csv
  cors_csv="$existing_cors"
  cors_csv="$(append_csv_item "$cors_csv" "http://127.0.0.1:${WEB_PORT}")"
  cors_csv="$(append_csv_item "$cors_csv" "http://localhost:${WEB_PORT}")"
  if [[ -n "$norm_host" ]]; then
    cors_csv="$(append_csv_item "$cors_csv" "https://${norm_host}")"
    cors_csv="$(append_csv_item "$cors_csv" "http://${norm_host}")"
  fi

  cat > "$API_ENV_FILE" <<EOF
DATABASE_URL="$db_url"
PORT="$API_PORT"
APP_VERSION="$(project_version)"
ADMIN_USERNAME="$ADMIN_USERNAME"
ADMIN_PASSWORD="$ADMIN_PASSWORD"
ADMIN_TOKEN="$admin_token"
OPENAI_BASE_URL="$existing_api_base"
OPENAI_API_KEY="$existing_api_key"
OPENAI_EMBEDDING_API_KEY="$existing_embed_key"
OPENAI_MODEL="$existing_model"
OPENAI_EMBEDDING_MODEL="$existing_embed_model"
WEB_ORIGIN="$web_origin"
CORS_ALLOWED_ORIGINS="$cors_csv"
EOF

  cat > "$WEB_ENV_FILE" <<EOF
VITE_API_BASE_URL=/api
VITE_WS_BASE_URL=/ws
VITE_ALLOWED_HOSTS=all
EOF

  chmod 600 "$API_ENV_FILE" || true
}

update_code() {
  log_step "[4/8] 更新代码"

  if [[ "$SKIP_GIT" == "1" ]]; then
    log_info "跳过 Git 更新（--skip-git）"
    return 0
  fi

  if ! have_cmd git || [[ ! -d "$ROOT_DIR/.git" ]]; then
    log_warn "当前不是 Git 仓库，跳过更新"
    return 0
  fi

  cd "$ROOT_DIR"

  if ! git fetch origin "$BRANCH"; then
    log_warn "git fetch 失败，继续使用本地代码"
    return 0
  fi

  local dirty
  dirty="$(git status --porcelain || true)"
  if [[ -n "$dirty" ]]; then
    echo "检测到本地未提交改动:"
    echo "$dirty" | head -n 20
    if confirm_yes "是否丢弃本地改动并继续更新？[y/N]: "; then
      git reset --hard HEAD
      git clean -fd
    else
      log_warn "保留本地改动，跳过 Git 拉取"
      return 0
    fi
  fi

  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git checkout "$BRANCH"
  elif git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    git checkout -b "$BRANCH" "origin/$BRANCH"
  fi

  if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    git pull --ff-only origin "$BRANCH"
  fi

  find "$ROOT_DIR" -maxdepth 1 \( -name '*.sh' -o -name 'mw' \) -type f -exec sed -i 's/\r$//' {} +
  log_info "代码更新完成"
}

stop_mindwall_services() {
  if ! have_cmd systemctl; then
    return 0
  fi

  as_root systemctl stop "$SYSTEMD_API_SERVICE" 2>/dev/null || true
  as_root systemctl stop "$SYSTEMD_WEB_SERVICE" 2>/dev/null || true
  sleep 1
}

stop_legacy_mindwall_processes() {
  if ! have_cmd ps; then
    return 0
  fi

  local pids
  pids="$(ps -eo pid,args | grep -F "$ROOT_DIR" | grep -E 'vite preview|mindwall-web-server\.cjs|apps/api/dist' | grep -v grep | awk '{print $1}' || true)"
  if [[ -n "$pids" ]]; then
    log_warn "检测到旧版 MindWall 进程，正在停止: $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

check_ports() {
  validate_port "$API_PORT" || die "API 端口非法: $API_PORT"
  validate_port "$WEB_PORT" || die "Web 端口非法: $WEB_PORT"
  validate_port "$PG_PORT" || die "PG 端口非法: $PG_PORT"
  validate_port "$REDIS_PORT" || die "Redis 端口非法: $REDIS_PORT"

  [[ "$API_PORT" != "$WEB_PORT" ]] || die "API 和 Web 端口不能相同"

  if port_in_use "$API_PORT"; then
    log_error "API 端口 $API_PORT 已被占用"
    port_owner_summary "$API_PORT"
    die "请改用 --api-port"
  fi

  if port_in_use "$WEB_PORT"; then
    log_error "Web 端口 $WEB_PORT 已被占用"
    port_owner_summary "$WEB_PORT"
    die "请改用 --web-port"
  fi
}

install_and_build() {
  log_step "[7/8] 安装依赖、迁移数据库、构建"

  # 限制 Node 构建内存，防止 OOM 影响服务器其他应用
  export NODE_OPTIONS="--max-old-space-size=512"

  npm_install_dir "$API_DIR"
  (cd "$API_DIR" && npm_exec run prisma:generate)
  (cd "$API_DIR" && npm_exec run prisma:deploy)
  (cd "$API_DIR" && npm_exec run build)

  npm_install_dir "$WEB_DIR"
  ensure_rollup_native
  if ! (cd "$WEB_DIR" && npm_exec run build); then
    log_warn "Web 构建失败，执行依赖修复后重试"
    rm -rf "$WEB_DIR/node_modules"
    npm_install_dir "$WEB_DIR"
    ensure_rollup_native
    (cd "$WEB_DIR" && npm_exec run build)
  fi

  unset NODE_OPTIONS
}

write_web_server() {
  mkdir -p "$RUNTIME_DIR"
  cat > "$RUNTIME_WEB_SERVER_FILE" <<'EOF'
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const WEB_PORT = Number(process.env.WEB_PORT || 3001);
const API_PORT = Number(process.env.API_PORT || 3100);
const WEB_DIST_DIR = process.env.WEB_DIST_DIR || path.resolve(__dirname, '../apps/web/dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function toSafeFile(requestPath) {
  const cleaned = path.normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.join(WEB_DIST_DIR, cleaned);
  const rel = path.relative(WEB_DIST_DIR, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return full;
}

function proxyApi(req, res) {
  const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let upstreamPath = parsed.pathname;
  if (upstreamPath === '/api') {
    upstreamPath = '/';
  } else if (upstreamPath.startsWith('/api/')) {
    upstreamPath = upstreamPath.slice(4);
  }

  const upstreamReq = http.request(
    {
      host: '127.0.0.1',
      port: API_PORT,
      method: req.method,
      path: `${upstreamPath}${parsed.search || ''}`,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${API_PORT}`,
      },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on('error', (err) => {
    sendJson(res, 502, { message: 'API 不可用', detail: String(err.message || err) });
  });

  req.pipe(upstreamReq);
}

function serveStatic(req, res) {
  const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsed.pathname || '/');
  if (pathname.endsWith('/')) {
    pathname += 'index.html';
  }

  let filePath = toSafeFile(pathname);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(WEB_DIST_DIR, 'index.html');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      sendJson(res, 404, { message: '页面不存在' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function proxyWebsocket(req, socket, head) {
  const upstream = net.connect(API_PORT, '127.0.0.1');

  upstream.on('connect', () => {
    let headerLines = '';
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() === 'host') continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          headerLines += `${k}: ${item}\r\n`;
        }
      } else if (v !== undefined) {
        headerLines += `${k}: ${v}\r\n`;
      }
    }
    headerLines += `host: 127.0.0.1:${API_PORT}\r\n\r\n`;
    upstream.write(`${req.method} ${req.url || '/'} HTTP/${req.httpVersion}\r\n${headerLines}`);
    if (head && head.length) {
      upstream.write(head);
    }
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url || '/').split('?')[0];
  if (!pathname.startsWith('/ws')) {
    socket.destroy();
    return;
  }
  proxyWebsocket(req, socket, head);
});

server.listen(WEB_PORT, '0.0.0.0', () => {
  process.stdout.write(`MindWall Web listening on :${WEB_PORT}, proxy API :${API_PORT}\n`);
});
EOF
}

setup_api_service() {
  have_cmd systemctl || die "系统不支持 systemd"

  local api_entry="$API_DIR/dist/src/main.js"
  [[ -f "$api_entry" ]] || api_entry="$API_DIR/dist/main.js"
  [[ -f "$api_entry" ]] || die "找不到 API 构建产物"

  cat > /tmp/mindwall-api.service <<EOF
[Unit]
Description=MindWall API Service
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
WorkingDirectory=$API_DIR
Environment=NODE_ENV=production
Environment="PATH=$NODE_RUNTIME_DIR/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
EnvironmentFile=-$API_ENV_FILE
ExecStart=$NODE_BIN $api_entry
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

  as_root mv /tmp/mindwall-api.service "$SYSTEMD_API_FILE"
  as_root systemctl daemon-reload
  as_root systemctl enable "$SYSTEMD_API_SERVICE"
  as_root systemctl restart "$SYSTEMD_API_SERVICE"
}

setup_web_service() {
  have_cmd systemctl || die "系统不支持 systemd"
  write_web_server

  cat > /tmp/mindwall-web.service <<EOF
[Unit]
Description=MindWall Web Service
After=network.target $SYSTEMD_API_SERVICE.service
Wants=$SYSTEMD_API_SERVICE.service

[Service]
Type=simple
WorkingDirectory=$ROOT_DIR
Environment=NODE_ENV=production
Environment="PATH=$NODE_RUNTIME_DIR/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="WEB_PORT=$WEB_PORT"
Environment="API_PORT=$API_PORT"
Environment="WEB_DIST_DIR=$WEB_DIR/dist"
ExecStart=$NODE_BIN $RUNTIME_WEB_SERVER_FILE
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

  as_root mv /tmp/mindwall-web.service "$SYSTEMD_WEB_FILE"
  as_root systemctl daemon-reload
  as_root systemctl enable "$SYSTEMD_WEB_SERVICE"
  as_root systemctl restart "$SYSTEMD_WEB_SERVICE"
}

wait_http_ok() {
  local url="$1"
  local retries="${2:-20}"
  while (( retries > 0 )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    retries=$((retries - 1))
  done
  return 1
}

start_services() {
  log_step "[8/8] 启动 systemd 服务"

  setup_api_service
  sleep 2
  if ! as_root systemctl is-active --quiet "$SYSTEMD_API_SERVICE"; then
    as_root journalctl -u "$SYSTEMD_API_SERVICE" -n 50 --no-pager || true
    die "mindwall-api 启动失败"
  fi

  setup_web_service
  sleep 2
  if ! as_root systemctl is-active --quiet "$SYSTEMD_WEB_SERVICE"; then
    as_root journalctl -u "$SYSTEMD_WEB_SERVICE" -n 50 --no-pager || true
    die "mindwall-web 启动失败"
  fi

  if ! wait_http_ok "http://127.0.0.1:${API_PORT}/health" 20; then
    log_warn "API 健康检查未通过，请检查日志: journalctl -u mindwall-api -f"
  fi

  if ! wait_http_ok "http://127.0.0.1:${WEB_PORT}/" 10; then
    log_warn "Web 健康检查未通过，请检查日志: journalctl -u mindwall-web -f"
  fi
}

register_mw_command() {
  if [[ ! -f "$ROOT_DIR/mw" ]]; then
    return 0
  fi
  chmod +x "$ROOT_DIR/mw" || true
  ln -sfn "$ROOT_DIR/mw" /usr/local/bin/mw || true
}

print_summary() {
  local host
  host="$(resolve_host_for_display)"

  echo
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  MindWall v$(project_version) 部署完成${NC}"
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${NC}"
  echo -e "  模式:      ${GREEN}独立模式${NC}（不修改 Nginx / 不碰其他服务）"
  if [[ -n "$PUBLIC_HOST" ]]; then
    echo -e "  公网地址:  ${CYAN}https://$(normalize_public_host "$PUBLIC_HOST")${NC}"
  fi
  echo -e "  Web 内网:  ${CYAN}http://${host}:${WEB_PORT}${NC}"
  echo -e "  API 端口:  $API_PORT (仅 127.0.0.1)"
  echo -e "  Web 端口:  $WEB_PORT (0.0.0.0)"
  echo
  echo -e "  ${YELLOW}管理后台:${NC}  ${CYAN}https://$(normalize_public_host "${PUBLIC_HOST:-${host}:${WEB_PORT}}")/admin/login${NC}"
  echo -e "  ${YELLOW}管理员:${NC}    ${ADMIN_USERNAME}"
  echo -e "  ${YELLOW}密码:${NC}      ${BOLD}${ADMIN_PASSWORD}${NC}  ← ${RED}请立即记录${NC}"
  echo
  echo -e "  命令:  ${CYAN}mw status${NC}   查看状态"
  echo -e "         ${CYAN}mw logs${NC}     查看日志"
  echo -e "         ${CYAN}mw restart${NC}  重启"
  echo -e "         ${CYAN}mw menu${NC}     交互菜单"
  echo
  if [[ -z "$PUBLIC_HOST" ]]; then
    echo -e "  ${YELLOW}提示:${NC} 域名访问请重新部署并输入公网域名，或使用 --public-host"
  fi
  echo -e "  ${YELLOW}提示:${NC} Nginx 反代配置参考: infra/mindwall-nginx.conf.template"
  echo
}

main() {
  cd "$ROOT_DIR"

  echo -e "${CYAN}${BOLD}MindWall 部署脚本 v2.1${NC}  目录: $ROOT_DIR  分支: $BRANCH"

  require_root
  validate_project_tree
  detect_pkg_manager
  load_saved_ports

  # 先交互，后安装 — 不让用户等完 dnf 才能输入
  interactive_config

  log_info "端口分配: API=$API_PORT  Web=$WEB_PORT  PG=$PG_PORT  Redis=$REDIS_PORT"
  [[ -n "$PUBLIC_HOST" ]] && log_info "域名: $PUBLIC_HOST（CORS 已自动包含）"

  install_system_packages
  ensure_docker_engine
  ensure_node_runtime

  update_code

  backup_runtime_files

  # 停止 MindWall 自己的服务（绝不碰其他进程）
  stop_mindwall_services
  stop_legacy_mindwall_processes
  check_ports

  save_runtime_ports
  write_api_env
  start_infra
  install_and_build
  start_services
  register_mw_command
  print_summary
}

# ═══════════════════════════════════════════════════════════════
#  交互式配置 — 询问公网域名和管理员凭据
# ═══════════════════════════════════════════════════════════════
interactive_config() {
  # 非交互模式 (--yes) 跳过
  if [[ "$YES" == "1" ]]; then
    return 0
  fi

  # 不在终端中运行（如管道），跳过
  if [[ ! -t 0 ]]; then
    return 0
  fi

  echo

  # ── 公网域名 ──
  if [[ -z "$PUBLIC_HOST" ]]; then
    echo -e "${CYAN}[?]${NC} 你的公网域名是什么？（如 mindwall.example.com）"
    echo -e "    用于 CORS 允许域名访问，直接回车跳过"
    read -r -p "    域名: " input_host
    if [[ -n "$input_host" ]]; then
      PUBLIC_HOST="$(normalize_public_host "$input_host")"
      log_info "公网域名: $PUBLIC_HOST"
    fi
  else
    log_info "公网域名（已保存）: $PUBLIC_HOST"
  fi

  # ── 管理员凭据 ──
  local existing_pw=""
  if [[ -f "$API_ENV_FILE" ]]; then
    existing_pw="$(read_env_value "$API_ENV_FILE" "ADMIN_PASSWORD" "")"
  fi

  # 如果密码为空或是默认值，才提示设置
  if [[ -z "$existing_pw" || "$existing_pw" == "change-this-admin-password" || "$existing_pw" == "mindwall-admin" ]]; then
    echo
    echo -e "${CYAN}[?]${NC} 设置管理后台账号密码"

    read -r -p "    管理员用户名（默认 admin）: " input_user
    if [[ -n "$input_user" ]]; then
      ADMIN_USERNAME="$input_user"
    fi

    while true; do
      read -r -s -p "    管理员密码（回车自动生成）: " input_pw
      echo
      if [[ -n "$input_pw" ]]; then
        if (( ${#input_pw} < 6 )); then
          log_warn "密码至少 6 位，请重新输入"
          continue
        fi
        ADMIN_PASSWORD="$input_pw"
      else
        ADMIN_PASSWORD="mw$(random_alnum 12)"
        echo -e "    ${GREEN}已自动生成密码:${NC} ${BOLD}${ADMIN_PASSWORD}${NC}"
      fi
      break
    done
  else
    log_info "管理员密码已配置（如需修改请编辑 $API_ENV_FILE）"
  fi

  echo
}

main "$@"