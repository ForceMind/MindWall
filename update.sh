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
RUNTIME_PORTS_FILE="$RUNTIME_DIR/ports.env"

NODE_BIN="$NODE_RUNTIME_DIR/bin/node"
NPM_BIN="$NODE_RUNTIME_DIR/bin/npm"

MIN_NODE_VERSION="${MIN_NODE_VERSION:-20.19.0}"
BRANCH="${BRANCH:-main}"
API_PORT="${API_PORT:-3100}"
API_PORT_SET=0
PUBLIC_HOST="${PUBLIC_HOST:-}"
SKIP_GIT="${SKIP_GIT:-0}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
SKIP_MIGRATE="${SKIP_MIGRATE:-0}"
NO_DOCKER="${NO_DOCKER:-0}"
ENABLE_SSL="${ENABLE_SSL:-0}"
YES="${YES:-0}"

SUDO=""
PKG_MANAGER=""

# ── 使用说明 ───────────────────────────────────────────────────────────────
usage() {
  cat <<'EOF'
MindWall 更新脚本（nginx + systemd）

用法:
  sudo bash update.sh [选项]

选项:
  --branch <name>       Git 分支（默认 main）
  --api-port <port>     API 端口（默认读取上次保存的值，否则 3100）
  --public-host <host>  对外域名或公网 IP
  --skip-git            跳过 Git 拉取
  --skip-install        跳过 npm 依赖安装
  --skip-migrate        跳过 Prisma migrate deploy
  --no-docker           跳过 Docker 启动
  --ssl                 重新配置 SSL（certbot）
  --yes                 非交互模式
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      [[ $# -ge 2 ]] || { echo "错误: --branch 缺少参数值"; exit 1; }
      BRANCH="$2"; shift 2 ;;
    --api-port)
      [[ $# -ge 2 ]] || { echo "错误: --api-port 缺少参数值"; exit 1; }
      API_PORT="$2"; API_PORT_SET=1; shift 2 ;;
    --web-port) [[ $# -ge 2 ]] && shift 2 || shift ;;  # 兼容旧参数，静默忽略
    --public-host)
      [[ $# -ge 2 ]] || { echo "错误: --public-host 缺少参数值"; exit 1; }
      PUBLIC_HOST="$2"; shift 2 ;;
    --skip-git)     SKIP_GIT="1";     shift ;;
    --skip-install) SKIP_INSTALL="1"; shift ;;
    --skip-migrate) SKIP_MIGRATE="1"; shift ;;
    --no-docker)    NO_DOCKER="1";    shift ;;
    --ssl)          ENABLE_SSL="1";   shift ;;
    --yes)          YES="1";          shift ;;
    -h|--help|help) usage; exit 0 ;;
    *)
      echo "错误: 未识别参数 $1"; usage; exit 1 ;;
  esac
done

# ── 工具函数 ───────────────────────────────────────────────────────────────
have_command() { command -v "$1" >/dev/null 2>&1; }

as_root() {
  if [[ -n "$SUDO" ]]; then "$SUDO" "$@"; else "$@"; fi
}

die()  { echo "错误: $*" >&2; exit 1; }
warn() { echo "警告: $*" >&2; }

validate_port() {
  local v="$1"
  [[ "$v" =~ ^[0-9]+$ ]] || return 1
  (( v >= 1 && v <= 65535 ))
}

project_version() {
  [[ -f "$VERSION_FILE" ]] && tr -d '[:space:]' < "$VERSION_FILE" && return
  echo "未知"
}

require_root_capability() {
  if [[ "$(id -u)" -eq 0 ]]; then SUDO=""; return; fi
  have_command sudo && SUDO="sudo" && return
  die "请使用 root 执行，或先安装 sudo。"
}

detect_pkg_manager() {
  [[ -n "$PKG_MANAGER" ]] && return
  if   have_command apt-get; then PKG_MANAGER="apt"
  elif have_command dnf;     then PKG_MANAGER="dnf"
  elif have_command yum;     then PKG_MANAGER="yum"
  elif have_command zypper;  then PKG_MANAGER="zypper"
  elif have_command pacman;  then PKG_MANAGER="pacman"
  else PKG_MANAGER="unknown"
  fi
}

version_ge() {
  [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1)" == "$2" ]]
}

node_version_of() { "$1" -v 2>/dev/null | sed 's/^v//'; }

npm_cmd() { PATH="$NODE_RUNTIME_DIR/bin:$PATH" "$NPM_BIN" "$@"; }

# ── 读取已保存端口 ─────────────────────────────────────────────────────────
load_saved_ports() {
  [[ "$API_PORT_SET" == "1" ]] && return
  if [[ -f "$RUNTIME_PORTS_FILE" ]]; then
    local saved_api
    saved_api="$(grep -E '^API_PORT=' "$RUNTIME_PORTS_FILE" | tail -n 1 | cut -d= -f2- || true)"
    [[ -n "$saved_api" ]] && API_PORT="$saved_api"
  fi
}

# ── 检查本地运行时是否可用 ─────────────────────────────────────────────────
ensure_local_runtime_ready() {
  if [[ ! -x "$NODE_BIN" || ! -x "$NPM_BIN" ]]; then
    return 1
  fi
  local current; current="$(node_version_of "$NODE_BIN" || true)"
  [[ -n "$current" ]] && version_ge "$current" "$MIN_NODE_VERSION"
}

# ── IP/Host 解析 ───────────────────────────────────────────────────────────
first_host_ip()  { hostname -I 2>/dev/null | awk '{print $1}'; }
is_ipv4()        { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; }
is_private_ipv4() {
  [[ "$1" =~ ^10\. ]]                              && return 0
  [[ "$1" =~ ^192\.168\. ]]                        && return 0
  [[ "$1" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]]   && return 0
  return 1
}

resolve_public_host() {
  [[ -n "$PUBLIC_HOST" ]] && echo "$PUBLIC_HOST" && return
  local detected=""
  if have_command curl; then
    detected="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || true)"
    is_ipv4 "$detected" && echo "$detected" && return
  fi
  detected="$(first_host_ip)"
  [[ -n "$detected" ]] && echo "$detected" && return
  echo "localhost"
}

set_or_append_env() {
  local file="$1" key="$2" value="$3"
  if grep -Eq "^${key}=" "$file"; then
    sed -i "s#^${key}=.*#${key}=\"${value}\"#g" "$file"
  else
    printf '%s="%s"\n' "$key" "$value" >> "$file"
  fi
}

# ── 更新代码 ───────────────────────────────────────────────────────────────
update_git_source() {
  echo "[1/7] 更新代码"
  if [[ "$SKIP_GIT" == "1" ]]; then echo "  已跳过 Git 拉取。"; return; fi
  have_command git || { warn "未检测到 git，已跳过 Git 拉取。"; return; }
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { warn "当前目录不是 Git 仓库，已跳过。"; return; }
  git remote get-url origin >/dev/null 2>&1 || { warn "未配置 origin 远程仓库，已跳过。"; return; }

  local dirty; dirty="$(git status --porcelain || true)"
  if [[ -n "$dirty" ]]; then
    warn "检测到本地改动，保留改动并跳过 Git 拉取。"; return
  fi

  git fetch origin "$BRANCH" || return
  local cur; cur="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ "$cur" != "$BRANCH" ]]; then
    git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH" || return
  fi
  git pull --ff-only origin "$BRANCH" || true
}

# ── Docker 辅助 ────────────────────────────────────────────────────────────
docker_engine_ready()    { have_command docker && as_root docker version >/dev/null 2>&1; }
docker_compose_available() {
  (have_command docker && as_root docker compose version >/dev/null 2>&1) || have_command docker-compose
}

docker_compose_run() {
  if have_command docker && as_root docker compose version >/dev/null 2>&1; then
    as_root docker compose -f "$COMPOSE_FILE" "$@"; return
  fi
  have_command docker-compose && { as_root docker-compose -f "$COMPOSE_FILE" "$@"; return; }
  die "Docker Compose 不可用。"
}

wait_for_container() {
  local name="$1" timeout="${2:-120}" waited=0
  while [[ "$waited" -lt "$timeout" ]]; do
    local state
    state="$(as_root docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || true)"
    if [[ "$state" == "healthy" || "$state" == "running" ]]; then return; fi
    sleep 2; waited=$((waited + 2))
  done
  die "容器 $name 在 ${timeout}s 内未就绪。"
}

start_infra() {
  if [[ "$NO_DOCKER" == "1" ]]; then echo "[2/7] 跳过 Docker 启动"; return; fi
  echo "[2/7] 确认 PostgreSQL + Redis 运行中"
  docker_compose_run up -d || die "Docker 基础设施启动失败。"
  wait_for_container "mindwall-postgres" 60
  wait_for_container "mindwall-redis"    30
}

# ── 写入环境配置 ───────────────────────────────────────────────────────────
write_app_env_ports() {
  echo "[3/7] 更新应用环境配置"
  local host; host="$(resolve_public_host)"
  [[ -z "$host" ]] && host="localhost"

  local schema="http"; local ws_schema="ws"
  if [[ "$ENABLE_SSL" == "1" ]]; then
    schema="https"; ws_schema="wss"
  fi

  local api_env="$API_DIR/.env"
  set_or_append_env "$api_env" "PORT"        "$API_PORT"
  set_or_append_env "$api_env" "WEB_ORIGIN"  "${schema}://${host}"
  set_or_append_env "$api_env" "APP_VERSION" "$(project_version)"
  [[ -n "$PUBLIC_HOST" ]] && set_or_append_env "$api_env" "PUBLIC_HOST" "$PUBLIC_HOST"

  cat > "$WEB_DIR/.env.production.local" <<EOF
VITE_API_BASE_URL=${schema}://${host}/api
VITE_WS_BASE_URL=${ws_schema}://${host}
EOF

  mkdir -p "$RUNTIME_DIR"
  printf 'API_PORT=%s\n' "$API_PORT" > "$RUNTIME_PORTS_FILE"
}

# ── 安装依赖、Prisma 迁移、构建 ────────────────────────────────────────────
npm_install_with_fallback() {
  local dir="$1"; cd "$dir"
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
    cd "$dir" && PATH="$NODE_RUNTIME_DIR/bin:$PATH" "$NODE_BIN" -e \
    "try{const p=require('./node_modules/rollup/package.json');process.stdout.write((p.optionalDependencies&&p.optionalDependencies['@rollup/rollup-linux-x64-gnu'])||'')}catch(e){process.stdout.write('')}"
  )"
  if [[ -n "$rollup_opt_ver" ]]; then
    echo "检测到 Rollup 可选依赖缺失，正在补装 @rollup/rollup-linux-x64-gnu@$rollup_opt_ver"
    (cd "$dir" && npm_cmd install --no-save "@rollup/rollup-linux-x64-gnu@$rollup_opt_ver")
  else
    (cd "$dir" && npm_cmd install --no-save @rollup/rollup-linux-x64-gnu)
  fi
  return 0
}

install_deps_and_build() {
  echo "[4/7] 安装依赖"
  if [[ "$SKIP_INSTALL" != "1" ]]; then
    npm_install_with_fallback "$API_DIR"
    npm_install_with_fallback "$WEB_DIR"
    ensure_rollup_optional_dependency "$WEB_DIR"
  else
    echo "  已跳过依赖安装。"
  fi

  if [[ "$SKIP_MIGRATE" != "1" ]]; then
    echo "[5/7] 执行 Prisma 迁移"
    cd "$API_DIR"
    npm_cmd run prisma:generate
    npm_cmd run prisma:deploy
  else
    echo "[5/7] 已跳过 Prisma 迁移。"
  fi

  echo "[6/7] 构建 API 和 Web"
  cd "$API_DIR"; npm_cmd run build
  cd "$WEB_DIR"
  if ! npm_cmd run build; then
    warn "Web 构建失败，尝试修复 Rollup 依赖后重试。"
    ensure_rollup_optional_dependency "$WEB_DIR" || true
    if ! npm_cmd run build; then
      rm -rf "$WEB_DIR/node_modules"
      npm_install_with_fallback "$WEB_DIR"
      ensure_rollup_optional_dependency "$WEB_DIR"
      npm_cmd run build
    fi
  fi
}

# ── 重启 API 服务 ──────────────────────────────────────────────────────────
restart_api_service() {
  echo "[7/7] 重启 API 服务"
  if ! have_command systemctl; then
    warn "systemctl 不可用，请手动重启 API 进程。"; return
  fi

  if systemctl is-enabled --quiet mindwall-api 2>/dev/null; then
    as_root systemctl restart mindwall-api
    local waited=0
    while [[ "$waited" -lt 20 ]]; do
      if as_root systemctl is-active --quiet mindwall-api; then
        echo "  mindwall-api 重启成功。"; break
      fi
      sleep 1; waited=$((waited + 1))
    done
    if ! as_root systemctl is-active --quiet mindwall-api; then
      warn "mindwall-api 服务可能未正常启动，请检查: journalctl -u mindwall-api -n 50"
    fi
  else
    warn "mindwall-api 服务未注册，请先运行 deploy.sh 完整部署。"
  fi

  # 重载 nginx（静态文件已更新）
  if have_command nginx && as_root systemctl is-active --quiet nginx 2>/dev/null; then
    as_root systemctl reload nginx && echo "  nginx 已重载（静态文件更新生效）。"
  fi
}

# ── SSL（可选，重新配置时使用） ────────────────────────────────────────────
setup_ssl() {
  [[ "$ENABLE_SSL" != "1" ]] && return
  if ! have_command certbot; then
    warn "certbot 未安装，跳过 SSL 配置。"; return
  fi
  if [[ -z "$PUBLIC_HOST" ]]; then
    warn "未设置 --public-host，无法申请 SSL 证书。"; return
  fi
  if [[ "$PUBLIC_HOST" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    warn "PUBLIC_HOST 为 IP 地址，Let's Encrypt 不支持 IP 证书，跳过。"; return
  fi
  certbot --nginx -d "$PUBLIC_HOST" \
    --non-interactive --agree-tos \
    --email "admin@${PUBLIC_HOST}" \
    --redirect 2>&1 || warn "SSL 证书申请失败，服务以 HTTP 继续运行。"
}

# ── 更新完成汇总 ───────────────────────────────────────────────────────────
print_summary() {
  local host; host="$(resolve_public_host)"
  [[ -z "$host" ]] && host="<服务器IP>"
  local schema="http"; [[ "$ENABLE_SSL" == "1" ]] && schema="https"

  echo
  echo "═══════════════════════════════════════════════════"
  echo "  MindWall v$(project_version) 更新完成"
  echo "═══════════════════════════════════════════════════"
  echo "  访问地址  : ${schema}://${host}"
  echo "  API 日志  : journalctl -u mindwall-api -f"
  echo "  服务管理  : systemctl status mindwall-api"
  echo "═══════════════════════════════════════════════════"
  echo
}

# ── 主流程 ────────────────────────────────────────────────────────────────
main() {
  require_root_capability
  detect_pkg_manager
  cd "$ROOT_DIR"

  load_saved_ports
  validate_port "$API_PORT" || die "API 端口不合法: $API_PORT"

  echo "MindWall 更新部署 v$(project_version)"
  echo "目录: $ROOT_DIR"

  # 若运行时缺失，回退到完整部署流程
  if ! ensure_local_runtime_ready; then
    warn "本地 Node.js 运行时缺失或版本过低，切换到完整部署流程..."
    local deploy_args=("--branch" "$BRANCH" "--api-port" "$API_PORT" "--yes")
    [[ "$SKIP_GIT"   == "1" ]] && deploy_args+=("--skip-git")
    [[ "$NO_DOCKER"  == "1" ]] && deploy_args+=("--no-docker")
    [[ "$ENABLE_SSL" == "1" ]] && deploy_args+=("--ssl")
    [[ -n "$PUBLIC_HOST" ]]   && deploy_args+=("--public-host" "$PUBLIC_HOST")
    as_root bash "$ROOT_DIR/deploy.sh" "${deploy_args[@]}"
    exit 0
  fi

  if [[ "$NO_DOCKER" != "1" ]]; then
    docker_engine_ready    || die "Docker 不可用，请先运行 deploy.sh。"
    docker_compose_available || die "Docker Compose 不可用。"
  fi

  update_git_source
  start_infra
  write_app_env_ports
  install_deps_and_build
  restart_api_service
  setup_ssl
  print_summary
}

main "$@"
