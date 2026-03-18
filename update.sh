#!/usr/bin/env bash
if head -n 1 "$0" | grep -q $'\r'; then
  sed -i 's/\r$//' "$0"
  exec bash "$0" "$@"
fi

set -euo pipefail

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
  if [[ -f "$VERSION_FILE" ]]; then
    tr -d '[:space:]' < "$VERSION_FILE"
  else
    echo "unknown"
  fi
}

usage() {
  cat <<'EOF'
有间 更新脚本

用法:
  sudo bash update.sh [选项]

默认行为:
  自动附加 --skip-system-install（即只更新代码、依赖、构建、服务）

选项:
  --full          完整模式（包含系统依赖检查安装）
  其余参数会透传给 deploy.sh，例如:
    --branch dev
    --api-port 3101
    --web-port 3002
    --public-host mindwall.example.com
EOF
}

[[ -f "$DEPLOY_SCRIPT" ]] || {
  echo "错误: 未找到 $DEPLOY_SCRIPT" >&2
  exit 1
}

if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help|help)
      usage
      exit 0
      ;;
  esac
fi

FULL_MODE=0
FORWARD_ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--full" ]]; then
    FULL_MODE=1
    continue
  fi
  FORWARD_ARGS+=("$arg")
done

echo -e "${CYAN}${BOLD}有间 更新脚本${NC} v$(project_version)"
echo "目录: $ROOT_DIR"

if [[ "$FULL_MODE" == "1" ]]; then
  echo "模式: 完整更新（会检查系统依赖）"
  exec bash "$DEPLOY_SCRIPT" "${FORWARD_ARGS[@]}"
else
  echo "模式: 快速更新（默认跳过系统依赖安装）"
  exec bash "$DEPLOY_SCRIPT" --skip-system-install "${FORWARD_ARGS[@]}"
fi