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
TARGET_NODE_MAJOR="${TARGET_NODE_MAJOR:-20}"
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
  --branch <name>      指定分支，默认 main
  --web-port <port>    Web 端口，默认 3001
  --skip-git           跳过 git 拉取
  --no-docker          跳过 Docker 启动
  --yes                非交互模式
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

detect_os() {
  if [[ -f /etc/os-release ]]; then
    local id_raw=""
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
    die "未检测到支持的包管理器(apt/dnf/yum/zypper/pacman)。"
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
  echo "[1/10] 安装基础工具"
  refresh_pkg_index
  case "$PKG_MANAGER" in
    apt)
      install_packages ca-certificates curl git tar xz-utils gnupg lsb-release
      ;;
    dnf|yum)
      install_packages ca-certificates curl git tar xz
      ;;
    zypper|pacman)
      install_packages ca-certificates curl git tar xz
      ;;
  esac
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

install_docker() {
  echo "[2/10] 安装 Docker"
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
  if ! docker_compose_available; then
    die "Docker Compose 不可用。"
  fi
}

node_major_installed() {
  if ! have_command node; then
    echo 0
    return
  fi
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0
}

install_node_from_binary() {
  local target_major="$1"
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) warn "不支持的 CPU 架构: $arch"; return 1 ;;
  esac

  local versions=("20.18.3" "20.17.0")
  local mirrors=("https://npmmirror.com/mirrors/node" "https://nodejs.org/dist")

  if [[ "$target_major" -lt 20 ]]; then
    versions=("18.20.8" "18.20.7")
  fi

  local tmpdir ok
  tmpdir="$(mktemp -d)"
  ok=0

  for ver in "${versions[@]}"; do
    local file
    file="node-v${ver}-linux-${arch}.tar.xz"
    for mirror in "${mirrors[@]}"; do
      local url
      url="${mirror}/v${ver}/${file}"
      if curl -fsSL "$url" -o "${tmpdir}/node.tar.xz"; then
        as_root mkdir -p /usr/local/nodejs
        if as_root tar -xJf "${tmpdir}/node.tar.xz" -C /usr/local/nodejs; then
          local install_dir
          install_dir="/usr/local/nodejs/node-v${ver}-linux-${arch}"
          as_root ln -sfn "${install_dir}/bin/node" /usr/local/bin/node
          as_root ln -sfn "${install_dir}/bin/npm" /usr/local/bin/npm
          as_root ln -sfn "${install_dir}/bin/npx" /usr/local/bin/npx
          if [[ -x "${install_dir}/bin/corepack" ]]; then
            as_root ln -sfn "${install_dir}/bin/corepack" /usr/local/bin/corepack
          fi
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
  hash -r || true
  [[ "$ok" -eq 1 ]]
}

install_nodejs() {
  echo "[3/10] 安装 Node.js 与 npm"
  detect_pkg_manager

  if have_command node && have_command npm && [[ "$(node_major_installed)" -ge "$TARGET_NODE_MAJOR" ]]; then
    echo "Node.js 已满足要求: $(node -v)"
    return
  fi

  case "$PKG_MANAGER" in
    apt|dnf|yum|zypper|pacman)
      install_packages nodejs npm || install_packages nodejs || true
      ;;
  esac

  if ! have_command node || ! have_command npm || [[ "$(node_major_installed)" -lt "$TARGET_NODE_MAJOR" ]]; then
    echo "系统仓库版本不足，尝试安装官方 Node.js 二进制"
    install_node_from_binary "$TARGET_NODE_MAJOR" || true
  fi

  have_command node || die "Node.js 安装失败。"
  have_command npm || die "npm 安装失败。"

  if [[ "$(node_major_installed)" -lt "$TARGET_NODE_MAJOR" ]]; then
    warn "当前 Node.js 版本 $(node -v) 低于目标 v${TARGET_NODE_MAJOR}。"
  fi
}

install_pm2() {
  echo "[4/10] 安装 pm2"
  if have_command pm2; then
    echo "pm2 已安装"
    return
  fi
  if [[ "$(id -u)" -eq 0 ]]; then
    npm install -g pm2
  else
    as_root npm install -g pm2 || npm install -g pm2
  fi
}

register_commands() {
  echo "[5/10] 注册 deploy/update 命令"
  as_root chmod 755 "$ROOT_DIR/deploy.sh" "$ROOT_DIR/update.sh" "$ROOT_DIR/mw"

  local wrap1 wrap2
  wrap1="$(mktemp)"
  wrap2="$(mktemp)"

  cat > "$wrap1" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec bash "$ROOT_DIR/deploy.sh" "\$@"
EOF
  cat > "$wrap2" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec bash "$ROOT_DIR/update.sh" "\$@"
EOF

  as_root install -m 755 "$wrap1" /usr/local/bin/mw-deploy
  as_root install -m 755 "$wrap2" /usr/local/bin/mw-update
  rm -f "$wrap1" "$wrap2"
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
    warn "检测到本地改动，首次部署保留本地文件并跳过 git pull。"
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
    echo "[6/10] 跳过 Docker 启动"
    return
  fi
  echo "[6/10] 启动 PostgreSQL + Redis"
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

install_project_deps() {
  echo "[7/10] 安装 API/Web 依赖"
  npm_install_with_fallback "$API_DIR"
  npm_install_with_fallback "$WEB_DIR"
}

run_prisma() {
  echo "[8/10] 执行 Prisma 生成与迁移"
  cd "$API_DIR"
  npm run prisma:generate
  npm run prisma:deploy
}

build_project() {
  echo "[9/10] 构建 API/Web"
  cd "$API_DIR"
  npm run build
  cd "$WEB_DIR"
  npm run build
}

start_services() {
  echo "[10/10] 启动 PM2 服务"
  pm2 describe mindwall-api >/dev/null 2>&1 || \
    pm2 start npm --name mindwall-api --cwd "$API_DIR" -- run start:prod
  pm2 restart mindwall-api --update-env

  pm2 describe mindwall-web >/dev/null 2>&1 || \
    pm2 start npm --name mindwall-web --cwd "$WEB_DIR" -- run start -- --host 0.0.0.0 --port "$WEB_PORT"
  pm2 restart mindwall-web --update-env
  pm2 save
}

print_summary() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  ip="${ip:-<服务器IP>}"

  echo
  echo "部署完成，版本: v$(get_version)"
  echo "Web: http://${ip}:${WEB_PORT}"
  echo "更新命令: mw-update 或 sudo bash update.sh"
}

main() {
  require_root_capability
  detect_os
  detect_pkg_manager

  echo "MindWall 首次部署 v$(get_version)"
  echo "目录: $ROOT_DIR"

  install_base_tools
  if [[ "$NO_DOCKER" != "1" ]]; then
    install_docker
  else
    echo "[2/10] 跳过 Docker 安装"
  fi
  install_nodejs
  install_pm2
  register_commands
  update_git_source
  ensure_runtime_files
  start_infra
  install_project_deps
  run_prisma
  build_project
  start_services
  print_summary
}

main "$@"
