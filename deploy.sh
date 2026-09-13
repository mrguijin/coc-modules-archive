#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 前端构建与部署脚本 —— 解决「源码与线上产物漂移」问题（旧版本靠手工拷贝 dist）。
#
# 用法：
#   bash deploy.sh [目标目录] [--dry-run]
#   例：bash deploy.sh <站点静态根>
#
# 做的事：
#   1) 校验工作区干净（有未提交改动时提示，避免把半成品发上去）
#   2) npm ci / npm install 后构建
#   3) 用 rsync 以 --delete 同步到目标目录（先删后传，杜绝新旧 hash 产物混堆）
#   4) 提示重载 Nginx
# ---------------------------------------------------------------------------
set -euo pipefail

TARGET="${1:-}"
DRY=""
[[ "${2:-}" == "--dry-run" ]] && DRY="--dry-run"

if [[ -z "$TARGET" ]]; then
  echo "用法：bash deploy.sh <目标目录> [--dry-run]" >&2
  exit 2
fi

cd "$(dirname "$0")"

echo "==> 1/4 检查工作区状态"
if command -v git >/dev/null 2>&1 && [[ -d .git ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "    ⚠️  存在未提交的改动，确认这是你要发布的版本。"
    git status --short | head -20
    read -r -p "    继续？[y/N] " ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] || exit 1
  fi
else
  echo "    （非 git 仓库，跳过）"
fi

echo "==> 2/4 安装依赖"
if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
( cd backend && ([[ -f package-lock.json ]] && npm ci --no-audit --no-fund || npm install --no-audit --no-fund) )

echo "==> 3/4 静态检查 + 构建"
npm run lint
npm run build

echo "==> 4/4 同步到 $TARGET ${DRY:+(dry-run)}"
mkdir -p "$TARGET"
if command -v rsync >/dev/null 2>&1; then
  # --delete 会清掉上一版遗留的 hash 产物，这正是旧部署方式的问题根源
  rsync -a --delete --human-readable $DRY dist/ "$TARGET/"
else
  echo "    未找到 rsync，改用整目录替换"
  if [[ -z "$DRY" ]]; then
    rm -rf "${TARGET:?}/"*
    cp -r dist/. "$TARGET/"
  fi
fi

echo
echo "✅ 完成。请确认 Nginx 配置指向 $TARGET，然后执行："
echo "     sudo nginx -t && sudo systemctl reload nginx"
echo
echo "后端进程建议以 COCOC_HOST=127.0.0.1 启动（见 deploy/nginx.conf.sample）："
echo "     COCOC_HOST=127.0.0.1 PORT=3000 npm --prefix backend start"
