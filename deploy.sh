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
NODE_BIN="$NODE_RUNTIME_DIR/bin/node"
NPM_BIN="$NODE_RUNTIME_DIR/bin/npm"
NPM_CLI_JS="$NODE_RUNTIME_DIR/lib/node_modules/npm/bin/npm-cli.js"
RUNTIME_PORTS_FILE="$RUNTIME_DIR/ports.env"

API_ENV_FILE="$API_DIR/.env"
WEB_ENV_PROD_FILE="$WEB_DIR/.env.production.local"
SYSTEMD_API_SERVICE_FILE="/etc/systemd/system/mindwall-api.service"
NGINX_CONF_FILE="/etc/nginx/conf.d/mindwall.conf"

MIN_NODE_VERSION="${MIN_NODE_VERSION:-22.14.0}"
LOCAL_NODE_VERSION="${LOCAL_NODE_VERSION:-22.14.0}"

CURRENT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ -z "$CURRENT_BRANCH" || "$CURRENT_BRANCH" == "HEAD" ]]; then
  CURRENT_BRANCH="main"
fi

BRANCH="${BRANCH:-$CURRENT_BRANCH}"
API_PORT="${API_PORT:-3100}"
WEB_PORT="${WEB_PORT:-3001}"
API_PORT_SET=0
WEB_PORT_SET=0
SAVED_API_PORT=""
SAVED_WEB_PORT=""
PUBLIC_HOST="${PUBLIC_HOST:-}"
SKIP_GIT="${SKIP_GIT:-0}"
NO_DOCKER="${NO_DOCKER:-0}"
ENABLE_SSL="${ENABLE_SSL:-0}"
SKIP_SYSTEM_INSTALL="${SKIP_SYSTEM_INSTALL:-0}"
YES="${YES:-0}"
SSL_ACTIVATED=0

SUDO=""
PKG_MANAGER=""
OS_ID=""
OS_LIKE=""

usage() {
  cat <<'EOF'
MindWall 部署脚本（Nginx + systemd）

用法:
  sudo bash deploy.sh [选项]

选项:
  --branch <name>           Git 分支（默认：当前分支）
  --api-port <port>         API 本地端口（默认：3100）
  --web-port <port>         Web 对外端口（默认：3001）
  --public-host <host>      公网域名或公网 IP（用于展示与 CORS）
  --skip-git                跳过 Git 拉取
  --no-docker               跳过 Docker（不启动 PostgreSQL/Redis）
  --ssl                     尝试使用 certbot 配置 HTTPS（需域名 + 80 端口）
  --skip-system-install     跳过系统依赖安装（适合更新场景）
  --yes                     非交互模式（本地改动默认保留）
  -h, --help                显示帮助
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      [[ $# -ge 2 ]] || { echo "错误: --branch 缺少参数"; exit 1; }
      BRANCH="$2"
      shift 2
      ;;
    --api-port)
      [[ $# -ge 2 ]] || { echo "错误: --api-port 缺少参数"; exit 1; }
      API_PORT="$2"
      API_PORT_SET=1
      shift 2
      ;;
    --web-port)
      [[ $# -ge 2 ]] || { echo "错误: --web-port 缺少参数"; exit 1; }
      WEB_PORT="$2"
      WEB_PORT_SET=1
      shift 2
      ;;
    --public-host)
      [[ $# -ge 2 ]] || { echo "错误: --public-host 缺少参数"; exit 1; }
      PUBLIC_HOST="$2"
      shift 2
      ;;
    --skip-git)
      SKIP_GIT="1"
      shift
      ;;
    --no-docker)
      NO_DOCKER="1"
      shift
      ;;
    --ssl)
      ENABLE_SSL="1"
      shift
      ;;
    --skip-system-install)
      SKIP_SYSTEM_INSTALL="1"
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

confirm_yes() {
  local prompt="$1"
  if [[ "$YES" == "1" ]]; then
    return 1
  fi
  read -r -p "$prompt" ans
  [[ "$ans" =~ ^[Yy]$ ]]
}

project_version() {
  if [[ -f "$VERSION_FILE" ]]; then
    tr -d '[:space:]' < "$VERSION_FILE"
  else
    echo "未知"
  fi
}

validate_port() {
  local value="$1"
  [[ "$value" =~ ^[0-9]+$ ]] || return 1
  (( value >= 1 && value <= 65535 ))
}

is_ipv4() {
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

is_private_ipv4() {
  local ip="$1"
  if [[ ! "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    return 1
  fi
  IFS='.' read -r a b c d <<<"$ip"
  if (( a == 10 )); then
    return 0
  fi
  if (( a == 172 && b >= 16 && b <= 31 )); then
    return 0
  fi
  if (( a == 192 && b == 168 )); then
    return 0
  fi
  return 1
}

port_in_use() {
  local port="$1"
  if have_command ss; then
    ss -lnt "( sport = :$port )" 2>/dev/null | grep -q ":$port"
    return $?
  fi
  if have_command lsof; then
    lsof -iTCP:"$port" -sTCP:LISTEN -Pn >/dev/null 2>&1
    return $?
  fi
  if have_command netstat; then
    netstat -lnt 2>/dev/null | grep -q "[\.:]$port "
    return $?
  fi
  return 1
}

next_free_port() {
  local port="$1"
  while port_in_use "$port"; do
    port=$((port + 1))
    if (( port > 65535 )); then
      die "没有可用端口。"
    fi
  done
  echo "$port"
}

version_ge() {
  [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1)" == "$2" ]]
}

node_version_of() {
  "$1" -v 2>/dev/null | sed -E 's/^v([0-9]+(\.[0-9]+){0,2}).*/\1/'
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

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    OS_ID="$(echo "${ID:-}" | tr '[:upper:]' '[:lower:]')"
    OS_LIKE="$(echo "${ID_LIKE:-}" | tr '[:upper:]' '[:lower:]')"
  fi
}

detect_pkg_manager() {
  if have_command apt-get; then
    PKG_MANAGER="apt"
  elif have_command dnf; then
    PKG_MANAGER="dnf"
  elif have_command yum; then
    PKG_MANAGER="yum"
  elif have_command zypper; then
    PKG_MANAGER="zypper"
  elif have_command pacman; then
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
    zypper) as_root zypper --gpg-auto-import-keys refresh ;;
    pacman) as_root pacman -Sy --noconfirm ;;
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
    *) die "当前系统缺少受支持的包管理器，请手动安装：$*" ;;
  esac
}

pkg_install_optional() {
  pkg_install "$@" || true
}

docker_engine_ready() {
  have_command docker && as_root docker info >/dev/null 2>&1
}

docker_compose_available() {
  if as_root docker compose version >/dev/null 2>&1; then
    return 0
  fi
  have_command docker-compose
}

docker_compose() {
  if as_root docker compose version >/dev/null 2>&1; then
    as_root docker compose -f "$COMPOSE_FILE" "$@"
    return
  fi
  if have_command docker-compose; then
    as_root docker-compose -f "$COMPOSE_FILE" "$@"
    return
  fi
  die "Docker Compose 不可用。"
}

load_saved_ports() {
  if [[ ! -f "$RUNTIME_PORTS_FILE" ]]; then
    return
  fi
  SAVED_API_PORT="$(grep -E '^API_PORT=' "$RUNTIME_PORTS_FILE" | tail -n 1 | cut -d= -f2- || true)"
  SAVED_WEB_PORT="$(grep -E '^WEB_PORT=' "$RUNTIME_PORTS_FILE" | tail -n 1 | cut -d= -f2- || true)"

  if [[ "$API_PORT_SET" != "1" ]]; then
    if [[ -n "$SAVED_API_PORT" ]]; then
      API_PORT="$SAVED_API_PORT"
    fi
  fi
  if [[ "$WEB_PORT_SET" != "1" ]]; then
    if [[ -n "$SAVED_WEB_PORT" ]]; then
      WEB_PORT="$SAVED_WEB_PORT"
    fi
  fi
}

save_runtime_ports() {
  mkdir -p "$RUNTIME_DIR"
  cat > "$RUNTIME_PORTS_FILE" <<EOF
API_PORT=$API_PORT
WEB_PORT=$WEB_PORT
EOF
}

port_pids() {
  local port="$1"
  if have_command ss; then
    ss -lntp "( sport = :$port )" 2>/dev/null \
      | grep -oE 'pid=[0-9]+' \
      | cut -d= -f2 \
      | sort -u
    return
  fi
  if have_command lsof; then
    lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u
  fi
}

pid_cmdline() {
  local pid="$1"
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true
}

pid_comm() {
  local pid="$1"
  cat "/proc/$pid/comm" 2>/dev/null || true
}

is_pid_mindwall_related() {
  local pid="$1"
  local cmdline comm
  cmdline="$(pid_cmdline "$pid")"
  comm="$(pid_comm "$pid")"

  if [[ "$cmdline" == *"$ROOT_DIR"* || "$cmdline" == *"$API_DIR"* || "$cmdline" == *"$WEB_DIR"* ]]; then
    return 0
  fi
  if [[ "$cmdline" == *"mindwall-api"* || "$cmdline" == *"mindwall-web"* || "$cmdline" == *".mw-runtime"* ]]; then
    return 0
  fi
  if [[ "$comm" == "node" && "$cmdline" == *"vite preview"* ]]; then
    return 0
  fi
  return 1
}

is_pid_nginx() {
  local pid="$1"
  local cmdline comm
  cmdline="$(pid_cmdline "$pid")"
  comm="$(pid_comm "$pid")"
  [[ "$comm" == "nginx" || "$cmdline" == *"nginx:"* ]]
}

port_owner_summary() {
  local port="$1"
  if have_command ss; then
    local summary
    summary="$(
      ss -lntp "( sport = :$port )" 2>/dev/null \
        | tail -n +2 \
        | awk '{$1=$1;print}' \
        | paste -sd ';' -
    )"
    if [[ -n "$summary" ]]; then
      echo "$summary"
      return
    fi
  fi
  if have_command lsof; then
    local summary
    summary="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{printf "%s(pid=%s) ",$1,$2}')"
    if [[ -n "$summary" ]]; then
      echo "$summary"
      return
    fi
  fi
  echo "未知进程"
}

kill_mindwall_listeners_on_port() {
  local port="$1"
  local label="$2"
  local pid
  local killed=0

  while read -r pid; do
    [[ -z "$pid" ]] && continue
    if is_pid_mindwall_related "$pid"; then
      warn "$label 端口 $port 被旧 MindWall 进程占用，终止 PID $pid"
      as_root kill "$pid" 2>/dev/null || true
      killed=1
    fi
  done < <(port_pids "$port")

  if (( killed == 1 )); then
    sleep 1
    while read -r pid; do
      [[ -z "$pid" ]] && continue
      if is_pid_mindwall_related "$pid"; then
        as_root kill -9 "$pid" 2>/dev/null || true
      fi
    done < <(port_pids "$port")
    sleep 1
  fi
}

saved_port_occupant_allowed() {
  local port="$1"
  local kind="$2"
  local pid
  while read -r pid; do
    [[ -z "$pid" ]] && continue
    if is_pid_mindwall_related "$pid"; then
      continue
    fi
    if [[ "$kind" == "web" ]] && is_pid_nginx "$pid"; then
      continue
    fi
    return 1
  done < <(port_pids "$port")
  return 0
}

check_ports() {
  validate_port "$API_PORT" || die "API 端口不合法: $API_PORT"
  validate_port "$WEB_PORT" || die "Web 端口不合法: $WEB_PORT"

  if port_in_use "$API_PORT"; then
    kill_mindwall_listeners_on_port "$API_PORT" "API"
  fi
  if port_in_use "$WEB_PORT"; then
    kill_mindwall_listeners_on_port "$WEB_PORT" "Web"
  fi

  if [[ "$API_PORT" == "$WEB_PORT" ]]; then
    if [[ "$WEB_PORT_SET" == "1" && "$API_PORT_SET" == "1" ]]; then
      die "API 端口和 Web 端口不能相同。"
    fi
    WEB_PORT="$(next_free_port "$WEB_PORT")"
    warn "Web 端口与 API 端口冲突，自动调整为 $WEB_PORT"
  fi

  if port_in_use "$API_PORT"; then
    if [[ -n "$SAVED_API_PORT" && "$API_PORT" == "$SAVED_API_PORT" ]] && saved_port_occupant_allowed "$API_PORT" "api"; then
      :
    elif [[ "$API_PORT_SET" == "1" ]]; then
      die "指定的 API 端口 $API_PORT 已被占用（$(port_owner_summary "$API_PORT")）。"
    else
      local old_api="$API_PORT"
      API_PORT="$(next_free_port "$API_PORT")"
      warn "API 端口 $old_api 已占用（$(port_owner_summary "$old_api")），自动调整为 $API_PORT"
    fi
  fi

  if port_in_use "$WEB_PORT"; then
    if [[ -n "$SAVED_WEB_PORT" && "$WEB_PORT" == "$SAVED_WEB_PORT" ]] && saved_port_occupant_allowed "$WEB_PORT" "web"; then
      :
    elif [[ "$WEB_PORT_SET" == "1" ]]; then
      die "指定的 Web 端口 $WEB_PORT 已被占用（$(port_owner_summary "$WEB_PORT")）。"
    else
      local old_web="$WEB_PORT"
      WEB_PORT="$(next_free_port "$WEB_PORT")"
      warn "Web 端口 $old_web 已占用（$(port_owner_summary "$old_web")），自动调整为 $WEB_PORT"
    fi
  fi
}

resolve_public_host() {
  if [[ -n "$PUBLIC_HOST" ]]; then
    echo "$PUBLIC_HOST"
    return
  fi

  local host
  host="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  if [[ -n "$host" ]]; then
    echo "$host"
    return
  fi

  echo "127.0.0.1"
}

build_web_origin() {
  local host="$1"
  local scheme="http"
  if [[ "$ENABLE_SSL" == "1" ]]; then
    scheme="https"
  fi

  if [[ "$scheme" == "http" && "$WEB_PORT" == "80" ]]; then
    echo "http://$host"
    return
  fi
  if [[ "$scheme" == "https" && "$WEB_PORT" == "443" ]]; then
    echo "https://$host"
    return
  fi
  echo "${scheme}://${host}:$WEB_PORT"
}

escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\/&]/\\&/g' -e 's/"/\\"/g'
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped
  escaped="$(escape_sed_replacement "$value")"
  if grep -qE "^${key}=" "$file"; then
    sed -i "s/^${key}=.*/${key}=\"${escaped}\"/" "$file"
  else
    printf '%s="%s"\n' "$key" "$value" >> "$file"
  fi
}

install_base_tools() {
  if [[ "$SKIP_SYSTEM_INSTALL" == "1" ]]; then
    echo "[1/12] 跳过系统依赖安装（--skip-system-install）"
    return
  fi

  echo "[1/12] 安装基础工具"
  pkg_update_cache
  case "$PKG_MANAGER" in
    apt)
      pkg_install ca-certificates curl git tar xz-utils lsof nginx jq
      ;;
    dnf|yum)
      pkg_install ca-certificates curl git tar xz lsof nginx jq
      ;;
    zypper)
      pkg_install ca-certificates curl git tar xz lsof nginx jq
      ;;
    pacman)
      pkg_install ca-certificates curl git tar xz lsof nginx jq
      ;;
    *)
      die "不支持的系统包管理器，无法自动安装基础工具。"
      ;;
  esac
}

install_docker_for_rpm_family() {
  local installer="$1"
  if [[ "$installer" == "dnf" ]]; then
    as_root dnf install -y dnf-plugins-core || true
    if have_command dnf && dnf config-manager --help >/dev/null 2>&1; then
      as_root dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo || true
    fi
  else
    as_root yum install -y yum-utils || true
    if have_command yum-config-manager; then
      as_root yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo || true
    fi
  fi

  if ! pkg_install_optional docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; then
    :
  fi
  if ! have_command docker; then
    pkg_install_optional docker docker-compose-plugin
  fi
  if ! have_command docker; then
    pkg_install_optional moby-engine
  fi
}

ensure_docker_ready() {
  if [[ "$NO_DOCKER" == "1" ]]; then
    echo "[2/12] 跳过 Docker 安装与启动（--no-docker）"
    return
  fi

  if docker_engine_ready && docker_compose_available; then
    echo "[2/12] Docker 已可用"
    return
  fi

  if [[ "$SKIP_SYSTEM_INSTALL" == "1" ]]; then
    die "Docker 不可用，且已指定 --skip-system-install。请先运行不带该参数的 deploy.sh。"
  fi

  echo "[2/12] 安装 Docker"
  case "$PKG_MANAGER" in
    apt)
      pkg_install_optional docker.io docker-compose-plugin
      if ! docker_compose_available; then
        pkg_install_optional docker-compose
      fi
      ;;
    dnf)
      install_docker_for_rpm_family "dnf"
      ;;
    yum)
      install_docker_for_rpm_family "yum"
      ;;
    zypper)
      pkg_install_optional docker docker-compose
      ;;
    pacman)
      pkg_install_optional docker docker-compose
      ;;
    *)
      die "不支持的系统，无法自动安装 Docker。"
      ;;
  esac

  if have_command systemctl; then
    as_root systemctl daemon-reload || true
    as_root systemctl enable docker || true
    as_root systemctl restart docker || as_root systemctl start docker || true
  fi

  if ! docker_engine_ready; then
    die "Docker 已安装但引擎不可用，请检查: systemctl status docker"
  fi
  if ! docker_compose_available; then
    die "Docker Compose 不可用，请检查 Docker 安装。"
  fi
}

download_file_with_fallback() {
  local output="$1"
  shift
  local url
  for url in "$@"; do
    if curl -fL --connect-timeout 10 --retry 2 --retry-delay 2 "$url" -o "$output"; then
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
    *)
      die "不支持的 CPU 架构: $arch"
      ;;
  esac

  local tar_name="node-v${LOCAL_NODE_VERSION}-linux-${node_arch}.tar.xz"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  local tar_path="$tmp_dir/$tar_name"
  local extract_dir="$tmp_dir/node-v${LOCAL_NODE_VERSION}-linux-${node_arch}"

  mkdir -p "$RUNTIME_DIR"
  echo "  下载 Node.js v$LOCAL_NODE_VERSION ..."
  if ! download_file_with_fallback "$tar_path" \
    "https://nodejs.org/dist/v${LOCAL_NODE_VERSION}/${tar_name}" \
    "https://npmmirror.com/mirrors/node/v${LOCAL_NODE_VERSION}/${tar_name}"; then
    rm -rf "$tmp_dir"
    die "下载 Node.js 失败，请检查服务器网络。"
  fi

  echo "  解压 Node.js ..."
  tar -xJf "$tar_path" -C "$tmp_dir"

  rm -rf "$NODE_RUNTIME_DIR"
  mv "$extract_dir" "$NODE_RUNTIME_DIR"
  chmod +x "$NODE_RUNTIME_DIR/bin/node" "$NODE_RUNTIME_DIR/bin/npm" "$NODE_RUNTIME_DIR/bin/npx"
  rm -rf "$tmp_dir"
}

ensure_local_node_runtime() {
  echo "[3/12] 准备本地 Node.js 运行时"

  local current=""
  if [[ -x "$NODE_BIN" ]]; then
    current="$(node_version_of "$NODE_BIN" || true)"
  fi

  if [[ -n "$current" ]] && version_ge "$current" "$MIN_NODE_VERSION"; then
    echo "  已就绪: v$current"
    export PATH="$NODE_RUNTIME_DIR/bin:$PATH"
    return
  fi

  install_local_node_runtime
  local installed
  installed="$(node_version_of "$NODE_BIN" || true)"
  if [[ -z "$installed" ]] || ! version_ge "$installed" "$MIN_NODE_VERSION"; then
    die "本地 Node.js 安装失败（要求 >= $MIN_NODE_VERSION）。"
  fi
  echo "  已安装: v$installed"
  export PATH="$NODE_RUNTIME_DIR/bin:$PATH"
}

npm_cmd() {
  if [[ -x "$NODE_BIN" && -f "$NPM_CLI_JS" ]]; then
    "$NODE_BIN" "$NPM_CLI_JS" "$@"
    return
  fi
  if [[ -x "$NPM_BIN" ]]; then
    "$NPM_BIN" "$@"
    return
  fi
  die "本地 npm 运行时不可用，请先执行 Node 运行时安装步骤。"
}

npm_install_with_fallback() {
  local dir="$1"
  cd "$dir"
  if [[ -f "$dir/package-lock.json" ]]; then
    if ! npm_cmd ci --no-fund --no-audit; then
      npm_cmd install --no-fund --no-audit
    fi
  else
    npm_cmd install --no-fund --no-audit
  fi
}

detect_rollup_optional_package() {
  local arch
  local libc="gnu"
  arch="$(uname -m)"
  if have_command ldd && ldd --version 2>&1 | grep -qi musl; then
    libc="musl"
  fi

  case "$arch" in
    x86_64|amd64)
      if [[ "$libc" == "musl" ]]; then
        echo "@rollup/rollup-linux-x64-musl"
      else
        echo "@rollup/rollup-linux-x64-gnu"
      fi
      ;;
    aarch64|arm64)
      if [[ "$libc" == "musl" ]]; then
        echo "@rollup/rollup-linux-arm64-musl"
      else
        echo "@rollup/rollup-linux-arm64-gnu"
      fi
      ;;
    *)
      echo ""
      ;;
  esac
}

ensure_rollup_optional_dependency() {
  local package_name
  package_name="$(detect_rollup_optional_package)"
  [[ -z "$package_name" ]] && return 0

  cd "$WEB_DIR"
  if "$NODE_BIN" -e "require('${package_name}')" >/dev/null 2>&1; then
    return 0
  fi

  warn "检测到 Rollup 可选依赖缺失，尝试安装 ${package_name} ..."
  npm_cmd install --no-save --no-fund --no-audit "$package_name" || true
}

register_mw_command() {
  echo "[4/12] 注册 mw 命令"
  chmod +x "$ROOT_DIR/deploy.sh" "$ROOT_DIR/update.sh" "$ROOT_DIR/mw" || true
  as_root mkdir -p /usr/local/bin
  as_root ln -sfn "$ROOT_DIR/mw" /usr/local/bin/mw || warn "无法写入 /usr/local/bin/mw，可手动执行: bash $ROOT_DIR/mw"
}

update_git_source() {
  if [[ "$SKIP_GIT" == "1" ]]; then
    echo "[5/12] 跳过 Git 更新（--skip-git）"
    return
  fi

  if ! have_command git; then
    warn "git 不可用，跳过代码更新。"
    return
  fi
  if [[ ! -d "$ROOT_DIR/.git" ]]; then
    warn "当前目录不是 Git 仓库，跳过代码更新。"
    return
  fi

  echo "[5/12] 更新代码"
  cd "$ROOT_DIR"
  git fetch origin "$BRANCH" || warn "git fetch 失败，后续使用本地代码继续。"

  local dirty
  dirty="$(git status --porcelain || true)"
  if [[ -n "$dirty" ]]; then
    echo "检测到本地改动："
    echo "$dirty" | head -n 20
    if confirm_yes "是否丢弃本地改动并继续更新？[y/N]: "; then
      git reset --hard HEAD
      git clean -fd
    else
      warn "已保留本地改动，跳过 Git 拉取。"
      return
    fi
  fi

  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git checkout "$BRANCH"
  elif git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    git checkout -b "$BRANCH" "origin/$BRANCH"
  else
    warn "未找到分支 $BRANCH，继续使用当前分支。"
  fi

  if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    git pull --ff-only origin "$BRANCH"
  fi
}

write_web_build_env() {
  echo "[6/12] 写入前端生产环境变量"
  cat > "$WEB_ENV_PROD_FILE" <<'EOF'
VITE_API_BASE_URL=/api
VITE_WS_BASE_URL=
EOF
}

write_api_env() {
  echo "[7/12] 写入 API 环境变量"
  mkdir -p "$API_DIR"
  if [[ ! -f "$API_ENV_FILE" ]]; then
    if [[ -f "$API_DIR/.env.example" ]]; then
      cp "$API_DIR/.env.example" "$API_ENV_FILE"
    else
      touch "$API_ENV_FILE"
    fi
  fi

  local host
  host="$(resolve_public_host)"
  local web_origin
  web_origin="$(build_web_origin "$host")"

  set_env_value "$API_ENV_FILE" "PORT" "$API_PORT"
  set_env_value "$API_ENV_FILE" "WEB_ORIGIN" "$web_origin"
  set_env_value "$API_ENV_FILE" "APP_VERSION" "$(project_version)"

  if ! grep -qE '^DATABASE_URL=' "$API_ENV_FILE"; then
    set_env_value "$API_ENV_FILE" "DATABASE_URL" "postgresql://mindwall:mindwall@127.0.0.1:5432/mindwall?schema=public"
  else
    # 强制将 localhost 修正为 127.0.0.1，防止 Node 17+ 优先解析 IPv6 ::1 导致无法连接 Docker 映射的 IPv4 端口
    sed -i 's/@localhost:5432/@127.0.0.1:5432/g' "$API_ENV_FILE" || true
  fi
}

start_infra() {
  if [[ "$NO_DOCKER" == "1" ]]; then
    echo "[8/12] 跳过 Docker 启动（--no-docker）"
    return
  fi

  [[ -f "$COMPOSE_FILE" ]] || die "找不到 Docker Compose 文件: $COMPOSE_FILE"

  echo "[8/12] 启动 PostgreSQL + Redis"
  docker_compose up -d postgres redis

  echo "  等待 PostgreSQL 就绪..."
  local retries=60
  local ok=0
  while (( retries > 0 )); do
    if as_root docker exec mindwall-postgres pg_isready -U mindwall -d mindwall >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 2
    retries=$((retries - 1))
  done

  if (( ok == 0 )); then
    die "PostgreSQL 启动超时，请检查: docker logs mindwall-postgres"
  fi
}

install_deps_migrate_build() {
  echo "[9/12] 安装依赖、Prisma 迁移、构建"

  cd "$API_DIR"
  npm_install_with_fallback "$API_DIR"
  npm_cmd run prisma:generate
  npm_cmd run prisma:deploy

  cd "$WEB_DIR"
  npm_install_with_fallback "$WEB_DIR"
  ensure_rollup_optional_dependency

  cd "$API_DIR"
  npm_cmd run build
  cd "$WEB_DIR"
  if ! npm_cmd run build; then
    warn "Web 构建失败，尝试修复 Rollup 依赖后重试。"
    ensure_rollup_optional_dependency
    rm -rf "$WEB_DIR/node_modules"
    npm_install_with_fallback "$WEB_DIR"
    ensure_rollup_optional_dependency
    npm_cmd run build
  fi
}

setup_systemd_api() {
  echo "[10/12] 配置并启动 API systemd 服务"
  if ! have_command systemctl; then
    die "当前系统不支持 systemd，无法自动托管 API 进程。"
  fi

  local entry_file="$API_DIR/dist/src/main.js"
  if [[ ! -f "$entry_file" && -f "$API_DIR/dist/main.js" ]]; then
    entry_file="$API_DIR/dist/main.js"
  fi

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
EnvironmentFile=$API_ENV_FILE
ExecStart=$NODE_BIN $entry_file
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

  as_root mv /tmp/mindwall-api.service "$SYSTEMD_API_SERVICE_FILE"
  as_root systemctl daemon-reload
  as_root systemctl enable mindwall-api
  as_root systemctl restart mindwall-api

  sleep 2
  if ! as_root systemctl is-active --quiet mindwall-api; then
    echo "=========== API 服务启动日志 ==========="
    as_root journalctl -u mindwall-api -n 30 --no-pager || true
    echo "========================================"
    die "mindwall-api 启动失败，请检查上方的 journalctl 错误日志。"
  fi
}

write_nginx_config() {
  echo "[11/12] 配置并启动 Nginx"
  if ! have_command nginx; then
    die "未找到 nginx，请先安装 nginx。"
  fi
  local server_name="_"
  if [[ -n "$PUBLIC_HOST" ]]; then
    server_name="$PUBLIC_HOST"
  fi

  cat > /tmp/mindwall-nginx.conf <<EOF
server {
    listen $WEB_PORT;
    server_name $server_name;

    root $WEB_DIR/dist;
    index index.html;

    client_max_body_size 20m;

    location /api/ {
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_pass http://127.0.0.1:$API_PORT/;
    }

    location /ws/ {
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_pass http://127.0.0.1:$API_PORT/ws/;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

  as_root mkdir -p /etc/nginx/conf.d
  as_root mv /tmp/mindwall-nginx.conf "$NGINX_CONF_FILE"

  as_root nginx -t
  if have_command systemctl; then
    as_root systemctl enable nginx || true
    as_root systemctl restart nginx
  else
    as_root nginx -s reload || as_root nginx
  fi
}

setup_ssl() {
  if [[ "$ENABLE_SSL" != "1" ]]; then
    echo "[12/12] 跳过 SSL（未指定 --ssl）"
    return
  fi

  if [[ -z "$PUBLIC_HOST" ]]; then
    warn "未指定 --public-host，无法自动配置 SSL。"
    return
  fi
  if is_ipv4 "$PUBLIC_HOST"; then
    warn "PUBLIC_HOST 为 IP，Let's Encrypt 不支持 IP 证书。"
    return
  fi
  if [[ "$WEB_PORT" != "80" ]]; then
    warn "当前 Web 端口为 $WEB_PORT，certbot --nginx 通常需要 80 端口。已跳过 SSL。"
    return
  fi

  if ! have_command certbot; then
    if [[ "$SKIP_SYSTEM_INSTALL" == "1" ]]; then
      warn "certbot 未安装，且已跳过系统安装，无法自动配置 SSL。"
      return
    fi
    case "$PKG_MANAGER" in
      apt) pkg_install_optional certbot python3-certbot-nginx ;;
      dnf|yum) pkg_install_optional certbot python3-certbot-nginx ;;
      *) warn "当前系统暂不支持自动安装 certbot，请手动安装后执行。"; return ;;
    esac
  fi

  echo "[12/12] 申请并配置 SSL 证书"
  if certbot --nginx -d "$PUBLIC_HOST" \
    --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
    SSL_ACTIVATED=1
  else
    warn "SSL 自动配置失败，服务将继续以 HTTP 运行。"
  fi
}

print_summary() {
  local host
  host="$(resolve_public_host)"
  local schema="http"
  if [[ "$SSL_ACTIVATED" == "1" ]]; then
    schema="https"
  fi

  echo
  echo "部署完成: MindWall v$(project_version)"
  echo "API 端口: $API_PORT"
  echo "Web 端口: $WEB_PORT"
  echo "Web 地址: ${schema}://${host}:${WEB_PORT}"
  echo "本地 Node 路径: $NODE_RUNTIME_DIR"
  echo "系统服务: mindwall-api"
  echo "更新命令: sudo bash $ROOT_DIR/update.sh"
  if is_private_ipv4 "$host"; then
    echo "警告: 当前展示的是内网 IP（$host），公网访问请使用 --public-host 指定域名或公网 IP。"
  fi
  echo "提示: 若公网无法访问，请检查云安全组/防火墙是否放行 $WEB_PORT（以及 $API_PORT 仅本地使用无需放行）。"
  echo
}

main() {
  require_root_capability
  detect_os
  detect_pkg_manager
  cd "$ROOT_DIR"

  load_saved_ports
  check_ports

  echo "MindWall 部署 v$(project_version)"
  echo "目录: $ROOT_DIR"
  echo "分支: $BRANCH"

  install_base_tools
  ensure_docker_ready
  ensure_local_node_runtime
  register_mw_command
  update_git_source
  check_ports
  save_runtime_ports
  write_web_build_env
  write_api_env
  start_infra
  install_deps_migrate_build
  setup_systemd_api
  write_nginx_config
  setup_ssl
  print_summary
}

main "$@"
