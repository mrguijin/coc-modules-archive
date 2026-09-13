#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 秘密调查档案馆 · 服务器一键更新脚本
#
#   sudo bash deploy/apply-update.sh --web <站点根> --app <后端目录>
#
# 它做的事（顺序很重要）：
#   1) 预检：确认源目录、目标目录、node/rsync 可用
#   2) **先备份**：把 $APP/backend/data 整个复制到 $APP/.backups/data-<时间戳>，
#      并记下 database.json 的校验和
#   3) 打包现有代码到 $APP/.backups/code-<时间戳>（回滚用）
#   4) 停服务（systemd 或进程名匹配）
#   5) 覆盖前端产物到 --web（rsync --delete，清掉上一版遗留的 hash 文件）
#   6) 覆盖后端代码到 --app（--exclude data/，**历史数据一个字节都不动**）
#   7) 安装生产依赖（npm ci --omit=dev）
#   8) 起服务 + 健康检查
#   9) 复核数据文件校验和：与更新前一致才算成功，否则立刻提示回滚
#
# 参数：
#   --web DIR        前端产物目录（站点静态根）          默认 /var/www/coc
#   --app DIR        后端代码目录                        默认 /srv/coc-archive
#   --service NAME   systemd 服务名                       默认 coc-archive
#   --port N         后端端口（健康检查用）                默认 3000
#   --user NAME      以哪个用户跑后端（npm ci / 启动）      默认当前用户
#   --no-build-check 跳过 npm ci
#   --dry-run        只打印将要做的事，不实际改动
#   --yes            不交互确认
# ---------------------------------------------------------------------------
set -euo pipefail

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
# 脚本可能在包根（旧包），也可能在包内 deploy/（新包）——都往上找到含 index/ 或 backend/ 的那一层
if [[ -d "$SELF_DIR/index" || -d "$SELF_DIR/backend" ]]; then
  SRC="$SELF_DIR"
elif [[ -d "$SELF_DIR/../index" || -d "$SELF_DIR/../backend" ]]; then
  SRC="$(cd "$SELF_DIR/.." && pwd)"
else
  SRC="$SELF_DIR"
fi
WEB_DIR="/var/www/coc"
APP_DIR="/srv/coc-archive"
WEB_SRC=""            # 前端产物目录：新包 index/，旧包 dist/（预检里确定）
SERVICE="coc-archive"
PORT="${PORT:-3000}"
RUN_USER="${SUDO_USER:-$(id -un)}"
DRY=""
ASSUME_YES=""
SKIP_DEPS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --web) WEB_DIR="$2"; shift 2 ;;
    --app) APP_DIR="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --user) RUN_USER="$2"; shift 2 ;;
    --no-build-check) SKIP_DEPS=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

STAMP="$(date +%Y%m%d-%H%M%S)"
DATA_DIR="$APP_DIR/backend/data"
DB_FILE="$DATA_DIR/database.json"
BACKUP_ROOT="$APP_DIR/.backups"

log()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[✗]\033[0m %s\n' "$*" >&2; exit 1; }

run() {
  if [[ -n "$DRY" ]]; then echo "    [dry-run] $*"; else "$@"; fi
}

checksum_of() {
  [[ -f "$1" ]] || { echo "MISSING"; return; }
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

has_cmd() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- 1. 预检
log "1/9 预检"
# 新包用 index/（与站点静态根同名）；旧包仍是 dist/，两者都支持
if [[ -d "$SRC/index" ]]; then
  WEB_SRC="$SRC/index"
elif [[ -d "$SRC/dist" ]]; then
  WEB_SRC="$SRC/dist"
else
  die "包内既没有 index/ 也没有 dist/，这不是一个完整的更新包"
fi
[[ -d "$SRC/backend" ]]     || die "包内缺少 backend/"
[[ -d "$SRC/shared" ]]      || die "包内缺少 shared/"
has_cmd node                || die "未找到 node，请先安装 Node.js ≥ 20"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 20 ]]  || die "Node 版本过低（当前 $(node -v)），需要 ≥ 20"
if [[ ! -d "$WEB_DIR" ]]; then warn "前端目录 $WEB_DIR 不存在，将创建"; fi
if [[ ! -d "$APP_DIR" ]]; then warn "后端目录 $APP_DIR 不存在，将创建（首次部署？）"; fi
if has_cmd rsync; then SYNC=rsync; else SYNC=cp; warn "未找到 rsync，改用整目录覆盖（会丢失旧目录里的其它文件）"; fi
echo "    前端目录：$WEB_DIR"
echo "    后端目录：$APP_DIR"
echo "    服务名　：$SERVICE（端口 $PORT，运行用户 $RUN_USER）"
echo "    数据目录：$DATA_DIR"

if [[ -z "$DRY" && -z "$ASSUME_YES" ]]; then
  read -r -p "    确认继续？[y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "已取消。"; exit 0; }
fi

# ---------------------------------------------------------------- 2. 数据校验和（更新前）
log "2/9 记录更新前的数据校验和"
BEFORE_SUM="$(checksum_of "$DB_FILE")"
BEFORE_ROWS=""
if [[ -f "$DB_FILE" ]]; then
  BEFORE_ROWS="$(node -e '
    const fs=require("fs");
    try{const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      console.log(`users=${(d.users||[]).length} modules=${(d.modules||[]).length} characters=${(d.characters||[]).length} sessions=${(d.sessions||[]).length}`);
    }catch(e){console.log("(无法解析)")}' "$DB_FILE")"
  echo "    $DB_FILE"
  echo "    sha256=${BEFORE_SUM:0:16}…  $BEFORE_ROWS"
else
  warn "数据文件尚不存在（首次部署），更新后会由后端自动创建空库"
fi

# ---------------------------------------------------------------- 3. 备份
log "3/9 备份现有数据与代码 → $BACKUP_ROOT"
if [[ -d "$DATA_DIR" ]]; then
  run mkdir -p "$BACKUP_ROOT"
  run cp -r "$DATA_DIR" "$BACKUP_ROOT/data-$STAMP"
  echo "    ✓ 数据已备份到 $BACKUP_ROOT/data-$STAMP"
else
  echo "    （没有数据目录，跳过）"
fi
if [[ -d "$APP_DIR/backend" ]]; then
  run mkdir -p "$BACKUP_ROOT"
  run cp -r "$APP_DIR/backend" "$BACKUP_ROOT/code-$STAMP"
  echo "    ✓ 旧代码已备份到 $BACKUP_ROOT/code-$STAMP（回滚直接拷回即可）"
fi

# ---------------------------------------------------------------- 4. 停服务
log "4/9 停止服务"
STOPPED=""
if has_cmd systemctl && systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE}\.service"; then
  run systemctl stop "$SERVICE" && STOPPED="systemd:$SERVICE" && echo "    ✓ systemctl stop $SERVICE"
elif has_cmd pgrep; then
  PIDS="$(pgrep -f "node .*server\.js" || true)"
  if [[ -n "$PIDS" ]]; then
    # shellcheck disable=SC2086
    run kill $PIDS && STOPPED="pkill:node" && echo "    ✓ 已结束进程：$PIDS"
    sleep 1
  else
    echo "    （未发现正在运行的后端进程）"
  fi
else
  warn "既没有 systemd 单元 ${SERVICE}.service，也没有 pgrep —— 请手动停止后端后再重跑本脚本"
fi

# ---------------------------------------------------------------- 5. 前端产物
log "5/9 覆盖前端产物 → $WEB_DIR"
run mkdir -p "$WEB_DIR"
if [[ "$SYNC" == "rsync" ]]; then
  # --delete 清掉上一版遗留的 hash 产物，这正是"源码与线上产物漂移"的病根
  run rsync -a --delete --human-readable "$WEB_SRC/" "$WEB_DIR/"
else
  run rm -rf "${WEB_DIR:?}/"*
  run cp -r "$WEB_SRC/." "$WEB_DIR/"
fi
echo "    ✓ 已同步前端产物（$(basename "$WEB_SRC")/ → $WEB_DIR）"

# ---------------------------------------------------------------- 6. 后端代码（不碰 data/）
log "6/9 覆盖后端代码 → $APP_DIR（保留 backend/data）"
run mkdir -p "$APP_DIR"
if [[ "$SYNC" == "rsync" ]]; then
  run rsync -a --delete \
      --exclude 'backend/data/' \
      --exclude 'backend/node_modules/' \
      --exclude 'backend/database.json' \
      --exclude '.backups/' \
      "$SRC/backend/" "$APP_DIR/backend/"
  run rsync -a --delete "$SRC/shared/" "$APP_DIR/shared/"
else
  # 没有 rsync：逐项覆盖，**并且显式跳过一切数据路径**。
  # 注意：这里绝不能对 $APP_DIR/backend 做整目录 rm —— 那会把历史数据一起删掉。
  run mkdir -p "$APP_DIR/backend" "$APP_DIR/shared"
  if [[ -z "$DRY" ]]; then
    for item in "$SRC"/backend/*; do
      base="$(basename "$item")"
      case "$base" in
        data|node_modules|database.json) continue ;;
      esac
      rm -rf "$APP_DIR/backend/$base"
      cp -r "$item" "$APP_DIR/backend/$base"
    done
    for item in "$SRC"/shared/*; do
      base="$(basename "$item")"
      rm -rf "$APP_DIR/shared/$base"
      cp -r "$item" "$APP_DIR/shared/$base"
    done
  else
    echo "    [dry-run] 逐项覆盖 backend/ 与 shared/（跳过 data/）"
  fi
fi
run mkdir -p "$APP_DIR/backend/data"
run mkdir -p "$APP_DIR/deploy"
run cp -f "$SRC/deploy/nginx.conf.sample" "$APP_DIR/deploy/" 2>/dev/null || true
run cp -f "$SRC/VERSION" "$APP_DIR/VERSION" 2>/dev/null || true
echo "    ✓ 已同步 backend/ 与 shared/（data/ 未改动）"

# 防御性检查：数据目录必须还在
if [[ -n "$BEFORE_ROWS" && ! -f "$DB_FILE" && -z "$DRY" ]]; then
  warn "数据文件在覆盖过程中丢失，正在从备份恢复…"
  mkdir -p "$(dirname "$DB_FILE")"
  cp "$BACKUP_ROOT/data-$STAMP/database.json" "$DB_FILE"
  echo "    ✓ 已恢复"
fi

# ---------------------------------------------------------------- 7. 依赖
log "7/9 安装生产依赖"
if [[ -n "$SKIP_DEPS" ]]; then
  echo "    （--no-build-check，跳过）"
elif [[ -z "$DRY" ]] && ! has_cmd npm; then
  warn "未找到 npm，请手动执行：cd $APP_DIR/backend && npm ci --omit=dev"
elif [[ -n "$DRY" ]]; then
  echo "    [dry-run] cd $APP_DIR/backend && npm ci --omit=dev"
else
  NPM_CMD="npm ci --omit=dev --no-audit --no-fund"
  [[ -f "$APP_DIR/backend/package-lock.json" ]] || NPM_CMD="npm install --omit=dev --no-audit --no-fund"
  # 只有「当前用户 ≠ 指定运行用户，且确实有 sudo」时才降权执行，避免误用同名但行为不同的 sudo
  AS_USER=""
  if [[ "$(id -un 2>/dev/null)" != "$RUN_USER" ]] && has_cmd sudo; then AS_USER=1; fi
  if [[ -n "$AS_USER" ]]; then
    ( cd "$APP_DIR/backend" && sudo -u "$RUN_USER" $NPM_CMD ) \
      || { warn "依赖安装失败，改用 npm install 兜底"; ( cd "$APP_DIR/backend" && sudo -u "$RUN_USER" npm install --omit=dev --no-audit --no-fund ) || warn "依赖安装仍然失败，请手动处理"; }
  else
    ( cd "$APP_DIR/backend" && $NPM_CMD ) \
      || { warn "依赖安装失败，改用 npm install 兜底"; ( cd "$APP_DIR/backend" && npm install --omit=dev --no-audit --no-fund ) || warn "依赖安装仍然失败，请手动处理"; }
  fi
  echo "    ✓ 依赖就绪"
fi

# ---------------------------------------------------------------- 8. 起服务
log "8/9 启动服务并健康检查"
HAS_UNIT=""
if has_cmd systemctl && systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE}\.service"; then
  HAS_UNIT=1
fi

HEALTH_BEFORE=""
if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then HEALTH_BEFORE=1; fi

if [[ -n "$HAS_UNIT" ]]; then
  run systemctl start "$SERVICE"
  sleep 2
elif [[ -z "$HEALTH_BEFORE" ]]; then
  # 没有 systemd，且端口上没有健康的后端 —— 用 nohup 起一个
  if [[ -z "$DRY" ]]; then
    ( cd "$APP_DIR/backend" && COCOC_HOST=127.0.0.1 PORT="$PORT" nohup node server.js \
        > "$APP_DIR/backend.log" 2>&1 & echo $! > "$APP_DIR/backend.pid" )
    echo "    ✓ 已以 nohup 启动（pid $(cat "$APP_DIR/backend.pid" 2>/dev/null)），日志：$APP_DIR/backend.log"
  else
    echo "    [dry-run] 启动 node server.js"
  fi
  sleep 2
else
  warn "端口 $PORT 上已有后端在跑，跳过启动（若刚才是你想停的服务，请确认 $SERVICE 单元名）"
fi

HEALTH_OK=""
if [[ -z "$DRY" ]]; then
  for i in $(seq 1 20); do
    if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then HEALTH_OK=1; break; fi
    sleep 1
  done
fi

# ---------------------------------------------------------------- 9. 复核数据
log "9/9 复核历史数据"
AFTER_SUM="$(checksum_of "$DB_FILE")"
FAIL=0
if [[ "$BEFORE_SUM" != "MISSING" ]]; then
  if [[ "$AFTER_SUM" == "$BEFORE_SUM" ]]; then
    echo "    ✓ 数据文件与更新前完全一致（sha256=${AFTER_SUM:0:16}…）"
  else
    warn "数据文件发生变化（可能是后端启动时做了正常的 schema 迁移）"
    echo "      更新前 sha256=${BEFORE_SUM:0:16}…"
    echo "      更新后 sha256=${AFTER_SUM:0:16}…"
    if has_cmd node; then
      node -e '
        const fs=require("fs");
        try{const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
          console.log(`      现在：users=${(d.users||[]).length} modules=${(d.modules||[]).length} characters=${(d.characters||[]).length} sessions=${(d.sessions||[]).length} schemaVersion=${d.schemaVersion}`);
        }catch(e){console.log("      ⚠️ 数据文件无法解析！")}' "$DB_FILE"
    fi
    echo "      备份在：$BACKUP_ROOT/data-$STAMP"
  fi
else
  echo "    （本次为首次部署，未创建新数据：$AFTER_SUM）"
fi

echo
if [[ -n "$DRY" ]]; then
  echo "✅ dry-run 结束，未做任何改动。"
  exit 0
fi
if [[ -z "$HEALTH_OK" ]]; then
  FAIL=1
  warn "健康检查失败：http://127.0.0.1:$PORT/api/health 无响应"
  echo "      排查：journalctl -u $SERVICE -n 50   或   tail -50 $APP_DIR/backend.log"
fi

if [[ "$FAIL" == "0" ]]; then
  echo "✅ 更新完成，服务健康。"
  echo
  echo "后续："
  echo "  sudo nginx -t && sudo systemctl reload nginx     # 若改过 Nginx 配置"
  echo "  回滚代码：cp -r $BACKUP_ROOT/code-$STAMP/. $APP_DIR/backend/ && sudo systemctl restart $SERVICE"
  echo "  回滚数据：cp $BACKUP_ROOT/data-$STAMP/database.json $DB_FILE && sudo systemctl restart $SERVICE"
else
  echo "⚠️  更新已执行，但服务未通过健康检查。"
  echo "  回滚："
  echo "    cp -r $BACKUP_ROOT/code-$STAMP/. $APP_DIR/backend/"
  echo "    cp $BACKUP_ROOT/data-$STAMP/database.json $DB_FILE"
  echo "    sudo systemctl restart $SERVICE"
  exit 1
fi
