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
NPM_GLOBAL_PREFIX="$RUNTIME_DIR/npm-global"   # 保留仅用于清理旧 PM2
PM2_HOME_DIR="$RUNTIME_DIR/pm2-home"          # 保留仅用于清理旧 PM2
RUNTIME_PORTS_FILE="$RUNTIME_DIR/ports.env"

NODE_BIN="$NODE_RUNTIME_DIR/bin/node"
NPM_BIN="$NODE_RUNTIME_DIR/bin/npm"

MIN_NODE_VERSION="${MIN_NODE_VERSION:-20.19.0}"
BRANCH="${BRANCH:-main}"
API_PORT="${API_PORT:-3100}"
API_PORT_SET=0
PUBLIC_HOST="${PUBLIC_HOST:-}"
SKIP_GIT="${SKIP_GIT:-0}"
NO_DOCKER="${NO_DOCKER:-0}"
ENABLE_SSL="${ENABLE_SSL:-0}"
YES="${YES:-0}"

SUDO=""
PKG_MANAGER=""
OS_ID=""

# ── 使用说明 ───────────────────────────────────────────────────────────────
usage() {
  cat <<'EOF'
MindWall 首次部署脚本（nginx + systemd）

用法:
  sudo bash deploy.sh [选项]

选项:
  --branch <name>       Git 分支（默认 main）
  --api-port <port>     API 内部端口（默认 3100，通过 nginx 代理，不直接对外）
  --public-host <host>  对外域名或公网 IP（默认自动检测）
  --skip-git            跳过 Git 拉取
  --no-docker           跳过 Docker 启动（不安装/启动 PostgreSQL+Redis）
  --ssl                 使用 certbot 申请 Let's Encrypt 证书（需有效域名）
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
    --web-port)
      # 兼容旧参数，静默忽略（前端现在由 nginx 直接服务静态文件）
      [[ $# -ge 2 ]] && shift 2 || shift ;;
    --public-host)
      [[ $# -ge 2 ]] || { echo "错误: --public-host 缺少参数值"; exit 1; }
      PUBLIC_HOST="$2"; shift 2 ;;
    --skip-git)   SKIP_GIT="1";   shift ;;
    --no-docker)  NO_DOCKER="1";  shift ;;
    --ssl)        ENABLE_SSL="1"; shift ;;
    --yes)        YES="1";        shift ;;
    -h|--help|help) usage; exit 0 ;;
    *)
      echo "错误: 未识别参数 $1"; usage; exit 1 ;;
  esac
done

# ── 通用工具函数 ───────────────────────────────────────────────────────────
have_command() { command -v "$1" >/dev/null 2>&1; }

as_root() {
  if [[ -n "$SUDO" ]]; then "$SUDO" "$@"; else "$@"; fi
}

port_in_use() {
  local port="$1"
  if have_command ss; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq ":${port}$" && return 0
    return 1
  fi
  if have_command netstat; then
    netstat -lnt 2>/dev/null | awk '{print $4}' | grep -Eq ":${port}$" && return 0
    return 1
  fi
  if have_command lsof; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1 && return 0
    return 1
  fi
  return 1
}

# 若 API 端口被其他（非本项目）进程占用，自动找下一个空闲端口
# 绝不会动到服务器上其他项目的端口
check_api_port() {
  if ! port_in_use "$API_PORT"; then return; fi

  # 如果是我们自己的服务在跑，复用同一端口即可
  if have_command systemctl && systemctl is-active --quiet mindwall-api 2>/dev/null; then
    return
  fi

  local orig="$API_PORT"
  local p="$orig"
  while port_in_use "$p"; do
    p=$((p + 1))
    [[ "$p" -gt 65000 ]] && die "找不到可用的 API 端口（从 $orig 开始已搜索到 $p）"
  done
  warn "API 端口 $orig 被其他进程占用，自动改用 $p（其他服务未受影响）。"
  API_PORT="$p"
  API_PORT_SET=0   # 允许后续 load_saved_ports 覆盖，避免循环漂移
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

detect_os() {
  if [[ -f /etc/os-release ]]; then
    local id_raw
    id_raw="$(grep -E '^ID=' /etc/os-release | cut -d= -f2- | tr -d '"' || true)"
    OS_ID="${id_raw,,}"
  fi
  [[ -z "$OS_ID" ]] && OS_ID="unknown"
}

detect_pkg_manager() {
  [[ -n "$PKG_MANAGER" ]] && return
  if   have_command apt-get; then PKG_MANAGER="apt"
  elif have_command dnf;     then PKG_MANAGER="dnf"
  elif have_command yum;     then PKG_MANAGER="yum"
  elif have_command zypper;  then PKG_MANAGER="zypper"
  elif have_command pacman;  then PKG_MANAGER="pacman"
  else die "未检测到支持的包管理器（apt/dnf/yum/zypper/pacman）。"
  fi
}

refresh_pkg_index() {
  detect_pkg_manager
  case "$PKG_MANAGER" in
    apt)    as_root apt-get update -y ;;
    dnf)    as_root dnf makecache -y ;;
    yum)    as_root yum makecache -y ;;
    zypper) as_root zypper --non-interactive refresh ;;
    pacman) as_root pacman -Sy --noconfirm ;;
  esac
}

install_packages() {
  detect_pkg_manager
  case "$PKG_MANAGER" in
    apt)    DEBIAN_FRONTEND=noninteractive as_root apt-get install -y --no-install-recommends "$@" ;;
    dnf)    as_root dnf install -y "$@" ;;
    yum)    as_root yum install -y "$@" ;;
    zypper) as_root zypper --non-interactive install -y "$@" ;;
    pacman) as_root pacman -S --noconfirm --needed "$@" ;;
  esac
}

# ── [1/10] 安装基础工具 ────────────────────────────────────────────────────
install_base_tools() {
  echo "[1/10] 安装基础工具（含 nginx）"
  refresh_pkg_index
  case "$PKG_MANAGER" in
    apt)
      install_packages ca-certificates curl git tar xz-utils lsof nginx
      install_packages certbot python3-certbot-nginx 2>/dev/null || true
      ;;
    dnf|yum)
      install_packages ca-certificates curl git tar xz lsof nginx
      install_packages certbot python3-certbot-nginx 2>/dev/null || \
        install_packages certbot 2>/dev/null || true
      ;;
    zypper|pacman)
      install_packages ca-certificates curl git tar xz lsof nginx
      install_packages certbot 2>/dev/null || true
      ;;
  esac
  if have_command systemctl; then
    as_root systemctl enable nginx 2>/dev/null || true
  fi
}

# ── [2/10] 安装 Docker ─────────────────────────────────────────────────────
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

ensure_docker_mirrors() {
  local daemon_file="/etc/docker/daemon.json"
  [[ -f "$daemon_file" ]] && grep -q '"registry-mirrors"' "$daemon_file" && return
  as_root mkdir -p /etc/docker
  local tmp_file; tmp_file="$(mktemp)"
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
  as_root cp "$tmp_file" "$daemon_file"; rm -f "$tmp_file"
}

install_docker() {
  echo "[2/10] 安装 Docker"
  detect_pkg_manager; detect_os
  if ! have_command docker || ! docker_engine_ready; then
    case "$PKG_MANAGER" in
      apt)
        install_packages docker.io docker-compose-plugin || \
          install_packages docker.io docker-compose || true ;;
      dnf)
        install_packages dnf-plugins-core || true
        as_root dnf config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo 2>/dev/null || true
        install_packages docker-ce docker-ce-cli containerd.io docker-compose-plugin || \
          install_packages docker docker-compose || true ;;
      yum)
        install_packages yum-utils || true
        as_root yum-config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo 2>/dev/null || true
        install_packages docker-ce docker-ce-cli containerd.io docker-compose-plugin || \
          install_packages docker docker-compose || true ;;
      zypper|pacman)
        install_packages docker docker-compose || true ;;
    esac
  fi
  if have_command systemctl; then
    as_root systemctl enable --now docker || as_root systemctl restart docker || true
  fi
  ensure_docker_mirrors
  if have_command systemctl; then as_root systemctl restart docker || true; fi
  docker_engine_ready    || die "Docker 引擎不可用。"
  docker_compose_available || die "Docker Compose 不可用。"
}

# ── [3/10] Node.js 运行时（仅用于构建） ───────────────────────────────────
version_ge() {
  [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1)" == "$2" ]]
}

node_version_of() { "$1" -v 2>/dev/null | sed 's/^v//'; }

prepare_runtime_dirs() { mkdir -p "$RUNTIME_DIR"; }

download_node_into_runtime() {
  local arch; arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64)  arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) die "不支持的 CPU 架构: $arch" ;;
  esac

  local versions=("20.19.5" "20.19.4" "20.19.3" "22.12.0")
  local mirrors=("https://npmmirror.com/mirrors/node" "https://nodejs.org/dist")

  rm -rf "$NODE_RUNTIME_DIR"; mkdir -p "$NODE_RUNTIME_DIR"
  local ok=0; local tmpdir; tmpdir="$(mktemp -d)"

  for ver in "${versions[@]}"; do
    local file="node-v${ver}-linux-${arch}.tar.xz"
    for mirror in "${mirrors[@]}"; do
      local url="${mirror}/v${ver}/${file}"
      if curl -fsSL "$url" -o "${tmpdir}/node.tar.xz"; then
        if tar -xJf "${tmpdir}/node.tar.xz" -C "$NODE_RUNTIME_DIR" --strip-components=1; then
          ok=1; break
        fi
      fi
    done
    [[ "$ok" -eq 1 ]] && break
  done
  rm -rf "$tmpdir"
  [[ "$ok" -eq 1 ]] || die "Node.js 运行时安装失败。"
}

ensure_local_node_runtime() {
  echo "[3/10] 准备构建用 Node.js 运行时"
  prepare_runtime_dirs
  if [[ -x "$NODE_BIN" ]]; then
    local current; current="$(node_version_of "$NODE_BIN" || true)"
    if [[ -n "$current" ]] && version_ge "$current" "$MIN_NODE_VERSION"; then
      echo "当前 Node.js: v$current"; return
    fi
  fi
  echo "正在安装 Node.js >= $MIN_NODE_VERSION ..."
  download_node_into_runtime
  local installed; installed="$(node_version_of "$NODE_BIN" || true)"
  if [[ -z "$installed" ]] || ! version_ge "$installed" "$MIN_NODE_VERSION"; then
    die "Node.js 版本过低（当前 v${installed:-未知}，要求 >= $MIN_NODE_VERSION）"
  fi
  echo "Node.js 安装完成: v$installed"
}

npm_cmd() { PATH="$NODE_RUNTIME_DIR/bin:$PATH" "$NPM_BIN" "$@"; }

# ── [4/10] 注册快捷命令 ────────────────────────────────────────────────────
register_shortcuts() {
  echo "[4/10] 注册快捷命令"
  as_root chmod 755 "$ROOT_DIR/deploy.sh" "$ROOT_DIR/update.sh"
  local w1 w2; w1="$(mktemp)"; w2="$(mktemp)"
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

# ── [5/10] 清理旧进程和服务 ────────────────────────────────────────────────
cleanup_old_processes() {
  echo "[5/10] 清理旧进程和服务"

  # 清理项目本地安装的旧 PM2
  local old_pm2="$NPM_GLOBAL_PREFIX/bin/pm2"
  if [[ -x "$old_pm2" ]]; then
    echo "  发现旧 PM2，正在停止进程..."
    PM2_HOME="$PM2_HOME_DIR" "$old_pm2" delete all >/dev/null 2>&1 || true
    PM2_HOME="$PM2_HOME_DIR" "$old_pm2" kill      >/dev/null 2>&1 || true
  fi

  # 清理系统 PM2（如有）
  if have_command pm2; then
    pm2 delete all >/dev/null 2>&1 || true
    pm2 kill       >/dev/null 2>&1 || true
  fi

  # 停止旧 systemd 服务（上次部署残留）
  if have_command systemctl; then
    for svc in mindwall-api mindwall-web; do
      if systemctl is-active --quiet "$svc" 2>/dev/null; then
        echo "  停止旧服务: $svc"
        as_root systemctl stop    "$svc" 2>/dev/null || true
      fi
      as_root systemctl disable "$svc" >/dev/null 2>&1 || true
    done
  fi
}

# ── 代码更新 ──────────────────────────────────────────────────────────────
update_git_source() {
  if [[ "$SKIP_GIT" == "1" ]]; then echo "已跳过 Git 拉取。"; return; fi
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

ensure_runtime_files() {
  local config_dir="$API_DIR/config"
  local runtime_file="$config_dir/runtime-config.json"
  local runtime_example="$config_dir/runtime-config.example.json"

  mkdir -p "$config_dir" "$API_DIR/logs"
  if [[ ! -f "$runtime_file" ]]; then
    [[ -f "$runtime_example" ]] && cp "$runtime_example" "$runtime_file" || printf "{}\n" > "$runtime_file"
  fi

  if [[ ! -f "$API_DIR/.env" ]]; then
    if   [[ -f "$API_DIR/.env.example" ]]; then cp "$API_DIR/.env.example" "$API_DIR/.env"
    elif [[ -f "$ROOT_DIR/.env.example" ]]; then cp "$ROOT_DIR/.env.example" "$API_DIR/.env"
    else touch "$API_DIR/.env"
    fi
  fi
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

# ── [6/10] 写入应用环境配置 ────────────────────────────────────────────────
write_app_env_ports() {
  echo "[6/10] 写入应用环境配置"
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

  # 前端构建变量：通过 nginx 路径访问 API（同域，免 CORS）
  cat > "$WEB_DIR/.env.production.local" <<EOF
VITE_API_BASE_URL=${schema}://${host}/api
VITE_WS_BASE_URL=${ws_schema}://${host}
EOF

  mkdir -p "$RUNTIME_DIR"
  printf 'API_PORT=%s\n' "$API_PORT" > "$RUNTIME_PORTS_FILE"
}

# ── [7/10] 启动 PostgreSQL + Redis ────────────────────────────────────────
try_prepull_images() {
  as_root docker pull docker.m.daocloud.io/library/redis:7-alpine && \
    as_root docker tag docker.m.daocloud.io/library/redis:7-alpine redis:7-alpine || true
  as_root docker pull docker.m.daocloud.io/pgvector/pgvector:pg16 && \
    as_root docker tag docker.m.daocloud.io/pgvector/pgvector:pg16 pgvector/pgvector:pg16 || true
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
  if [[ "$NO_DOCKER" == "1" ]]; then echo "[7/10] 跳过 Docker 启动"; return; fi
  echo "[7/10] 启动 PostgreSQL + Redis"
  local ok=0
  for attempt in 1 2 3; do
    if docker_compose_run up -d; then ok=1; break; fi
    warn "Docker 启动失败，第 $attempt 次重试。"
    ensure_docker_mirrors
    [[ "$attempt" -eq 1 ]] && try_prepull_images
    have_command systemctl && { as_root systemctl restart docker || true; }
    sleep $((attempt * 5))
  done
  [[ "$ok" -eq 1 ]] || die "Docker 服务启动失败（redis/pgvector 镜像拉取失败）。"
  wait_for_container "mindwall-postgres" 180
  wait_for_container "mindwall-redis"    90
}

# ── [8/10] 安装依赖、Prisma 迁移、构建 ────────────────────────────────────
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
  if [[ -z "$rollup_opt_ver" ]]; then
    rollup_opt_ver="$(
      cd "$dir" && PATH="$NODE_RUNTIME_DIR/bin:$PATH" "$NODE_BIN" -e \
      "try{const p=require('./package-lock.json');const r=p.packages&&p.packages['node_modules/rollup'];process.stdout.write((r&&r.optionalDependencies&&r.optionalDependencies['@rollup/rollup-linux-x64-gnu'])||'')}catch(e){process.stdout.write('')}"
    )"
  fi

  if [[ -n "$rollup_opt_ver" ]]; then
    echo "检测到 Rollup 可选依赖缺失，正在补装 @rollup/rollup-linux-x64-gnu@$rollup_opt_ver"
    (cd "$dir" && npm_cmd install --no-save "@rollup/rollup-linux-x64-gnu@$rollup_opt_ver")
  else
    echo "检测到 Rollup 可选依赖缺失，正在补装 @rollup/rollup-linux-x64-gnu（自动版本）"
    (cd "$dir" && npm_cmd install --no-save @rollup/rollup-linux-x64-gnu)
  fi
  (cd "$dir" && PATH="$NODE_RUNTIME_DIR/bin:$PATH" "$NODE_BIN" -e "$check_cmd") >/dev/null 2>&1 && return 0
  return 1
}

install_project_deps() {
  echo "[8/10] 安装 API/Web 依赖"
  npm_install_with_fallback "$API_DIR"
  npm_install_with_fallback "$WEB_DIR"
  ensure_rollup_optional_dependency "$WEB_DIR"
}

run_prisma() {
  cd "$API_DIR"
  npm_cmd run prisma:generate
  npm_cmd run prisma:deploy
}

build_project() {
  cd "$API_DIR"; npm_cmd run build
  cd "$WEB_DIR"
  if ! npm_cmd run build; then
    warn "Web 构建失败，尝试修复 Rollup 依赖后重试。"
    ensure_rollup_optional_dependency "$WEB_DIR" || true
    if ! npm_cmd run build; then
      warn "重试仍失败，重装 Web 依赖后再次构建。"
      rm -rf "$WEB_DIR/node_modules"
      npm_install_with_fallback "$WEB_DIR"
      ensure_rollup_optional_dependency "$WEB_DIR"
      npm_cmd run build
    fi
  fi
}

install_deps_migrate_build() {
  install_project_deps
  echo "  执行 Prisma 生成与迁移..."
  run_prisma
  echo "  构建 API 和 Web..."
  build_project
}

# ── [9/10] 配置 systemd API 服务 ──────────────────────────────────────────
setup_systemd_api() {
  echo "[9/10] 配置 systemd API 服务"
  local service_file="/etc/systemd/system/mindwall-api.service"

  cat > "$service_file" <<EOF
[Unit]
Description=MindWall API Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$API_DIR
ExecStart=$NODE_BIN $API_DIR/dist/src/main.js
EnvironmentFile=$API_DIR/.env
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mindwall-api

[Install]
WantedBy=multi-user.target
EOF

  as_root systemctl daemon-reload
  as_root systemctl enable mindwall-api
  as_root systemctl restart mindwall-api

  # 等待服务就绪（最多 30s）
  local waited=0
  while [[ "$waited" -lt 30 ]]; do
    if as_root systemctl is-active --quiet mindwall-api; then
      echo "  mindwall-api 服务已启动。"; return
    fi
    sleep 1; waited=$((waited + 1))
  done
  warn "mindwall-api 服务可能未正常启动，请检查: journalctl -u mindwall-api -n 50"
}

# ── [10/10] 配置 nginx ────────────────────────────────────────────────────
find_nginx_conf_dir() {
  if   [[ -d /etc/nginx/conf.d ]];       then echo "/etc/nginx/conf.d"
  elif [[ -d /etc/nginx/sites-available ]]; then echo "/etc/nginx/sites-available"
  else echo "/etc/nginx"
  fi
}

write_nginx_config() {
  echo "[10/10] 配置 nginx 反代"
  have_command nginx || die "nginx 未安装，请检查步骤 [1/10]。"

  local nginx_conf_dir; nginx_conf_dir="$(find_nginx_conf_dir)"
  local conf_file="$nginx_conf_dir/mindwall.conf"
  local web_dist="$WEB_DIR/dist"
  local server_name="${PUBLIC_HOST:-_}"

  # 使用单引号 NGINXEOF 防止 nginx 变量（如 $uri）被 bash 意外展开
  cat > "$conf_file" <<'NGINXEOF'
server {
    listen 80;
    server_name __SERVER_NAME__;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript
               text/xml application/xml text/javascript image/svg+xml;
    gzip_min_length 1024;

    # WebSocket 代理（/ws/ → NestJS 内部 WebSocket）
    location /ws/ {
        proxy_pass http://127.0.0.1:__API_PORT__/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # API 反代（/api/ → NestJS HTTP，去掉 /api 前缀）
    location /api/ {
        proxy_pass http://127.0.0.1:__API_PORT__/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_read_timeout    120s;
    }

    # 静态资源长期缓存（Vite 构建产物带 hash，永久缓存安全）
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)$ {
        root __WEB_DIST__;
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
        try_files $uri =404;
    }

    # Vue SPA（所有其他路径返回 index.html）
    root __WEB_DIST__;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINXEOF

  # 替换占位符
  sed -i "s|__SERVER_NAME__|${server_name}|g" "$conf_file"
  sed -i "s|__API_PORT__|${API_PORT}|g"       "$conf_file"
  sed -i "s|__WEB_DIST__|${web_dist}|g"       "$conf_file"

  # Debian/Ubuntu 的 sites-available/sites-enabled 布局
  if [[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]]; then
    ln -sf "$conf_file" "/etc/nginx/sites-enabled/mindwall.conf"
    # 注意：不删除 default，服务器上可能有其他项目使用 default 站点
  fi

  # RPM 系：仅当 default.conf 是 nginx 原始占位文件时才禁用（保护其他项目）
  if [[ -f /etc/nginx/conf.d/default.conf ]]; then
    if grep -q 'Welcome to nginx' /etc/nginx/conf.d/default.conf 2>/dev/null; then
      mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.disabled 2>/dev/null || true
    else
      warn "/etc/nginx/conf.d/default.conf 看起来是自定义配置，已跳过，请手动确认端口冲突。"
    fi
  fi

  nginx -t || die "nginx 配置测试失败，请检查 $conf_file"
  as_root systemctl enable nginx
  # 已运行则 reload（零停机），否则 start
  if as_root systemctl is-active --quiet nginx 2>/dev/null; then
    as_root systemctl reload nginx
  else
    as_root systemctl start nginx
  fi
  echo "  nginx 已启动，静态文件根目录: $web_dist"
}

# ── SSL（可选） ────────────────────────────────────────────────────────────
setup_ssl() {
  [[ "$ENABLE_SSL" != "1" ]] && return

  if ! have_command certbot; then
    warn "certbot 未安装，跳过 SSL 配置。可部署后手动运行: certbot --nginx -d <域名>"
    return
  fi
  if [[ -z "$PUBLIC_HOST" ]]; then
    warn "未设置 --public-host，无法申请 SSL 证书。请用 --public-host 指定域名。"
    return
  fi
  if is_ipv4 "$PUBLIC_HOST"; then
    warn "PUBLIC_HOST 为 IP 地址，Let's Encrypt 不支持 IP 证书，跳过。"
    return
  fi

  echo "申请 SSL 证书: $PUBLIC_HOST"
  certbot --nginx -d "$PUBLIC_HOST" \
    --non-interactive --agree-tos \
    --email "admin@${PUBLIC_HOST}" \
    --redirect 2>&1 || warn "SSL 证书申请失败，服务以 HTTP 继续运行。部署后可手动重试。"
}

# ── 读取已保存端口 ─────────────────────────────────────────────────────────
load_saved_ports() {
  [[ "$API_PORT_SET" == "1" ]] && return
  if [[ -f "$RUNTIME_PORTS_FILE" ]]; then
    local saved_api
    saved_api="$(grep -E '^API_PORT=' "$RUNTIME_PORTS_FILE" | tail -n 1 | cut -d= -f2- || true)"
    [[ -n "$saved_api" ]] && API_PORT="$saved_api"
  fi
}

# ── 部署完成汇总 ───────────────────────────────────────────────────────────
print_summary() {
  local host; host="$(resolve_public_host)"
  [[ -z "$host" ]] && host="<服务器IP>"
  local schema="http"; [[ "$ENABLE_SSL" == "1" ]] && schema="https"

  echo
  echo "═══════════════════════════════════════════════════"
  echo "  MindWall v$(project_version) 部署完成"
  echo "═══════════════════════════════════════════════════"
  echo "  访问地址  : ${schema}://${host}"
  echo "  API 端口  : $API_PORT（仅本机，由 nginx /api/ 代理）"
  echo "  API 日志  : journalctl -u mindwall-api -f"
  echo "  nginx 日志: tail -f /var/log/nginx/error.log"
  echo "  服务管理  : systemctl status mindwall-api"
  echo "  更新部署  : sudo bash $ROOT_DIR/update.sh"
  echo "═══════════════════════════════════════════════════"
  if is_ipv4 "$host" && is_private_ipv4 "$host"; then
    echo "  ⚠  当前为内网 IP，公网访问请设置 --public-host <域名或公网IP>"
  fi
  if [[ "$ENABLE_SSL" != "1" ]]; then
    echo "  提示: 若有域名，加 --ssl 标志可自动配置 HTTPS"
  fi
  echo
}

# ── 主流程 ────────────────────────────────────────────────────────────────
main() {
  require_root_capability
  detect_os
  detect_pkg_manager

  load_saved_ports
  validate_port "$API_PORT" || die "API 端口不合法: $API_PORT"
  check_api_port

  cd "$ROOT_DIR"
  echo "MindWall 首次部署 v$(project_version)"
  echo "目录: $ROOT_DIR"

  install_base_tools

  if [[ "$NO_DOCKER" != "1" ]]; then
    install_docker
  else
    echo "[2/10] 跳过 Docker 安装"
  fi

  ensure_local_node_runtime
  register_shortcuts
  cleanup_old_processes
  update_git_source
  ensure_runtime_files
  write_app_env_ports

  if [[ "$NO_DOCKER" != "1" ]]; then
    start_infra
  fi

  echo "[8/10] 安装依赖、Prisma 迁移、构建..."
  install_deps_migrate_build

  setup_systemd_api
  write_nginx_config
  setup_ssl
  print_summary
}

main "$@"
