#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$ROOT_DIR/VERSION"
OUTPUT_DIR="${OUTPUT_DIR:-release}"
INPUT_VERSION="${VERSION:-}"

resolve_version() {
  local candidate="${INPUT_VERSION//[[:space:]]/}"
  if [[ -n "$candidate" ]]; then
    if [[ "$candidate" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]]; then
      echo "$candidate"
      return
    fi
    echo "Version 参数格式不正确：$candidate"
    exit 1
  fi

  if [[ ! -f "$VERSION_FILE" ]]; then
    echo "找不到 VERSION 文件：$VERSION_FILE"
    exit 1
  fi

  candidate="$(tr -d '[:space:]' < "$VERSION_FILE")"
  if [[ ! "$candidate" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]]; then
    echo "VERSION 文件格式不正确：$candidate"
    exit 1
  fi
  echo "$candidate"
}

VERSION_VALUE="$(resolve_version)"
RELEASE_ROOT="$ROOT_DIR/$OUTPUT_DIR"
STAGE_ROOT="$(mktemp -d)"
STAGE_DIR="$STAGE_ROOT/mindwall-v$VERSION_VALUE"
ZIP_NAME="mindwall-v$VERSION_VALUE-minimal.tar.gz"
ZIP_PATH="$RELEASE_ROOT/$ZIP_NAME"
SHA_PATH="$ZIP_PATH.sha256"

INCLUDE_LIST=(
  "VERSION"
  "README.md"
  "LICENSE"
  ".env.example"
  "docs"
  "infra"
  "scripts"
  "apps/api/.env.example"
  "apps/api/package.json"
  "apps/api/package-lock.json"
  "apps/api/tsconfig.json"
  "apps/api/tsconfig.build.json"
  "apps/api/nest-cli.json"
  "apps/api/prisma.config.ts"
  "apps/api/src"
  "apps/api/prisma"
  "apps/api/scripts"
  "apps/api/config/runtime-config.example.json"
  "apps/web/.env.local.example"
  "apps/web/package.json"
  "apps/web/package-lock.json"
  "apps/web/index.html"
  "apps/web/vite.config.ts"
  "apps/web/tsconfig.json"
  "apps/web/tsconfig.app.json"
  "apps/web/tsconfig.node.json"
  "apps/web/src"
  "apps/web/public"
)

echo "开始生成 有间 最小发布包 v$VERSION_VALUE"
mkdir -p "$RELEASE_ROOT" "$STAGE_DIR"

for item in "${INCLUDE_LIST[@]}"; do
  src="$ROOT_DIR/$item"
  dst="$STAGE_DIR/$item"
  if [[ ! -e "$src" ]]; then
    echo "缺少必要文件：$item"
    rm -rf "$STAGE_ROOT"
    exit 1
  fi

  mkdir -p "$(dirname "$dst")"
  cp -R "$src" "$dst"
done

rm -rf \
  "$STAGE_DIR/.git" \
  "$STAGE_DIR/apps/api/config/runtime-config.json" \
  "$STAGE_DIR/apps/api/logs" \
  "$STAGE_DIR/apps/api/node_modules" \
  "$STAGE_DIR/apps/api/dist" \
  "$STAGE_DIR/apps/web/node_modules" \
  "$STAGE_DIR/apps/web/dist" \
  "$STAGE_DIR/release"

rm -f "$ZIP_PATH" "$SHA_PATH"
tar -C "$STAGE_ROOT" -czf "$ZIP_PATH" "mindwall-v$VERSION_VALUE"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$ZIP_PATH" > "$SHA_PATH"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$ZIP_PATH" > "$SHA_PATH"
else
  echo "未找到 sha256sum/shasum，跳过校验文件生成。"
fi

echo "发布包已生成：$ZIP_PATH"
if [[ -f "$SHA_PATH" ]]; then
  echo "校验文件已生成：$SHA_PATH"
fi
echo "说明：该发布包不包含本地运行时数据（API Key、日志、node_modules、dist）。"

rm -rf "$STAGE_ROOT"
