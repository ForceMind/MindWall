#!/usr/bin/env bash
# MindWall 閮ㄧ讲鑴氭湰 v2.0 鈥?绾嫭绔嬫ā寮忥紝涓嶆敼鍔?Nginx / PM2 / 鍏朵粬鏈嶅姟
# 璁捐鍘熷垯锛堝涔犺嚜 Minimal-Server-Deploy锛夛細
#   鉁?涓嶄慨鏀?Nginx 閰嶇疆     鉁?涓嶅共娑?PM2
#   鉁?涓嶇洃鍚?80/443 绔彛    鉁?涓?kill 闈?MindWall 杩涚▼
#   鉁?Docker 浣跨敤椤圭洰涓撳睘鍚嶇О鍜岀鍙?
# CRLF 鑷慨澶嶏紙鍗曡锛屽熬閮?# 鍚告敹鍙兘鐨?\r锛岀‘淇濆嵆浣挎枃浠舵槸 CRLF 涔熻兘鎵ц锛?head -1 "$0"|grep -q $'\r'&&sed -i 's/\r$//' "$0"&&exec bash "$0" "$@" #

set -euo pipefail

# 鈹€鈹€鈹€ 棰滆壊 & 鏃ュ織 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[鉁揮${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
log_error() { echo -e "${RED}[鉁梋${NC} $*"; }
log_step()  { echo -e "\n${CYAN}${BOLD}$*${NC}"; }
die()       { log_error "$*" >&2; exit 1; }

# 鈹€鈹€鈹€ 璺緞甯搁噺 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
BACKUP_DIR="$RUNTIME_DIR/backups"

API_ENV_FILE="$API_DIR/.env"
WEB_ENV_PROD_FILE="$WEB_DIR/.env.production.local"
SYSTEMD_API_SERVICE="mindwall-api"
SYSTEMD_WEB_SERVICE="mindwall-web"
SYSTEMD_API_FILE="/etc/systemd/system/${SYSTEMD_API_SERVICE}.service"
SYSTEMD_WEB_FILE="/etc/systemd/system/${SYSTEMD_WEB_SERVICE}.service"
RUNTIME_WEB_SERVER_FILE="$RUNTIME_DIR/mindwall-web-server.cjs"

MIN_NODE_VERSION="${MIN_NODE_VERSION:-20.19.0}"
LOCAL_NODE_VERSION="${LOCAL_NODE_VERSION:-20.19.5}"

# 鈹€鈹€鈹€ 榛樿鍙傛暟 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
CURRENT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ -z "$CURRENT_BRANCH" || "$CURRENT_BRANCH" == "HEAD" ]]; then
  CURRENT_BRANCH="main"
fi

BRANCH="${BRANCH:-$CURRENT_BRANCH}"
API_PORT="${API_PORT:-3100}"
WEB_PORT="${WEB_PORT:-3001}"
PG_PORT="${PG_PORT:-5433}"
REDIS_PORT="${REDIS_PORT:-6380}"
PUBLIC_HOST="${PUBLIC_HOST:-}"
ADMIN_USERNAME="${ADMIN_USERNAME:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
SKIP_GIT="${SKIP_GIT:-0}"
NO_DOCKER="${NO_DOCKER:-0}"
SKIP_SYSTEM_INSTALL="${SKIP_SYSTEM_INSTALL:-0}"
YES="${YES:-0}"

SUDO=""
PKG_MANAGER=""
OS_ID=""

# 鈹€鈹€鈹€ 甯姪 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
usage() {
  cat <<'EOF'
MindWall 閮ㄧ讲鑴氭湰 v2锛堢函鐙珛妯″紡锛屼笉褰卞搷 Nginx / PM2 / 鍏朵粬鏈嶅姟锛?
鐢ㄦ硶:
  sudo bash deploy.sh [閫夐」]

閫夐」:
  --branch <name>           Git 鍒嗘敮锛堥粯璁わ細褰撳墠鍒嗘敮锛?  --api-port <port>         API 绔彛锛堥粯璁?3100锛屼粎鐩戝惉 127.0.0.1锛?  --web-port <port>         Web 绔彛锛堥粯璁?3001锛屽缃戝彲璁块棶锛?  --pg-port <port>          PostgreSQL 鏄犲皠绔彛锛堥粯璁?5433锛?  --redis-port <port>       Redis 鏄犲皠绔彛锛堥粯璁?6380锛?  --public-host <host>      鍏綉鍩熷悕鎴?IP锛堢敤浜?CORS锛?  --skip-git                璺宠繃 Git 鎷夊彇
  --no-docker               璺宠繃 Docker锛堝閮ㄧ鐞?PG/Redis锛?  --skip-system-install     璺宠繃绯荤粺鍖呭畨瑁咃紙閫傚悎鏇存柊鍦烘櫙锛?  --yes                     闈炰氦浜掓ā寮?  -h, --help                鏄剧ず甯姪

瀹夊叏淇濊瘉:
  * 涓嶄慨鏀?Nginx 閰嶇疆     * 涓嶅共娑?PM2
  * 涓嶇洃鍚?80/443 绔彛    * 涓?kill 闈?MindWall 杩涚▼
  * Docker 浣跨敤椤圭洰涓撳睘鍚嶇О鍜岀鍙?  * 濡傞渶 Nginx 鍙嶄唬锛岃鍙傝€? infra/mindwall-nginx.conf.template
EOF
}

# 鈹€鈹€鈹€ 鍙傛暟瑙ｆ瀽 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)        [[ $# -ge 2 ]] || die "--branch 缂哄皯鍙傛暟"; BRANCH="$2"; shift 2 ;;
    --api-port)      [[ $# -ge 2 ]] || die "--api-port 缂哄皯鍙傛暟"; API_PORT="$2"; shift 2 ;;
    --web-port)      [[ $# -ge 2 ]] || die "--web-port 缂哄皯鍙傛暟"; WEB_PORT="$2"; shift 2 ;;
    --pg-port)       [[ $# -ge 2 ]] || die "--pg-port 缂哄皯鍙傛暟"; PG_PORT="$2"; shift 2 ;;
    --redis-port)    [[ $# -ge 2 ]] || die "--redis-port 缂哄皯鍙傛暟"; REDIS_PORT="$2"; shift 2 ;;
    --public-host)   [[ $# -ge 2 ]] || die "--public-host 缂哄皯鍙傛暟"; PUBLIC_HOST="$2"; shift 2 ;;
    --skip-git)      SKIP_GIT="1"; shift ;;
    --no-docker)     NO_DOCKER="1"; shift ;;
    --skip-system-install) SKIP_SYSTEM_INSTALL="1"; shift ;;
    --yes)           YES="1"; shift ;;
    -h|--help|help)  usage; exit 0 ;;
    *) die "鏈瘑鍒弬鏁? $1锛堜娇鐢?--help 鏌ョ湅甯姪锛? ;;
  esac
done

# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?#  閫氱敤宸ュ叿鍑芥暟
# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?have_command() { command -v "$1" >/dev/null 2>&1; }

as_root() {
  if [[ -n "$SUDO" ]]; then "$SUDO" "$@"; else "$@"; fi
}

confirm_yes() {
  local prompt="$1"
  [[ "$YES" == "1" ]] && return 1
  read -r -p "$prompt" ans
  [[ "$ans" =~ ^[Yy]$ ]]
}

project_version() {
  [[ -f "$VERSION_FILE" ]] && tr -d '[:space:]' < "$VERSION_FILE" || echo "鏈煡"
}

validate_port() {
  local value="$1"
  [[ "$value" =~ ^[0-9]+$ ]] && (( value >= 1024 && value <= 65535 ))
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
  return 1
}

port_owner_summary() {
  local port="$1"
  if have_command ss; then
    local s; s="$(ss -lntp "( sport = :$port )" 2>/dev/null | tail -n +2 | head -3)"
    [[ -n "$s" ]] && { echo "$s"; return; }
  fi
  if have_command lsof; then
    local s; s="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -3 | awk '{printf "%s(pid=%s) ",$1,$2}')"
    [[ -n "$s" ]] && { echo "$s"; return; }
  fi
  echo "鏈煡杩涚▼"
}

version_ge() {
  [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1)" == "$2" ]]
}

node_version_of() {
  "$1" -v 2>/dev/null | sed -E 's/^v([0-9]+(\.[0-9]+){0,2}).*/\1/'
}

is_our_service_on_port() {
  local port="$1" service_name="$2"
  have_command systemctl || return 1
  as_root systemctl is-active --quiet "$service_name" 2>/dev/null && port_in_use "$port"
}

# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?#  绯荤粺妫€娴?# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?require_root() {
  if [[ "$(id -u)" -eq 0 ]]; then SUDO=""; return; fi
  if have_command sudo; then SUDO="sudo"; return; fi
  die "璇蜂娇鐢?root 鎵ц锛屾垨鍏堝畨瑁?sudo銆?
}

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    OS_ID="$(echo "${ID:-}" | tr '[:upper:]' '[:lower:]')"
  fi
}

detect_pkg_manager() {
  if have_command apt-get; then PKG_MANAGER="apt"
  elif have_command dnf; then PKG_MANAGER="dnf"
  elif have_command yum; then PKG_MANAGER="yum"
  elif have_command zypper; then PKG_MANAGER="zypper"
  elif have_command pacman; then PKG_MANAGER="pacman"
  else PKG_MANAGER="unknown"; fi
}

pkg_update_cache() {
  case "$PKG_MANAGER" in
    apt)    as_root apt-get update -y ;;
    dnf)    as_root dnf makecache -y || true ;;
    yum)    as_root yum makecache -y || true ;;
    zypper) as_root zypper --gpg-auto-import-keys refresh ;;
    pacman) as_root pacman -Sy --noconfirm ;;
    *) ;;
  esac
}

pkg_install() {
  case "$PKG_MANAGER" in
    apt)    as_root apt-get install -y "$@" ;;
    dnf)    as_root dnf install -y "$@" ;;
    yum)    as_root yum install -y "$@" ;;
    zypper) as_root zypper --non-interactive install "$@" ;;
    pacman) as_root pacman -S --noconfirm --needed "$@" ;;
    *) die "涓嶆敮鎸佺殑鍖呯鐞嗗櫒锛岃鎵嬪姩瀹夎锛?*" ;;
  esac
}

# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?#  绔彛瀹夊叏妫€鏌?鈥?鏍稿績瀹夊叏璁捐锛氱粷涓嶈嚜鍔ㄦ潃姝婚潪 MindWall 杩涚▼
# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?preflight_check_ports() {
  log_info "妫€鏌ョ鍙ｅ彲鐢ㄦ€?.."

  validate_port "$API_PORT" || die "API 绔彛涓嶅悎娉? $API_PORT锛堥渶 1024-65535锛?
  validate_port "$WEB_PORT" || die "Web 绔彛涓嶅悎娉? $WEB_PORT锛堥渶 1024-65535锛?
  [[ "$API_PORT" != "$WEB_PORT" ]] || die "API 绔彛鍜?Web 绔彛涓嶈兘鐩稿悓: $API_PORT"

  # 妫€鏌?API 绔彛
  if port_in_use "$API_PORT"; then
    if is_our_service_on_port "$API_PORT" "$SYSTEMD_API_SERVICE"; then
      log_info "API 绔彛 $API_PORT 琚?MindWall 鏈嶅姟鍗犵敤锛岄儴缃叉椂鑷姩閲嶅惎"
    else
      echo
      log_error "API 绔彛 $API_PORT 宸茶鍏朵粬鏈嶅姟鍗犵敤:"
      port_owner_summary "$API_PORT"
      die "璇蜂娇鐢?--api-port <绔彛> 鎸囧畾鍏朵粬绔彛"
    fi
  fi

  # 妫€鏌?Web 绔彛
  if port_in_use "$WEB_PORT"; then
    if is_our_service_on_port "$WEB_PORT" "$SYSTEMD_WEB_SERVICE"; then
      log_info "Web 绔彛 $WEB_PORT 琚?MindWall 鏈嶅姟鍗犵敤锛岄儴缃叉椂鑷姩閲嶅惎"
    else
      echo
      log_error "Web 绔彛 $WEB_PORT 宸茶鍏朵粬鏈嶅姟鍗犵敤:"
      port_owner_summary "$WEB_PORT"
      die "璇蜂娇鐢?--web-port <绔彛> 鎸囧畾鍏朵粬绔彛"
    fi
  fi
}

# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?#  閰嶇疆鎸佷箙鍖?# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?load_saved_ports() {
  [[ -f "$RUNTIME_PORTS_FILE" ]] || return 0
  local saved
  saved="$(grep -E '^API_PORT=' "$RUNTIME_PORTS_FILE" | tail -1 | cut -d= -f2- || true)"
  [[ -n "$saved" && "$API_PORT" == "3100" ]] && API_PORT="$saved"
  saved="$(grep -E '^WEB_PORT=' "$RUNTIME_PORTS_FILE" | tail -1 | cut -d= -f2- || true)"
  [[ -n "$saved" && "$WEB_PORT" == "3001" ]] && WEB_PORT="$saved"
  saved="$(grep -E '^PG_PORT=' "$RUNTIME_PORTS_FILE" | tail -1 | cut -d= -f2- || true)"
  [[ -n "$saved" ]] && PG_PORT="$saved"
  saved="$(grep -E '^REDIS_PORT=' "$RUNTIME_PORTS_FILE" | tail -1 | cut -d= -f2- || true)"
  [[ -n "$saved" ]] && REDIS_PORT="$saved"
  saved="$(grep -E '^PUBLIC_HOST=' "$RUNTIME_PORTS_FILE" | tail -1 | cut -d= -f2- || true)"
  [[ -n "$saved" && -z "$PUBLIC_HOST" ]] && PUBLIC_HOST="$saved"
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

backup_data() {
  local ts; ts="$(date +%Y%m%d-%H%M%S)"
  local bak="$BACKUP_DIR/$ts"
  mkdir -p "$bak"

  [[ -f "$API_ENV_FILE" ]] && cp "$API_ENV_FILE" "$bak/api.env"
  [[ -f "$WEB_ENV_PROD_FILE" ]] && cp "$WEB_ENV_PROD_FILE" "$bak/web.env.production.local"
  [[ -f "$RUNTIME_PORTS_FILE" ]] && cp "$RUNTIME_PORTS_FILE" "$bak/ports.env"

  log_info "宸插浠介厤缃埌 $bak"

  # 淇濈暀鏈€杩?10 涓浠?  local count
  count="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
  if (( count > 10 )); then
    find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | sort | head -n $((count - 10)) | xargs rm -rf
  fi
}

# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?#  Docker
# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?docker_engine_ready() {
  have_command docker && as_root docker info >/dev/null 2>&1
}

docker_compose_cmd() {
  local env_file="$ROOT_DIR/infra/.env"
  local compose_args=(-f "$COMPOSE_FILE")
  [[ -f "$env_file" ]] && compose_args+=(--env-file "$env_file")

  if as_root docker compose version >/dev/null 2>&1; then
    as_root docker compose "${compose_args[@]}" "$@"
  elif have_command docker-compose; then
    as_root docker-compose "${compose_args[@]}" "$@"
  else
    die "Docker Compose 涓嶅彲鐢?
  fi
}

install_docker_if_needed() {
  if docker_engine_ready; then return 0; fi
  if [[ "$SKIP_SYSTEM_INSTALL" == "1" ]]; then
    die "Docker 涓嶅彲鐢ㄣ€傝鍏堣繍琛屼笉甯?--skip-system-install 鐨勯儴缃层€?
  fi

  log_info "瀹夎 Docker..."
  case "$PKG_MANAGER" in
    apt)
      pkg_install docker.io docker-compose-plugin 2>/dev/null || true
      if ! have_command docker; then pkg_install docker.io 2>/dev/null || true; fi
      ;;
    dnf)
      as_root dnf install -y dnf-plugins-core || true
      as_root dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo 2>/dev/null || true
      pkg_install docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null \
        || pkg_install docker docker-compose-plugin 2>/dev/null || true
      ;;
    yum)
      as_root yum install -y yum-utils || true
      have_command yum-config-manager && as_root yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo 2>/dev/null || true
      pkg_install docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null \
        || pkg_install docker docker-compose-plugin 2>/dev/null || true
      ;;
    *) pkg_install docker docker-compose 2>/dev/null || true ;;
  esac

  if have_command systemctl; then
    as_root systemctl daemon-reload || true
    as_root systemctl enable docker || true
    as_root systemctl start docker || true
  fi
  docker_engine_ready || die "Docker 瀹夎澶辫触锛岃鎵嬪姩瀹夎: https://docs.docker.com/engine/install/"
}

# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?#  Node.js 杩愯鏃讹紙椤圭洰绉佹湁锛屼笉褰卞搷绯荤粺 Node锛?# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?download_with_fallback() {
  local output="$1"; shift
  for url in "$@"; do
    if curl -fL --connect-timeout 10 --retry 2 --retry-delay 2 "$url" -o "$output"; then
      return 0
    fi
  done
  return 1
}

install_local_node() {
  local arch node_arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) die "涓嶆敮鎸佺殑 CPU 鏋舵瀯: $arch" ;;
  esac

  local tarball="node-v${LOCAL_NODE_VERSION}-linux-${node_arch}.tar.xz"
  local tmp; tmp="$(mktemp -d)"

  log_info "涓嬭浇 Node.js v$LOCAL_NODE_VERSION ($node_arch)..."
  if ! download_with_fallback "$tmp/$tarball" \
    "https://nodejs.org/dist/v${LOCAL_NODE_VERSION}/${tarball}" \
    "https://npmmirror.com/mirrors/node/v${LOCAL_NODE_VERSION}/${tarball}"; then
    rm -rf "$tmp"
    die "涓嬭浇 Node.js 澶辫触锛岃妫€鏌ョ綉缁滆繛鎺ャ€?
  fi

  log_info "瑙ｅ帇 Node.js..."
  tar -xJf "$tmp/$tarball" -C "$tmp"
  rm -rf "$NODE_RUNTIME_DIR"
  mkdir -p "$RUNTIME_DIR"
  mv "$tmp/node-v${LOCAL_NODE_VERSION}-linux-${node_arch}" "$NODE_RUNTIME_DIR"
  chmod +x "$NODE_RUNTIME_DIR/bin/node" "$NODE_RUNTIME_DIR/bin/npm" "$NODE_RUNTIME_DIR/bin/npx"
  rm -rf "$tmp"
}

ensure_node_runtime() {
  local current=""
  if [[ -x "$NODE_BIN" ]]; then
    current="$(node_version_of "$NODE_BIN" || true)"
  fi

  if [[ -n "$current" ]] && version_ge "$current" "$MIN_NODE_VERSION"; then
    log_info "Node.js 宸插氨缁? v$current"
  else
    install_local_node
    local installed; installed="$(node_version_of "$NODE_BIN" || true)"
    [[ -n "$installed" ]] && version_ge "$installed" "$MIN_NODE_VERSION" \
      || die "Node.js 瀹夎澶辫触锛堥渶瑕?>= $MIN_NODE_VERSION锛?
    log_info "Node.js 宸插畨瑁? v$installed"
  fi
  export PATH="$NODE_RUNTIME_DIR/bin:$PATH"
}

npm_cmd() {
  if [[ -x "$NODE_BIN" && -f "$NPM_CLI_JS" ]]; then
    "$NODE_BIN" "$NPM_CLI_JS" "$@"
  elif [[ -x "$NPM_BIN" ]]; then
    "$NPM_BIN" "$@"
  else
    die "npm 涓嶅彲鐢紝璇峰厛瀹夎 Node.js 杩愯鏃躲€?
  fi
}

npm_install_dir() {
  local dir="$1"
  cd "$dir"
  if [[ -f "$dir/package-lock.json" ]]; then
    npm_cmd ci --no-fund --no-audit || npm_cmd install --no-fund --no-audit
  else
    npm_cmd install --no-fund --no-audit
  fi
}

ensure_rollup_compat() {
  local arch libc="gnu" pkg=""
  arch="$(uname -m)"
  have_command ldd && ldd --version 2>&1 | grep -qi musl && libc="musl"
  case "$arch" in
    x86_64|amd64)  pkg="@rollup/rollup-linux-x64-${libc}" ;;
    aarch64|arm64) pkg="@rollup/rollup-linux-arm64-${libc}" ;;
  esac
  [[ -z "$pkg" ]] && return 0
  cd "$WEB_DIR"
  "$NODE_BIN" -e "require('${pkg}')" >/dev/null 2>&1 && return 0
  log_warn "瀹夎 Rollup 骞冲彴渚濊禆: $pkg"
  npm_cmd install --no-save --no-fund --no-audit "$pkg" || true
}

# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?#  鐜鍙橀噺
# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?resolve_host() {
  if [[ -n "$PUBLIC_HOST" ]]; then echo "$PUBLIC_HOST"; return; fi
  local h; h="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [[ -n "$h" ]] && echo "$h" || echo "127.0.0.1"
}

set_env_kv() {
  local file="$1" key="$2" value="$3"
  local escaped; escaped="$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g' -e 's/"/\\"/g')"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    sed -i "s/^${key}=.*/${key}=\"${escaped}\"/" "$file"
  else
    printf '%s="%s"\n' "$key" "$value" >> "$file"
  fi
}

write_api_env() {
  mkdir -p "$API_DIR"
  if [[ ! -f "$API_ENV_FILE" ]]; then
    [[ -f "$API_DIR/.env.example" ]] && cp "$API_DIR/.env.example" "$API_ENV_FILE" || touch "$API_ENV_FILE"
  fi

  local host; host="$(resolve_host)"
  local web_origin="http://${host}:${WEB_PORT}"
  local cors="$web_origin"
  [[ -n "$PUBLIC_HOST" ]] && cors="https://$PUBLIC_HOST,http://$PUBLIC_HOST,$web_origin"

  set_env_kv "$API_ENV_FILE" "PORT" "$API_PORT"
  set_env_kv "$API_ENV_FILE" "WEB_ORIGIN" "$web_origin"
  set_env_kv "$API_ENV_FILE" "CORS_ALLOWED_ORIGINS" "$cors"
  set_env_kv "$API_ENV_FILE" "APP_VERSION" "$(project_version)"

  # 绠＄悊鍛樺嚟鎹?  [[ -n "$ADMIN_USERNAME" ]] && set_env_kv "$API_ENV_FILE" "ADMIN_USERNAME" "$ADMIN_USERNAME"
  [[ -n "$ADMIN_PASSWORD" ]] && set_env_kv "$API_ENV_FILE" "ADMIN_PASSWORD" "$ADMIN_PASSWORD"
  [[ -n "$PUBLIC_HOST" ]] && set_env_kv "$API_ENV_FILE" "PUBLIC_HOST" "$PUBLIC_HOST"

  if ! grep -qE '^DATABASE_URL=' "$API_ENV_FILE"; then
    set_env_kv "$API_ENV_FILE" "DATABASE_URL" "postgresql://mindwall:mindwall@127.0.0.1:${PG_PORT}/mindwall?schema=public"
  else
    sed -i "s/@localhost:5432/@127.0.0.1:${PG_PORT}/g" "$API_ENV_FILE" || true
    sed -i "s/@localhost:5433/@127.0.0.1:${PG_PORT}/g" "$API_ENV_FILE" || true
    sed -i "s/@127\.0\.0\.1:5432/@127.0.0.1:${PG_PORT}/g" "$API_ENV_FILE" || true
  fi
}

write_web_env() {
  cat > "$WEB_ENV_PROD_FILE" <<'EOF'
VITE_API_BASE_URL=/api
VITE_WS_BASE_URL=
EOF
}

# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?#  Web 闈欐€佹湇鍔″櫒 + API 鍙嶅悜浠ｇ悊锛堝唴寤猴紝涓嶄緷璧?Nginx锛?# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?write_web_server() {
  mkdir -p "$RUNTIME_DIR"
  cat > "$RUNTIME_WEB_SERVER_FILE" <<'WEBEOF'
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { URL } = require('node:url');

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

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function safePath(pathname) {
  const norm = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.join(WEB_DIST_DIR, norm);
  const rel = path.relative(WEB_DIST_DIR, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

function proxyHttp(req, res) {
  const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let upPath = parsed.pathname;
  if (upPath === '/api') upPath = '/';
  else if (upPath.startsWith('/api/')) upPath = upPath.slice(4);
  const finalPath = `${upPath}${parsed.search || ''}`;

  const upReq = http.request({
    host: '127.0.0.1', port: API_PORT, method: req.method,
    path: finalPath, headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` },
  }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  upReq.on('error', (e) => sendJson(res, 502, { message: 'API 涓嶅彲杈?, detail: String(e.message) }));
  req.pipe(upReq);
}

function serveStatic(req, res) {
  const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsed.pathname || '/');
  if (pathname.endsWith('/')) pathname += 'index.html';
  let fp = safePath(pathname);
  if (!fp || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(WEB_DIST_DIR, 'index.html');
  fs.readFile(fp, (err, data) => {
    if (err) { sendJson(res, 404, { message: '椤甸潰涓嶅瓨鍦? }); return; }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function proxyWs(req, socket, head) {
  const up = net.connect(API_PORT, '127.0.0.1');
  up.on('connect', () => {
    let hdrs = '';
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() === 'host') continue;
      if (Array.isArray(v)) v.forEach(i => { hdrs += `${k}: ${i}\r\n`; });
      else if (v !== undefined) hdrs += `${k}: ${v}\r\n`;
    }
    hdrs += `host: 127.0.0.1:${API_PORT}\r\n\r\n`;
    up.write(`${req.method} ${req.url || '/'} HTTP/${req.httpVersion}\r\n${hdrs}`);
    if (head && head.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
}

const server = http.createServer((req, res) => {
  const p = (req.url || '/').split('?')[0];
  if (p === '/api' || p.startsWith('/api/')) { proxyHttp(req, res); return; }
  serveStatic(req, res);
});
server.on('upgrade', (req, socket, head) => {
  const p = (req.url || '/').split('?')[0];
  if (!p.startsWith('/ws/')) { socket.destroy(); return; }
  proxyWs(req, socket, head);
});
server.listen(WEB_PORT, '0.0.0.0', () => {
  process.stdout.write(`MindWall Web listening :${WEB_PORT} -> API :${API_PORT}\n`);
});
WEBEOF
}

# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?#  systemd 鏈嶅姟绠＄悊
# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?stop_our_services() {
  have_command systemctl || return 0
  as_root systemctl stop "$SYSTEMD_API_SERVICE" 2>/dev/null || true
  as_root systemctl stop "$SYSTEMD_WEB_SERVICE" 2>/dev/null || true
  sleep 1
}

setup_api_service() {
  have_command systemctl || die "绯荤粺涓嶆敮鎸?systemd"

  local entry="$API_DIR/dist/src/main.js"
  [[ -f "$entry" ]] || entry="$API_DIR/dist/main.js"
  [[ -f "$entry" ]] || die "API 鏋勫缓浜х墿涓嶅瓨鍦?

  cat > /tmp/mindwall-api.service <<EOF
[Unit]
Description=MindWall API
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
WorkingDirectory=$API_DIR
Environment=NODE_ENV=production
Environment="PATH=$NODE_RUNTIME_DIR/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
EnvironmentFile=$API_ENV_FILE
ExecStart=$NODE_BIN $entry
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
  have_command systemctl || die "绯荤粺涓嶆敮鎸?systemd"
  write_web_server

  cat > /tmp/mindwall-web.service <<EOF
[Unit]
Description=MindWall Web
After=network.target mindwall-api.service
Wants=mindwall-api.service

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

# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?#  鍋ュ悍妫€鏌ワ紙瀛︿範鑷?Minimal-Server-Deploy锛?# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?health_check() {
  log_info "鍋ュ悍妫€鏌ヤ腑..."
  local retries=15 ok=0

  # 妫€鏌?API
  while (( retries > 0 )); do
    if curl -sf "http://127.0.0.1:${API_PORT}/" >/dev/null 2>&1; then
      ok=1; break
    fi
    sleep 2; retries=$((retries - 1))
  done
  if (( ok == 0 )); then
    log_error "API 鍋ュ悍妫€鏌ュけ璐ワ紙30 绉掑唴鏃犲搷搴旓級"
    log_warn "鎺掓煡鍛戒护: journalctl -u mindwall-api -n 50 --no-pager"
    as_root journalctl -u "$SYSTEMD_API_SERVICE" -n 15 --no-pager 2>/dev/null || true
    return 1
  fi
  log_info "API 鍋ュ悍妫€鏌ラ€氳繃 (127.0.0.1:$API_PORT)"

  # 妫€鏌?Web
  sleep 1
  if curl -sf "http://127.0.0.1:${WEB_PORT}/" >/dev/null 2>&1; then
    log_info "Web 鍋ュ悍妫€鏌ラ€氳繃 (0.0.0.0:$WEB_PORT)"
  else
    log_warn "Web 鏈嶅姟鏈搷搴旓紝鎺掓煡: journalctl -u mindwall-web -n 50 --no-pager"
  fi
  return 0
}

# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?#  7 姝ラ儴缃叉祦绋?# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
setup_interactive_config() {
  [[ "$YES" == "1" ]] && return 0

  # 鈹€鈹€ 鍏綉鍩熷悕 鈹€鈹€
  if [[ -z "$PUBLIC_HOST" ]]; then
    echo
    read -r -p "$(echo -e "${CYAN}鍏綉鍩熷悕锛堝 example.com锛岀洿鎺ュ洖杞﹁烦杩囷級锛?{NC}")" input_host
    [[ -n "$input_host" ]] && PUBLIC_HOST="$input_host"
  fi

  # 鈹€鈹€ 绠＄悊鍛樺嚟鎹紙棣栨閮ㄧ讲鎴栧瘑鐮佷负榛樿鍊兼椂鎻愮ず锛?鈹€鈹€
  local current_pw=""
  if [[ -f "$API_ENV_FILE" ]]; then
    current_pw="$(grep -E '^ADMIN_PASSWORD=' "$API_ENV_FILE" | tail -1 | sed 's/^ADMIN_PASSWORD=//' | sed 's/^"//;s/"$//' || true)"
  fi

  if [[ -z "$current_pw" || "$current_pw" == "change-this-admin-password" || "$current_pw" == "mindwall-admin" ]]; then
    echo
    log_info "棣栨閮ㄧ讲 鈥?璁剧疆绠＄悊鍚庡彴鍑嵁"
    read -r -p "$(echo -e "${CYAN}绠＄悊鍛樼敤鎴峰悕锛堥粯璁?admin锛夛細${NC}")" input_admin_user
    [[ -n "$input_admin_user" ]] && ADMIN_USERNAME="$input_admin_user" || ADMIN_USERNAME="admin"

    while true; do
      read -r -s -p "$(echo -e "${CYAN}绠＄悊鍛樺瘑鐮侊紙鐩存帴鍥炶溅鑷姩鐢熸垚锛夛細${NC}")" input_admin_pw
      echo
      if [[ -n "$input_admin_pw" ]]; then
        if (( ${#input_admin_pw} < 6 )); then
          log_warn "瀵嗙爜鑷冲皯 6 浣嶏紝璇烽噸鏂拌緭鍏?
          continue
        fi
        ADMIN_PASSWORD="$input_admin_pw"
      else
        ADMIN_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)"
        log_info "宸茶嚜鍔ㄧ敓鎴愮鐞嗗憳瀵嗙爜: ${BOLD}${ADMIN_PASSWORD}${NC}"
      fi
      break
    done
  else
    log_info "绠＄悊鍛樺瘑鐮佸凡閰嶇疆锛岃烦杩囪缃紙濡傞渶淇敼璇风紪杈?$API_ENV_FILE锛?
  fi
}

step_1_preflight() {
  log_step "[1/7] 鐜妫€娴嬩笌瀹夊叏妫€鏌?
  require_root
  detect_os
  detect_pkg_manager
  load_saved_ports
  preflight_check_ports
  backup_data
  setup_interactive_config
  log_info "绯荤粺: ${OS_ID:-鏈煡}  鍖呯鐞嗗櫒: $PKG_MANAGER"
  log_info "绔彛鍒嗛厤: API=$API_PORT  Web=$WEB_PORT  PG=$PG_PORT  Redis=$REDIS_PORT"
  [[ -n "$PUBLIC_HOST" ]] && log_info "鍏綉鍩熷悕: $PUBLIC_HOST"
}

step_2_system_deps() {
  log_step "[2/7] 瀹夎绯荤粺渚濊禆"
  if [[ "$SKIP_SYSTEM_INSTALL" == "1" ]]; then
    log_info "璺宠繃锛?-skip-system-install锛?; return
  fi
  pkg_update_cache
  case "$PKG_MANAGER" in
    apt)      pkg_install ca-certificates curl git tar xz-utils lsof jq ;;
    dnf|yum)  pkg_install ca-certificates curl git tar xz lsof jq ;;
    zypper)   pkg_install ca-certificates curl git tar xz lsof jq ;;
    pacman)   pkg_install ca-certificates curl git tar xz lsof jq ;;
    *) die "涓嶆敮鎸佺殑绯荤粺" ;;
  esac
  log_info "绯荤粺渚濊禆灏辩华"
}

step_3_docker() {
  log_step "[3/7] 鍚姩 Docker (PostgreSQL + Redis)"
  if [[ "$NO_DOCKER" == "1" ]]; then
    log_info "璺宠繃锛?-no-docker锛?; return
  fi

  install_docker_if_needed
  [[ -f "$COMPOSE_FILE" ]] || die "鎵句笉鍒?$COMPOSE_FILE"

  cat > "$ROOT_DIR/infra/.env" <<EOF
MW_PG_PORT=$PG_PORT
MW_REDIS_PORT=$REDIS_PORT
MW_PG_PASSWORD=mindwall
EOF

  # 杩佺Щ鏃?Compose 椤圭洰鍚嶄笉鍚岀殑瀹瑰櫒
  for c in mindwall-postgres mindwall-redis; do
    if as_root docker inspect "$c" >/dev/null 2>&1; then
      local old_proj
      old_proj="$(as_root docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$c" 2>/dev/null || true)"
      if [[ -n "$old_proj" && "$old_proj" != "mindwall" ]]; then
        log_warn "杩佺Щ鏃у鍣?$c锛?old_proj -> mindwall锛?
        as_root docker stop "$c" 2>/dev/null || true
        as_root docker rm "$c" 2>/dev/null || true
      fi
    fi
  done

  docker_compose_cmd up -d postgres redis

  log_info "绛夊緟 PostgreSQL 灏辩华..."
  local retries=60 ok=0
  while (( retries > 0 )); do
    if as_root docker exec mindwall-postgres pg_isready -U mindwall -d mindwall >/dev/null 2>&1; then
      ok=1; break
    fi
    sleep 2; retries=$((retries - 1))
  done
  if (( ok == 0 )); then
    as_root docker logs --tail 20 mindwall-postgres 2>&1 || true
    die "PostgreSQL 鍚姩瓒呮椂"
  fi
  log_info "PostgreSQL (绔彛 $PG_PORT) + Redis (绔彛 $REDIS_PORT) 灏辩华"
}

step_4_node() {
  log_step "[4/7] 鍑嗗 Node.js 杩愯鏃?
  ensure_node_runtime
}

step_5_git() {
  log_step "[5/7] 鏇存柊浠ｇ爜"
  if [[ "$SKIP_GIT" == "1" ]]; then
    log_info "璺宠繃锛?-skip-git锛?; return
  fi
  if ! have_command git || [[ ! -d "$ROOT_DIR/.git" ]]; then
    log_warn "闈?Git 浠撳簱锛岃烦杩囦唬鐮佹洿鏂?; return
  fi

  cd "$ROOT_DIR"
  git fetch origin "$BRANCH" || { log_warn "git fetch 澶辫触锛屼娇鐢ㄦ湰鍦颁唬鐮?; return; }

  local dirty; dirty="$(git status --porcelain || true)"
  if [[ -n "$dirty" ]]; then
    echo "$dirty" | head -n 10
    if confirm_yes "妫€娴嬪埌鏈湴鏀瑰姩锛屼涪寮冨苟鏇存柊锛?[y/N]: "; then
      git reset --hard HEAD
      git clean -fd
    else
      log_warn "淇濈暀鏈湴鏀瑰姩锛岃烦杩?Git 鎷夊彇"; return
    fi
  fi

  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git checkout "$BRANCH"
  elif git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    git checkout -b "$BRANCH" "origin/$BRANCH"
  fi

  git show-ref --verify --quiet "refs/remotes/origin/$BRANCH" && git pull --ff-only origin "$BRANCH"

  # 淇鍙兘鐨?CRLF 鎹㈣绗︼紙Windows Git 鍙兘娉ㄥ叆 \r锛?  find "$ROOT_DIR" -maxdepth 1 \( -name '*.sh' -o -name 'mw' \) -exec sed -i 's/\r$//' {} +

  log_info "浠ｇ爜宸叉洿鏂板埌鍒嗘敮 $BRANCH"
}

step_6_build() {
  log_step "[6/7] 瀹夎渚濊禆銆佽縼绉绘暟鎹簱銆佹瀯寤?

  stop_our_services
  save_runtime_ports
  write_api_env
  write_web_env

  # --- API ---
  log_info "瀹夎 API 渚濊禆..."
  npm_install_dir "$API_DIR"
  log_info "Prisma generate + migrate..."
  cd "$API_DIR" && npm_cmd run prisma:generate
  cd "$API_DIR" && npm_cmd run prisma:deploy
  log_info "鏋勫缓 API..."
  cd "$API_DIR" && npm_cmd run build

  # --- Web ---
  log_info "瀹夎 Web 渚濊禆..."
  npm_install_dir "$WEB_DIR"
  ensure_rollup_compat
  log_info "鏋勫缓 Web..."
  cd "$WEB_DIR"
  if ! npm_cmd run build; then
    log_warn "Web 鏋勫缓澶辫触锛屼慨澶嶄緷璧栧悗閲嶈瘯..."
    ensure_rollup_compat
    rm -rf "$WEB_DIR/node_modules"
    npm_install_dir "$WEB_DIR"
    ensure_rollup_compat
    npm_cmd run build
  fi

  log_info "鍏ㄩ儴鏋勫缓瀹屾垚"
}

step_7_start() {
  log_step "[7/7] 鍚姩鏈嶅姟 + 鍋ュ悍妫€鏌?

  setup_api_service
  sleep 2
  if ! as_root systemctl is-active --quiet "$SYSTEMD_API_SERVICE"; then
    as_root journalctl -u "$SYSTEMD_API_SERVICE" -n 30 --no-pager || true
    die "mindwall-api 鍚姩澶辫触"
  fi
  log_info "mindwall-api 宸插惎鍔?

  setup_web_service
  sleep 2
  if ! as_root systemctl is-active --quiet "$SYSTEMD_WEB_SERVICE"; then
    as_root journalctl -u "$SYSTEMD_WEB_SERVICE" -n 30 --no-pager || true
    die "mindwall-web 鍚姩澶辫触"
  fi
  log_info "mindwall-web 宸插惎鍔?

  health_check || true
}

# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?#  閮ㄧ讲瀹屾垚鎶ュ憡
# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?print_summary() {
  local host; host="$(resolve_host)"
  echo
  echo -e "${GREEN}${BOLD}鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲${NC}"
  echo -e "${GREEN}${BOLD}  MindWall v$(project_version) 閮ㄧ讲瀹屾垚${NC}"
  echo -e "${GREEN}${BOLD}鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲${NC}"
  echo -e "  妯″紡:      ${GREEN}鐙珛妯″紡${NC}锛堜笉褰卞搷 Nginx / PM2 / 鍏朵粬鏈嶅姟锛?
  if [[ -n "$PUBLIC_HOST" ]]; then
    echo -e "  鍏綉鍦板潃:  ${CYAN}https://${PUBLIC_HOST}${NC}"
  fi
  echo -e "  Web 鍦板潃:  ${CYAN}http://${host}:${WEB_PORT}${NC}"
  echo -e "  API 绔彛:  $API_PORT锛堜粎 127.0.0.1锛?
  echo -e "  Web 绔彛:  $WEB_PORT锛?.0.0.0 瀵瑰锛?
  [[ "$NO_DOCKER" != "1" ]] && echo -e "  PG 绔彛:   $PG_PORT    Redis: $REDIS_PORT"
  echo -e "  Node 璺緞: $NODE_RUNTIME_DIR"
  echo -e "  鏈嶅姟:      mindwall-api + mindwall-web"
  echo

  # 绠＄悊鍚庡彴淇℃伅
  local admin_base="http://${host}:${WEB_PORT}"
  [[ -n "$PUBLIC_HOST" ]] && admin_base="https://${PUBLIC_HOST}"
  echo -e "  ${YELLOW}绠＄悊鍚庡彴:${NC}  ${CYAN}${admin_base}/admin/login${NC}"
  local show_user; show_user="$(grep -E '^ADMIN_USERNAME=' "$API_ENV_FILE" 2>/dev/null | tail -1 | sed 's/^ADMIN_USERNAME=//' | sed 's/^"//;s/"$//' || echo 'admin')"
  echo -e "  ${YELLOW}绠＄悊鍛?${NC}    ${show_user}"
  if [[ -n "$ADMIN_PASSWORD" ]]; then
    echo -e "  ${YELLOW}瀵嗙爜:${NC}      ${BOLD}${ADMIN_PASSWORD}${NC}  鈫?${RED}璇风珛鍗宠褰曞苟濡ュ杽淇濆瓨${NC}"
  fi
  echo

  echo -e "  绠＄悊:  ${CYAN}mw status${NC}     鏌ョ湅杩愯鐘舵€?
  echo -e "         ${CYAN}mw logs${NC}       鏌ョ湅 API 鏃ュ織"
  echo -e "         ${CYAN}mw update${NC}     蹇€熸洿鏂?
  echo -e "         ${CYAN}mw restart${NC}    閲嶅惎鏈嶅姟"
  echo -e "         ${CYAN}mw uninstall${NC}  鍗歌浇鏈嶅姟"
  echo -e "         ${CYAN}mw menu${NC}       浜や簰鑿滃崟"
  echo
  if [[ -n "$host" ]] && [[ "$host" =~ ^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.) ]]; then
    [[ -z "$PUBLIC_HOST" ]] && log_warn "褰撳墠涓哄唴缃?IP锛?host锛夛紝鍏綉璁块棶璇蜂娇鐢?--public-host 鎸囧畾鍩熷悕"
  fi
  echo -e "  ${YELLOW}鎻愮ず:${NC} 濡傛灉闇€瑕?Nginx 鍙嶄唬锛屽弬鑰? infra/mindwall-nginx.conf.template"
  echo -e "  ${YELLOW}鎻愮ず:${NC} 鍏綉璁块棶璇风‘淇濆畨鍏ㄧ粍/闃茬伀澧欐斁琛岀鍙?$WEB_PORT"
  echo
}

# 鈹€鈹€鈹€ 鍏ュ彛 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
main() {
  cd "$ROOT_DIR"
  echo -e "${CYAN}${BOLD}MindWall 閮ㄧ讲鑴氭湰 v2.0${NC}  鈥? 鐩綍: $ROOT_DIR  鍒嗘敮: $BRANCH"

  step_1_preflight
  step_2_system_deps
  step_3_docker
  step_4_node
  step_5_git
  step_6_build
  step_7_start
  print_summary
}

main "$@"
