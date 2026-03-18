#!/usr/bin/env bash
# 有间 卸载脚本 — 安全移除服务，不影响其他项目
# 学习自 Minimal-Server-Deploy/Server-Version/uninstall.sh
head -1 "$0"|grep -q $'\r'&&sed -i 's/\r$//' "$0"&&exec bash "$0" "$@" #
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
log_error() { echo -e "${RED}[✗]${NC} $*"; }
die()       { log_error "$*" >&2; exit 1; }

SELF="${BASH_SOURCE[0]:-$0}"
if command -v readlink >/dev/null 2>&1; then
  SELF="$(readlink -f "$SELF" 2>/dev/null || echo "$SELF")"
fi
ROOT_DIR="$(cd "$(dirname "$SELF")" && pwd)"

SYSTEMD_SERVICES=("mindwall-api" "mindwall-web")
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"
RUNTIME_DIR="$ROOT_DIR/.mw-runtime"

REMOVE_DOCKER="false"
REMOVE_DATA="false"

usage() {
  cat <<'EOF'
有间 卸载脚本

默认行为：仅停止并移除 systemd 服务，保留数据和 Docker 容器

用法:
  sudo bash uninstall.sh [选项]

选项:
  --remove-docker    同时停止并移除 Docker 容器和数据卷
  --remove-data      同时删除运行时数据（.mw-runtime）
  -h, --help         显示帮助
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remove-docker) REMOVE_DOCKER="true"; shift ;;
    --remove-data)   REMOVE_DATA="true"; shift ;;
    -h|--help)       usage; exit 0 ;;
    *) die "未知参数: $1" ;;
  esac
done

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
      die "请使用 sudo 运行此脚本"
    else
      die "请使用 root 权限运行此脚本"
    fi
  fi
}

# ─── [1/4] 停止并移除 systemd 服务 ──────────────────────────
stop_systemd_services() {
  log_warn "[1/4] 卸载 systemd 服务..."

  for service in "${SYSTEMD_SERVICES[@]}"; do
    local service_file="/etc/systemd/system/${service}.service"

    if systemctl list-unit-files 2>/dev/null | grep -q "^${service}\.service"; then
      systemctl stop "$service" 2>/dev/null || true
      systemctl disable "$service" 2>/dev/null || true
      log_info "已停止并禁用: $service"
    fi

    if [[ -f "$service_file" ]]; then
      rm -f "$service_file"
      log_info "已删除: $service_file"
    fi
  done

  systemctl daemon-reload 2>/dev/null || true
  systemctl reset-failed 2>/dev/null || true
}

# ─── [2/4] 移除 Docker 容器（可选）────────────────────────
remove_docker_if_requested() {
  log_warn "[2/4] Docker 容器..."

  if [[ "$REMOVE_DOCKER" != "true" ]]; then
    log_info "保留 Docker 容器和数据（加 --remove-docker 可移除）"
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log_warn "Docker 未安装，跳过"
    return
  fi

  if [[ -f "$COMPOSE_FILE" ]]; then
    local env_file="$ROOT_DIR/infra/.env"
    local compose_args=(-f "$COMPOSE_FILE")
    [[ -f "$env_file" ]] && compose_args+=(--env-file "$env_file")

    if docker compose version >/dev/null 2>&1; then
      docker compose "${compose_args[@]}" down -v 2>/dev/null || true
    elif command -v docker-compose >/dev/null 2>&1; then
      docker-compose "${compose_args[@]}" down -v 2>/dev/null || true
    fi
    log_info "已移除 Docker 容器和数据卷"
  fi

  # 清理可能遗留的容器
  for c in mindwall-postgres mindwall-redis; do
    if docker inspect "$c" >/dev/null 2>&1; then
      docker stop "$c" 2>/dev/null || true
      docker rm -v "$c" 2>/dev/null || true
      log_info "已移除遗留容器: $c"
    fi
  done
}

# ─── [3/4] 移除运行时数据（可选）────────────────────────────
remove_runtime_data() {
  log_warn "[3/4] 运行时数据..."

  if [[ "$REMOVE_DATA" != "true" ]]; then
    log_info "保留运行时数据 $RUNTIME_DIR（加 --remove-data 可移除）"
    return
  fi

  if [[ -d "$RUNTIME_DIR" ]]; then
    read -r -p "确认删除运行时数据 $RUNTIME_DIR？输入 YES 继续: " confirm
    if [[ "$confirm" == "YES" ]]; then
      rm -rf "$RUNTIME_DIR"
      log_info "已删除: $RUNTIME_DIR"
    else
      log_warn "已取消删除运行时数据"
    fi
  fi

  # 删除 API .env（备份应该在 .mw-runtime/backups 里）
  if [[ -f "$ROOT_DIR/apps/api/.env" ]]; then
    rm -f "$ROOT_DIR/apps/api/.env"
    log_info "已删除: apps/api/.env"
  fi
  if [[ -f "$ROOT_DIR/apps/web/.env.production.local" ]]; then
    rm -f "$ROOT_DIR/apps/web/.env.production.local"
    log_info "已删除: apps/web/.env.production.local"
  fi
}

# ─── [4/4] 移除全局快捷命令 ─────────────────────────────────
remove_global_links() {
  log_warn "[4/4] 清理全局链接..."

  if [[ -L /usr/local/bin/mw ]]; then
    local target; target="$(readlink -f /usr/local/bin/mw 2>/dev/null || true)"
    if [[ "$target" == *"$ROOT_DIR"* ]]; then
      rm -f /usr/local/bin/mw
      log_info "已移除: /usr/local/bin/mw"
    else
      log_warn "/usr/local/bin/mw 指向其他目录，未移除"
    fi
  fi
}

# ─── 报告 ────────────────────────────────────────────────────
show_result() {
  echo
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  有间 卸载完成${NC}"
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${NC}"
  echo -e "  systemd 服务:  已移除"
  if [[ "$REMOVE_DOCKER" == "true" ]]; then
    echo -e "  Docker 容器:   已移除"
  else
    echo -e "  Docker 容器:   ${YELLOW}已保留${NC}"
  fi
  if [[ "$REMOVE_DATA" == "true" ]]; then
    echo -e "  运行时数据:   已移除"
  else
    echo -e "  运行时数据:   ${YELLOW}已保留${NC}（$RUNTIME_DIR）"
  fi
  echo -e "  项目代码:     ${YELLOW}已保留${NC}（$ROOT_DIR）"
  echo
  echo -e "  如需重新安装: ${CYAN}sudo bash $ROOT_DIR/deploy.sh${NC}"
  echo
}

main() {
  echo -e "${CYAN}${BOLD}有间 卸载脚本${NC}  —  目录: $ROOT_DIR"
  require_root
  stop_systemd_services
  remove_docker_if_requested
  remove_runtime_data
  remove_global_links
  show_result
}

main "$@"
