#!/usr/bin/env bash
# MindWall 更新脚本 — 快速更新（跳过系统依赖安装）
# 等价于 deploy.sh --skip-system-install，但增加更新前备份提示
head -1 "$0"|grep -q $'\r'&&sed -i 's/\r$//' "$0"&&exec bash "$0" "$@" #
set -euo pipefail

GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SELF="${BASH_SOURCE[0]:-$0}"
if command -v readlink >/dev/null 2>&1; then
  SELF="$(readlink -f "$SELF" 2>/dev/null || echo "$SELF")"
fi

ROOT_DIR="$(cd "$(dirname "$SELF")" && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/deploy.sh"
VERSION_FILE="$ROOT_DIR/VERSION"

project_version() {
  [[ -f "$VERSION_FILE" ]] && tr -d '[:space:]' < "$VERSION_FILE" || echo "未知"
}

usage() {
  cat <<'EOF'
MindWall 更新脚本

用法:
  sudo bash update.sh [选项]

说明:
  默认快速更新（跳过系统依赖安装）。
  加 --full 执行完整部署（含系统依赖检查）。

选项:
  --full                  完整更新（含系统依赖）
  --branch <name>         Git 分支
  --api-port <port>       API 端口
  --web-port <port>       Web 端口
  --pg-port <port>        PostgreSQL 映射端口
  --redis-port <port>     Redis 映射端口
  --public-host <host>    域名或公网 IP
  --skip-git              跳过 Git 拉取
  --no-docker             跳过 Docker
  --yes                   非交互模式
  -h, --help              显示帮助
EOF
}

if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help|help) usage; exit 0 ;;
  esac
fi

[[ -f "$DEPLOY_SCRIPT" ]] || {
  echo "错误: 找不到部署脚本 $DEPLOY_SCRIPT" >&2
  exit 1
}

FULL_MODE=0
FORWARD_ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--full" ]]; then
    FULL_MODE=1
    continue
  fi
  FORWARD_ARGS+=("$arg")
done

echo -e "${CYAN}${BOLD}MindWall 更新脚本${NC} v$(project_version)"
echo -e "目录: $ROOT_DIR"

if [[ "$FULL_MODE" == "1" ]]; then
  echo -e "模式: ${GREEN}完整更新${NC}（含系统依赖检查）"
  exec bash "$DEPLOY_SCRIPT" "${FORWARD_ARGS[@]}"
else
  echo -e "模式: ${GREEN}快速更新${NC}（跳过系统依赖安装）"
  exec bash "$DEPLOY_SCRIPT" --skip-system-install "${FORWARD_ARGS[@]}"
fi
