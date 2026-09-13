#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 本地一键启动 / 停止（生产构建 + 后端）
#
#   bash run-local.sh start    启动后端(3000) 与前端产物预览(4173)
#   bash run-local.sh stop     停止两者
#   bash run-local.sh status   查看运行状态与地址
#   bash run-local.sh dev      改用 Vite 开发服务器(5173，改代码即时生效)
#   bash run-local.sh logs     查看日志
#
# 说明：预览服务监听 0.0.0.0，同一局域网的平板/手机可直接访问打印角色卡；
#       后端只监听 127.0.0.1，由前端服务反代 /api，不直接对外暴露。
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")"

RUN_DIR=".run"
BACKEND_PORT="${PORT:-3000}"
WEB_PORT="${WEB_PORT:-4173}"
DEV_PORT=5173

mkdir -p "$RUN_DIR"

pidfile() { echo "$RUN_DIR/$1.pid"; }

# 端口 -> 监听进程 PID（Windows/Git Bash 下 kill -0 对原生进程不可靠，统一走 netstat）
port_pid() {
  netstat -ano 2>/dev/null | grep LISTENING | grep -E "[:.]$1 " | awk '{print $NF}' | head -1
}

is_alive() {
  [[ -n "$(port_pid "$1")" ]]
}

# 结束进程树（vite 会派生子进程）
kill_tree() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  if command -v taskkill >/dev/null 2>&1; then
    taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  else
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
  fi
}

stop_port() {
  local name="$1" port="$2" pid
  pid="$(port_pid "$port")"
  [[ -f "$(pidfile "$name")" ]] && pid="${pid:-$(cat "$(pidfile "$name")")}"
  if [[ -n "$pid" ]]; then
    kill_tree "$pid"
    rm -f "$(pidfile "$name")"
    echo "  已停止 $name（端口 $port，pid $pid）"
  else
    echo "  $name 未在运行"
  fi
}

start_backend() {
  if is_alive "$BACKEND_PORT"; then echo "  后端已在运行（端口 $BACKEND_PORT）"; return; fi
  COCOC_HOST=127.0.0.1 PORT="$BACKEND_PORT" nohup node backend/server.js > "$RUN_DIR/backend.log" 2>&1 &
  echo $! > "$(pidfile backend)"
  sleep 2
  if curl -sf "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null; then
    echo "  ✅ 后端 http://127.0.0.1:$BACKEND_PORT"
  else
    echo "  ❌ 后端启动失败，见 $RUN_DIR/backend.log"; tail -5 "$RUN_DIR/backend.log"
  fi
}

start_web() {
  if is_alive "$WEB_PORT"; then echo "  站点已在运行（端口 $WEB_PORT）"; return; fi
  [[ -d dist ]] || { echo "  未找到 dist，先执行 npm run build"; return; }
  nohup npx vite preview --host 0.0.0.0 --port "$WEB_PORT" --strictPort > "$RUN_DIR/preview.log" 2>&1 &
  echo $! > "$(pidfile web)"
  sleep 5
  if curl -sf "http://localhost:$WEB_PORT/" >/dev/null; then
    echo "  ✅ 站点 http://localhost:$WEB_PORT"
    grep -o 'http://[0-9.]*:'"$WEB_PORT" "$RUN_DIR/preview.log" | sort -u | sed 's/^/     局域网: /'
  else
    echo "  ❌ 前端启动失败，见 $RUN_DIR/preview.log"; tail -5 "$RUN_DIR/preview.log"
  fi
}

start_dev() {
  if is_alive "$DEV_PORT"; then echo "  开发服务器已在运行（端口 $DEV_PORT）"; return; fi
  nohup npx vite --host 0.0.0.0 --port "$DEV_PORT" --strictPort > "$RUN_DIR/dev.log" 2>&1 &
  echo $! > "$(pidfile dev)"
  sleep 5
  echo "  ✅ 开发服务器 http://localhost:$DEV_PORT （改代码即时生效）"
}

case "${1:-start}" in
  start)
    echo "==> 启动"
    start_backend
    start_web
    echo
    echo "浏览器打开：http://localhost:$WEB_PORT"
    ;;
  dev)
    echo "==> 启动（开发模式）"
    start_backend
    start_dev
    rm -f "$(pidfile web)"
    echo
    echo "浏览器打开：http://localhost:$DEV_PORT"
    ;;
  stop)
    echo "==> 停止"
    stop_port web "$WEB_PORT"; stop_port dev "$DEV_PORT"; stop_port backend "$BACKEND_PORT"
    ;;
  status)
    echo "==> 状态"
    if is_alive "$BACKEND_PORT"; then echo "  后端 运行中  http://127.0.0.1:$BACKEND_PORT (pid $(port_pid "$BACKEND_PORT"))"; else echo "  后端 已停止"; fi
    if is_alive "$WEB_PORT"; then echo "  站点 运行中  http://localhost:$WEB_PORT (pid $(port_pid "$WEB_PORT"))"; else echo "  站点 已停止"; fi
    if is_alive "$DEV_PORT"; then echo "  开发 运行中  http://localhost:$DEV_PORT"; fi
    ;;
  logs)
    tail -n "${2:-40}" "$RUN_DIR/backend.log" 2>/dev/null
    echo "--- preview ---"
    tail -n "${2:-20}" "$RUN_DIR/preview.log" 2>/dev/null
    ;;
  *)
    sed -n '2,12p' "$0"
    ;;
esac
