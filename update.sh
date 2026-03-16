#!/usr/bin/env bash
set -euo pipefail

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
    echo "未知"
  fi
}

usage() {
  cat <<'EOF'
MindWall 更新脚本

用法:
  sudo bash update.sh [选项]

说明:
  默认执行快速更新（等价于 deploy.sh + --skip-system-install）。
  如果需要完整重装依赖，请加 --full。

选项:
  --full                  使用完整部署流程（不跳过系统依赖安装）
  --branch <name>         Git 分支
  --api-port <port>       API 端口
  --web-port <port>       Web 端口
  --public-host <host>    域名或公网 IP
  --skip-git              跳过 Git 拉取
  --no-docker             跳过 Docker
  --ssl                   尝试配置 HTTPS
  --yes                   非交互模式
  -h, --help              显示帮助
EOF
}

if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help|help)
      usage
      exit 0
      ;;
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

echo "MindWall 更新脚本 v$(project_version)"
echo "目录: $ROOT_DIR"

if [[ "$FULL_MODE" == "1" ]]; then
  echo "模式: 完整更新（含系统依赖检查）"
  exec bash "$DEPLOY_SCRIPT" "${FORWARD_ARGS[@]}"
else
  echo "模式: 快速更新（跳过系统依赖安装）"
  exec bash "$DEPLOY_SCRIPT" --skip-system-install "${FORWARD_ARGS[@]}"
fi
