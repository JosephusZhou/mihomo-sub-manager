#!/usr/bin/env bash
# 本地一键开发环境：后端 wrangler dev + 前端 vite dev，只使用本地资源，不接触远程 Cloudflare。
# 依赖：bash、node、npm、curl、项目内 wrangler / vite，以及 backend/.dev.vars 中至少 32 字符的 JWT_SECRET。

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
DEV_VARS="$BACKEND_DIR/.dev.vars"
LOCAL_DIR="$ROOT_DIR/.local-dev"
CONFIG="$LOCAL_DIR/wrangler.toml"
STATE="$LOCAL_DIR/state"
DB_NAME="mihomo-sub-manager-db"

DEV_EMAIL="dev@local.test"
DEV_PASSWORD="dev-password-123"

BACKEND_PORT=8787
FRONTEND_PORT=3000
DO_BUILD=1
FORCE_INSTALL=0
RESET_PASSWORD=0

BACKEND_PID=""
FRONTEND_PID=""
WRANGLER=""
JWT_VALUE=""

usage() {
  cat <<'EOF'
用法: scripts/dev-local.sh [选项]

一次完成：环境检查 → 依赖安装 → 本地 D1 migrate/seed → 初始用户 → 前端构建
→ 后台启动 wrangler dev 与 vite dev。Ctrl+C / SIGTERM 会同时清理两个进程。

选项:
  --backend-port <端口>   后端端口，默认 8787；被占用时直接报错
  --frontend-port <端口>  前端端口，默认 3000；被占用时直接报错
  --force-install         即使 node_modules 已存在也重新执行 npm install
  --no-build              跳过前端 npm run build
  --reset-password        重置初始用户密码，不修改 api_token
  --help                  显示本帮助

构建失败行为:
  未指定 --no-build 时，npm run build 失败会打印末尾日志并以非 0 退出，不会继续启动。
  --no-build 可跳过构建，直接用 vite dev（dev 模式不依赖 dist）。

本地数据:
  临时 wrangler 配置、本地 D1/KV 状态、日志都在 .local-dev/，已加入 .gitignore。
  不会执行任何 --remote 或 deploy 命令。
EOF
}

log() { printf '%s\n' "$*"; }
err() { printf '错误：%s\n' "$*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-port)
      [[ $# -ge 2 ]] || { err "--backend-port 需要参数"; exit 2; }
      BACKEND_PORT="$2"; shift 2 ;;
    --frontend-port)
      [[ $# -ge 2 ]] || { err "--frontend-port 需要参数"; exit 2; }
      FRONTEND_PORT="$2"; shift 2 ;;
    --force-install) FORCE_INSTALL=1; shift ;;
    --no-build) DO_BUILD=0; shift ;;
    --reset-password) RESET_PASSWORD=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) err "未知参数: $1"; usage >&2; exit 2 ;;
  esac
done

for p in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  [[ "$p" =~ ^[0-9]+$ ]] && [[ "$p" -ge 1 && "$p" -le 65535 ]] || {
    err "端口必须是 1-65535 的整数: $p"; exit 2;
  }
done
[[ "$BACKEND_PORT" -ne "$FRONTEND_PORT" ]] || { err "后端和前端不能使用同一个端口"; exit 2; }

port_free() {
  node -e '
const net = require("net");
const s = net.createServer();
s.once("error", () => process.exit(1));
s.once("listening", () => s.close(() => process.exit(0)));
s.listen(Number(process.argv[1]), "127.0.0.1");
' "$1" 2>/dev/null
}

kill_tree() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  pkill -P "$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  pkill -9 -P "$pid" 2>/dev/null || true
  kill -9 "$pid" 2>/dev/null || true
}

cleanup() {
  kill_tree "$BACKEND_PID"
  kill_tree "$FRONTEND_PID"
}

trap cleanup EXIT
trap 'trap - INT TERM EXIT; cleanup; printf "\n已停止后端与前端进程。\n"; exit 0' INT TERM

# ---------- 1. 环境检查 ----------
log '===== 本地开发环境 ====='
command -v node >/dev/null 2>&1 || { err "未找到 node"; exit 2; }
command -v npm >/dev/null 2>&1 || { err "未找到 npm"; exit 2; }
command -v curl >/dev/null 2>&1 || { err "未找到 curl"; exit 2; }

if [[ ! -f "$DEV_VARS" ]]; then
  err "缺少 $DEV_VARS（wrangler dev 需要 JWT_SECRET）"
  cat >&2 <<'EOF'
请先生成（脚本不会自动创建或覆盖已有文件）：
  openssl rand -hex 32 | sed 's/^/JWT_SECRET=/' > backend/.dev.vars
  chmod 600 backend/.dev.vars
EOF
  exit 2
fi

jwt_line=$(grep -E '^[[:space:]]*JWT_SECRET[[:space:]]*=' "$DEV_VARS" | tail -n 1 || true)
JWT_VALUE=${jwt_line#*=}
JWT_VALUE=$(printf '%s' "$JWT_VALUE" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
  -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
if [[ -z "$JWT_VALUE" || "${#JWT_VALUE}" -lt 32 ]]; then
  err "$DEV_VARS 中的 JWT_SECRET 缺失或少于 32 字符"
  exit 2
fi

port_free "$BACKEND_PORT" || {
  err "后端端口 $BACKEND_PORT 已被占用，请用 --backend-port 指定其他端口"
  exit 2
}
port_free "$FRONTEND_PORT" || {
  err "前端端口 $FRONTEND_PORT 已被占用，请用 --frontend-port 指定其他端口"
  exit 2
}

# ---------- 2. 依赖 ----------
install_deps() {
  local dir="$1" name="$2"
  if [[ "$FORCE_INSTALL" -eq 1 || ! -d "$dir/node_modules" ]]; then
    log "安装依赖: $name"
    ( cd "$dir" && npm install ) || { err "$name npm install 失败"; exit 2; }
  else
    log "依赖已存在，跳过: $name"
  fi
}
install_deps "$BACKEND_DIR" "backend"
install_deps "$FRONTEND_DIR" "frontend"

WRANGLER="$BACKEND_DIR/node_modules/.bin/wrangler"
[[ -x "$WRANGLER" ]] || WRANGLER=$(command -v wrangler 2>/dev/null || true)
[[ -n "$WRANGLER" && -x "$WRANGLER" ]] || {
  err "未找到 wrangler；请执行 cd backend && npm install"
  exit 2
}
VITE_BIN="$FRONTEND_DIR/node_modules/.bin/vite"
[[ -x "$VITE_BIN" ]] || { err "未找到 vite；请执行 cd frontend && npm install"; exit 2; }

# ---------- 3. 本地 D1 migrate + seed ----------
mkdir -p "$LOCAL_DIR"
# 避免 wrangler 把内部日志/本地 explorer 注册信息写到 ~/Library/Preferences（可能无权限）。
export WRANGLER_REGISTRY_PATH="$LOCAL_DIR/wrangler-registry"
export WRANGLER_LOG_PATH="$LOCAL_DIR/wrangler-internal.log"
cat > "$CONFIG" <<EOF
name = "mihomo-sub-manager-local-dev"
main = "$BACKEND_DIR/src/index.js"
compatibility_date = "2026-10-30"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "$DB_NAME"
database_id = "00000000-0000-4000-8000-000000000001"

[[kv_namespaces]]
binding = "CACHE"
id = "00000000-0000-4000-8000-000000000002"

[vars]
WORKER_URL = ""
ACCESS_TOKEN_TTL = 900
REFRESH_TOKEN_TTL = 2592000
SUB_CACHE_TTL = "3600"
EOF

d1_file() {
  ( cd "$BACKEND_DIR" && "$WRANGLER" d1 execute "$DB_NAME" \
      --local --config="$CONFIG" --persist-to="$STATE" --file="$1" )
}

d1_json() {
  ( cd "$BACKEND_DIR" && "$WRANGLER" d1 execute "$DB_NAME" \
      --local --config="$CONFIG" --persist-to="$STATE" --json --command="$1" ) 2>/dev/null
}

json_scalar() {
  printf '%s' "$1" | node -e '
let d = "";
process.stdin.on("data", c => { d += c; }).on("end", () => {
  try {
    const arr = JSON.parse(d);
    const row = arr && arr[0] && arr[0].results && arr[0].results[0];
    if (!row) process.stdout.write("");
    else process.stdout.write(String(row[Object.keys(row)[0]]));
  } catch { process.stdout.write(""); }
});
'
}

log "本地 D1: migrate + seed（seed 使用 INSERT OR IGNORE，可重复执行）"
d1_file "$BACKEND_DIR/schema.sql" >"$LOCAL_DIR/db.log" 2>&1 || {
  err "本地建表失败，见 .local-dev/db.log"; tail -n 20 "$LOCAL_DIR/db.log" >&2; exit 2;
}
d1_file "$BACKEND_DIR/seed.sql" >"$LOCAL_DIR/db.log" 2>&1 || {
  err "写入系统模板失败，见 .local-dev/db.log"; tail -n 20 "$LOCAL_DIR/db.log" >&2; exit 2;
}
TPL_COUNT=$(json_scalar "$(d1_json "SELECT COUNT(*) AS n FROM templates WHERE user_id = 0")")
log "系统模板数量: ${TPL_COUNT:-未知}（幂等 seed，重复运行不会累加）"

# ---------- 4. 初始用户 ----------
generate_credentials() {
  DB_MODULE="$BACKEND_DIR/src/db.js" DEV_PASSWORD="$DEV_PASSWORD" NEED_TOKEN="${1:-0}" \
    node --input-type=module -e '
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { pathToFileURL } = await import("node:url");
const db = await import(pathToFileURL(process.env.DB_MODULE).href);
const hash = await db.hashPassword(process.env.DEV_PASSWORD);
let token = "";
if (process.env.NEED_TOKEN === "1") token = await db.generateToken();
process.stdout.write(hash + " " + token + "\n");
'
}

USER_ID=$(json_scalar "$(d1_json "SELECT id FROM users WHERE email = '$DEV_EMAIL' LIMIT 1")")

if [[ -n "$USER_ID" ]]; then
  if [[ "$RESET_PASSWORD" -eq 1 ]]; then
    creds=$(generate_credentials 0) || { err "生成密码哈希失败"; exit 2; }
    read -r PASSWORD_HASH _ <<< "$creds"
    d1_json "UPDATE users SET password_hash = '$PASSWORD_HASH', updated_at = datetime('now') WHERE id = $USER_ID" \
      >/dev/null 2>&1 || { err "重置密码失败"; exit 2; }
    log "初始用户已存在，已重置密码: $DEV_EMAIL / $DEV_PASSWORD"
  else
    log "初始用户已存在，跳过创建: $DEV_EMAIL / $DEV_PASSWORD"
  fi
else
  creds=$(generate_credentials 1) || { err "生成密码哈希/api_token 失败"; exit 2; }
  read -r PASSWORD_HASH API_TOKEN <<< "$creds"
  d1_json "INSERT INTO users (email, password_hash, api_token) VALUES ('$DEV_EMAIL', '$PASSWORD_HASH', '$API_TOKEN')" \
    >/dev/null 2>&1 || { err "创建初始用户失败"; exit 2; }
  log "已创建初始用户: $DEV_EMAIL / $DEV_PASSWORD"
fi

# ---------- 5. 前端构建 ----------
if [[ "$DO_BUILD" -eq 1 ]]; then
  log "前端构建: npm run build"
  if ( cd "$FRONTEND_DIR" && npm run build ) >"$LOCAL_DIR/build.log" 2>&1; then
    log "前端构建通过"
  else
    err "前端构建失败，已中止（完整日志: .local-dev/build.log）"
    tail -n 30 "$LOCAL_DIR/build.log" >&2
    exit 1
  fi
else
  log "已跳过前端构建（--no-build）"
fi

# ---------- 6. 启动 ----------
: >"$LOCAL_DIR/backend.log"
: >"$LOCAL_DIR/frontend.log"

log "启动后端: wrangler dev (http://127.0.0.1:$BACKEND_PORT)"
( cd "$BACKEND_DIR" && exec "$WRANGLER" dev --local \
    --config="$CONFIG" --persist-to="$STATE" \
    --ip 127.0.0.1 --port "$BACKEND_PORT" \
    --var "JWT_SECRET:$JWT_VALUE" ) >"$LOCAL_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

log "启动前端: vite dev (http://localhost:$FRONTEND_PORT)"
# 显式绑定 127.0.0.1：Vite 默认只监听 IPv6 ::1，curl/容器内访问会失败。
( cd "$FRONTEND_DIR" && \
    export VITE_API_BASE_URL="http://127.0.0.1:$BACKEND_PORT" && \
    exec "$VITE_BIN" --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort ) \
  >"$LOCAL_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

log '等待后端 /health 与前端页面就绪...'
backend_ready=0
frontend_ready=0
for _ in $(seq 1 120); do
  if [[ "$backend_ready" -eq 0 ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    code=$(curl --noproxy '*' -sS -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$BACKEND_PORT/health" 2>/dev/null || true)
    [[ "$code" == "200" ]] && backend_ready=1
  fi
  if [[ "$frontend_ready" -eq 0 ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    code=$(curl --noproxy '*' -sS -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$FRONTEND_PORT/" 2>/dev/null || true)
    [[ "$code" == "200" ]] && frontend_ready=1
  fi
  [[ "$backend_ready" -eq 1 && "$frontend_ready" -eq 1 ]] && break
  kill -0 "$BACKEND_PID" 2>/dev/null || break
  kill -0 "$FRONTEND_PID" 2>/dev/null || break
  sleep 0.5
done

if [[ "$backend_ready" -ne 1 || "$frontend_ready" -ne 1 ]]; then
  err "启动失败（backend ready=${backend_ready}，frontend ready=${frontend_ready}）"
  printf '%s\n' '--- backend.log ---'
  tail -n 30 "$LOCAL_DIR/backend.log" || true
  printf '%s\n' '--- frontend.log ---'
  tail -n 30 "$LOCAL_DIR/frontend.log" || true
  exit 1
fi

printf '\n========================================\n'
printf '后端健康检查: http://127.0.0.1:%s/health\n' "$BACKEND_PORT"
printf '前端页面:     http://localhost:%s\n' "$FRONTEND_PORT"
printf '登录账号:     %s\n' "$DEV_EMAIL"
printf '登录密码:     %s\n' "$DEV_PASSWORD"
printf '日志:         .local-dev/backend.log / .local-dev/frontend.log\n'
printf '按 Ctrl+C 停止并清理进程。\n'
printf '========================================\n\n'

while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done

# 走到这里说明有进程意外退出（正常 Ctrl+C 会走信号 trap）
err "检测到后端或前端进程意外退出"
printf '%s\n' '--- backend.log ---'
tail -n 30 "$LOCAL_DIR/backend.log" || true
printf '%s\n' '--- frontend.log ---'
tail -n 30 "$LOCAL_DIR/frontend.log" || true
exit 1
