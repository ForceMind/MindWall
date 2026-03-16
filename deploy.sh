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
NO_DOCKER="${NO_DOCKER:-0}"
YES="${YES:-0}"

SUDO=""
PKG_MANAGER=""
OS_ID=""

usage() {
  cat <<'EOF'
MindWall 首次部署脚本

用法:
  sudo bash deploy.sh

参数:
  --branch <name>       Git 分支（默认 main）
  --api-port <port>     API 端口（默认 3100）
  --web-port <port>     Web 端口（默认 3001）
  --public-host <host>  对外访问主机/IP（用于前端 API 地址）
  --skip-git            跳过 Git 拉取
  --no-docker           跳过 Docker 启动
  --yes                 非交互模式
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
      shift 2
      ;;
    --web-port)
      [[ $# -ge 2 ]] || { echo "错误: --web-port 缺少参数值"; exit 1; }
      WEB_PORT="$2"
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

detect_os() {
  if [[ -f /etc/os-release ]]; then
    local id_raw
    id_raw="$(grep -E '^ID=' /etc/os-release | cut -d= -f2- | tr -d '"' || true)"
    OS_ID="${id_raw,,}"
  fi
  if [[ -z "$OS_ID" ]]; then
    OS_ID="unknown"
  fi
}

detect_pkg_manager() {
  if [[ -n "$PKG_MANAGER" ]]; then
    return
  fi
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
    die "未检测到支持的包管理器（apt/dnf/yum/zypper/pacman）。"
  fi
}

refresh_pkg_index() {
  detect_pkg_manager
  case "$PKG_MANAGER" in
    apt) as_root apt-get update -y ;;
    dnf) as_root dnf makecache -y ;;
    yum) as_root yum makecache -y ;;
    zypper) as_root zypper --non-interactive refresh ;;
    pacman) as_root pacman -Sy --noconfirm ;;
  esac
}

install_packages() {
  detect_pkg_manager
  case "$PKG_MANAGER" in
    apt)
      DEBIAN_FRONTEND=noninteractive as_root apt-get install -y --no-install-recommends "$@"
      ;;
    dnf)
      as_root dnf install -y "$@"
      ;;
    yum)
      as_root yum install -y "$@"
      ;;
    zypper)
      as_root zypper --non-interactive install -y "$@"
      ;;
    pacman)
      as_root pacman -S --noconfirm --needed "$@"
      ;;
  esac
}

install_base_tools() {
  echo "[1/12] 安装基础工具"
  refresh_pkg_index
  case "$PKG_MANAGER" in
    apt)
      install_packages ca-certificates curl git tar xz-utils lsof
      ;;
    dnf|yum)
      install_packages ca-certificates curl git tar xz lsof
      ;;
    zypper|pacman)
      install_packages ca-certificates curl git tar xz lsof
      ;;
  esac
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

install_docker() {
  echo "[2/12] 安装 Docker"
  detect_pkg_manager
  detect_os

  if ! have_command docker || ! docker_engine_ready; then
    case "$PKG_MANAGER" in
      apt)
        install_packages docker.io docker-compose-plugin || install_packages docker.io docker-compose || true
        ;;
      dnf)
        install_packages dnf-plugins-core || true
        as_root dnf config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo || true
        as_root dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo || true
        install_packages docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || true
        install_packages docker docker-compose || true
        ;;
      yum)
        install_packages yum-utils || true
        as_root yum-config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo || true
        as_root yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo || true
        install_packages docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || true
        install_packages docker docker-compose || true
        ;;
      zypper)
        install_packages docker docker-compose || true
        ;;
      pacman)
        install_packages docker docker-compose || true
        ;;
    esac
  fi

  if have_command systemctl; then
    as_root systemctl enable --now docker || as_root systemctl restart docker || true
  fi
  ensure_docker_mirrors
  if have_command systemctl; then
    as_root systemctl restart docker || true
  fi

  docker_engine_ready || die "Docker 引擎不可用。"
  docker_compose_available || die "Docker Compose 不可用。"
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

prepare_runtime_dirs() {
  mkdir -p "$RUNTIME_DIR" "$NPM_GLOBAL_PREFIX" "$PM2_HOME_DIR"
}

download_node_into_runtime() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) die "不支持的 CPU 架构: $arch" ;;
  esac

  local versions=(
    "20.19.5"
    "20.19.4"
    "20.19.3"
    "22.12.0"
  )
  local mirrors=(
    "https://npmmirror.com/mirrors/node"
    "https://nodejs.org/dist"
  )

  rm -rf "$NODE_RUNTIME_DIR"
  mkdir -p "$NODE_RUNTIME_DIR"

  local ok=0
  local tmpdir
  tmpdir="$(mktemp -d)"

  for ver in "${versions[@]}"; do
    local file
    file="node-v${ver}-linux-${arch}.tar.xz"
    for mirror in "${mirrors[@]}"; do
      local url
      url="${mirror}/v${ver}/${file}"
      if curl -fsSL "$url" -o "${tmpdir}/node.tar.xz"; then
        if tar -xJf "${tmpdir}/node.tar.xz" -C "$NODE_RUNTIME_DIR" --strip-components=1; then
          ok=1
          break
        fi
      fi
    done
    if [[ "$ok" -eq 1 ]]; then
      break
    fi
  done
  rm -rf "$tmpdir"
  [[ "$ok" -eq 1 ]] || die "Node.js 运行时安装失败: $NODE_RUNTIME_DIR"
}

ensure_local_node_runtime() {
  echo "[3/12] 准备项目内 Node.js 运行时"
  prepare_runtime_dirs
  if [[ -x "$NODE_BIN" ]]; then
    local current
    current="$(node_version_of "$NODE_BIN" || true)"
    if [[ -n "$current" ]] && version_ge "$current" "$MIN_NODE_VERSION"; then
      echo "当前本地 Node.js 运行时: v$current"
      return
    fi
  fi

  echo "正在安装 Node.js >= $MIN_NODE_VERSION 到 $NODE_RUNTIME_DIR"
  download_node_into_runtime

  local installed
  installed="$(node_version_of "$NODE_BIN" || true)"
  if [[ -z "$installed" ]] || ! version_ge "$installed" "$MIN_NODE_VERSION"; then
    die "Node.js 版本过低（当前 v${installed:-未知}，要求 >= $MIN_NODE_VERSION）"
  fi
  echo "Node.js 运行时安装完成: v$installed"
}

npm_cmd() {
  PATH="$NODE_RUNTIME_DIR/bin:$PATH" "$NPM_BIN" "$@"
}

pm2_cmd() {
  PATH="$NPM_GLOBAL_PREFIX/bin:$NODE_RUNTIME_DIR/bin:$PATH" PM2_HOME="$PM2_HOME_DIR" "$PM2_BIN" "$@"
}

ensure_local_pm2() {
  echo "[4/12] 准备项目内 PM2 运行时"
  if [[ -x "$PM2_BIN" ]]; then
    return
  fi
  NPM_CONFIG_PREFIX="$NPM_GLOBAL_PREFIX" PATH="$NODE_RUNTIME_DIR/bin:$PATH" "$NPM_BIN" install -g pm2
  [[ -x "$PM2_BIN" ]] || die "本地 PM2 安装失败。"
}

register_shortcuts() {
  echo "[5/12] 注册快捷命令"
  as_root chmod 755 "$ROOT_DIR/deploy.sh" "$ROOT_DIR/update.sh"

  local w1 w2
  w1="$(mktemp)"
  w2="$(mktemp)"
  cat > "$w1" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec bash "$ROOT_DIR/deploy.sh" "\$@"
EOF
  cat > "$w2" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec bash "$ROOT_DIR/update.sh" "\$@"
EOF
  as_root install -m 755 "$w1" /usr/local/bin/mw-deploy
  as_root install -m 755 "$w2" /usr/local/bin/mw-update
  rm -f "$w1" "$w2"
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
      warn "检测到本地改动，--yes 模式下保留改动并跳过 Git 拉取。"
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

ensure_ports() {
  echo "[6/12] 处理端口占用"

  local chosen_api chosen_web
  chosen_api="$(find_free_port "$API_PORT")"
  if [[ "$chosen_api" != "$API_PORT" ]]; then
    warn "API 端口 $API_PORT 已被占用，改用 $chosen_api。"
  fi

  chosen_web="$(find_free_port "$WEB_PORT")"
  if [[ "$chosen_web" != "$WEB_PORT" ]]; then
    warn "Web 端口 $WEB_PORT 已被占用，改用 $chosen_web。"
  fi

  API_PORT="$chosen_api"
  WEB_PORT="$chosen_web"

  mkdir -p "$RUNTIME_DIR"
  cat > "$RUNTIME_PORTS_FILE" <<EOF
API_PORT=$API_PORT
WEB_PORT=$WEB_PORT
EOF
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

write_app_env_ports() {
  echo "[7/12] 写入应用环境配置"
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
    echo "[8/12] 跳过 Docker 启动"
    return
  fi
  echo "[8/12] 启动 PostgreSQL + Redis"
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

install_project_deps() {
  echo "[9/12] 安装 API/Web 依赖"
  npm_install_with_fallback "$API_DIR"
  npm_install_with_fallback "$WEB_DIR"
  ensure_rollup_optional_dependency "$WEB_DIR"
}

run_prisma() {
  echo "[10/12] 执行 Prisma 生成与迁移"
  cd "$API_DIR"
  npm_cmd run prisma:generate
  npm_cmd run prisma:deploy
}

build_project() {
  echo "[11/12] 构建 API/Web"
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
}

start_services() {
  echo "[12/12] 启动 PM2 服务（独立 PM2_HOME）"
  local allow_host
  allow_host="$(resolve_public_host)"
  pm2_cmd describe mindwall-api >/dev/null 2>&1 || \
    pm2_cmd start "$NPM_BIN" --name mindwall-api --cwd "$API_DIR" -- run start:prod
  pm2_cmd restart mindwall-api --update-env

  # Web 进程总是按当前端口和主机白名单重建，避免旧参数残留（如端口仍停留在 3001）
  pm2_cmd delete mindwall-web >/dev/null 2>&1 || true
  __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="$allow_host" pm2_cmd start "$NPM_BIN" --name mindwall-web --cwd "$WEB_DIR" -- run start -- --host 0.0.0.0 --port "$WEB_PORT"
  pm2_cmd save
}

print_summary() {
  local ip
  ip="$(resolve_public_host)"
  if [[ -z "$ip" ]]; then
    ip="<服务器IP>"
  fi
  echo
  echo "部署完成: MindWall v$(project_version)"
  echo "API 端口: $API_PORT"
  echo "Web 端口: $WEB_PORT"
  echo "Web 地址: http://${ip}:${WEB_PORT}"
  echo "PM2_HOME: $PM2_HOME_DIR"
  echo "本地 Node 路径: $NODE_RUNTIME_DIR"
  if is_ipv4 "$ip" && is_private_ipv4 "$ip"; then
    echo "警告: 当前展示的是内网 IP（$ip），公网访问请设置 --public-host 或环境变量 PUBLIC_HOST。"
  fi
  echo "提示: 若公网仍无法访问，请检查云安全组/防火墙是否放行 $WEB_PORT（以及 $API_PORT）。"
}

main() {
  require_root_capability
  detect_os
  detect_pkg_manager

  validate_port "$API_PORT" || die "API 端口不合法: $API_PORT"
  validate_port "$WEB_PORT" || die "Web 端口不合法: $WEB_PORT"

  cd "$ROOT_DIR"
  echo "MindWall 首次部署 v$(project_version)"
  echo "目录: $ROOT_DIR"

  install_base_tools
  if [[ "$NO_DOCKER" != "1" ]]; then
    install_docker
  else
    echo "[2/12] 跳过 Docker 安装"
  fi
  ensure_local_node_runtime
  ensure_local_pm2
  register_shortcuts
  update_git_source
  ensure_runtime_files
  ensure_ports
  write_app_env_ports
  start_infra
  install_project_deps
  run_prisma
  build_project
  start_services
  print_summary
}

main "$@"
