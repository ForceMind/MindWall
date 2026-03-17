#!/usr/bin/env bash
# MindWall 鏇存柊鑴氭湰 鈥?蹇€熸洿鏂帮紙璺宠繃绯荤粺渚濊禆瀹夎锛?# 绛変环浜?deploy.sh --skip-system-install锛屼絾澧炲姞鏇存柊鍓嶅浠芥彁绀?head -1 "$0"|grep -q $'\r'&&sed -i 's/\r$//' "$0"&&exec bash "$0" "$@" #
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
  [[ -f "$VERSION_FILE" ]] && tr -d '[:space:]' < "$VERSION_FILE" || echo "鏈煡"
}

usage() {
  cat <<'EOF'
MindWall 鏇存柊鑴氭湰

鐢ㄦ硶:
  sudo bash update.sh [閫夐」]

璇存槑:
  榛樿蹇€熸洿鏂帮紙璺宠繃绯荤粺渚濊禆瀹夎锛夈€?  鍔?--full 鎵ц瀹屾暣閮ㄧ讲锛堝惈绯荤粺渚濊禆妫€鏌ワ級銆?
閫夐」:
  --full                  瀹屾暣鏇存柊锛堝惈绯荤粺渚濊禆锛?  --branch <name>         Git 鍒嗘敮
  --api-port <port>       API 绔彛
  --web-port <port>       Web 绔彛
  --pg-port <port>        PostgreSQL 鏄犲皠绔彛
  --redis-port <port>     Redis 鏄犲皠绔彛
  --public-host <host>    鍩熷悕鎴栧叕缃?IP
  --skip-git              璺宠繃 Git 鎷夊彇
  --no-docker             璺宠繃 Docker
  --yes                   闈炰氦浜掓ā寮?  -h, --help              鏄剧ず甯姪
EOF
}

if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help|help) usage; exit 0 ;;
  esac
fi

[[ -f "$DEPLOY_SCRIPT" ]] || {
  echo "閿欒: 鎵句笉鍒伴儴缃茶剼鏈?$DEPLOY_SCRIPT" >&2
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

echo -e "${CYAN}${BOLD}MindWall 鏇存柊鑴氭湰${NC} v$(project_version)"
echo -e "鐩綍: $ROOT_DIR"

if [[ "$FULL_MODE" == "1" ]]; then
  echo -e "妯″紡: ${GREEN}瀹屾暣鏇存柊${NC}锛堝惈绯荤粺渚濊禆妫€鏌ワ級"
  exec bash "$DEPLOY_SCRIPT" "${FORWARD_ARGS[@]}"
else
  echo -e "妯″紡: ${GREEN}蹇€熸洿鏂?{NC}锛堣烦杩囩郴缁熶緷璧栧畨瑁咃級"
  exec bash "$DEPLOY_SCRIPT" --skip-system-install "${FORWARD_ARGS[@]}"
fi
