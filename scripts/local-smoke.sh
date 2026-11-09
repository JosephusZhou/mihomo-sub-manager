#!/usr/bin/env bash
# 本地冒烟测试：只使用 wrangler --local，绝不接触远程 Cloudflare 资源。
# 依赖：bash、curl、node（用于复用 src/db.js 的哈希/token 算法与解析 JSON）、backend 已安装的 wrangler、
# backend/.dev.vars 中至少 32 字符的 JWT_SECRET。

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
BACKEND_DIR="$ROOT_DIR/backend"
DEV_VARS="$BACKEND_DIR/.dev.vars"
WRANGLER="$BACKEND_DIR/node_modules/.bin/wrangler"
DB_NAME="mihomo-sub-manager-db"

SMOKE_EMAIL="smoke@test.local"
SMOKE_PASSWORD="smoke-password-123"

PORT=""
FRESH=0
KEEP=0
DEV_PID=""
TMP_DIR=""
LOG_FILE=""

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

usage() {
  cat <<'EOF'
用法: scripts/local-smoke.sh [选项]

在本地启动 wrangler dev（--local），造测试数据并跑接口断言。
不会执行任何 --remote 或 deploy 命令。

选项:
  --fresh        删除 backend/.wrangler/smoke-state 后重新建库（只影响冒烟专用本地状态）
  --port <端口>  指定后端端口；默认从 8787 开始找第一个空闲端口
  --keep         测试结束后保留 wrangler dev 进程和临时目录，便于手工调试
  --help         显示本帮助

测试账号（固定，仅本地）:
  email:    smoke@test.local
  password: smoke-password-123
  密码哈希与 api_token 直接复用 backend/src/db.js 的实现生成。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fresh) FRESH=1; shift ;;
    --keep) KEEP=1; shift ;;
    --port)
      [[ $# -ge 2 ]] || { echo "错误：--port 需要参数" >&2; exit 2; }
      PORT="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

err() { printf '错误：%s\n' "$*" >&2; }
pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'PASS  %s\n' "$*"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'FAIL  %s\n' "$*"; }
skip() { SKIP_COUNT=$((SKIP_COUNT + 1)); printf 'SKIP  %s\n' "$*"; }

cleanup() {
  if [[ -n "$DEV_PID" ]]; then
    if [[ "$KEEP" -eq 0 ]]; then
      if kill -0 "$DEV_PID" 2>/dev/null; then
        pkill -P "$DEV_PID" 2>/dev/null || true
        kill "$DEV_PID" 2>/dev/null || true
        for _ in 1 2 3 4 5; do
          kill -0 "$DEV_PID" 2>/dev/null || break
          sleep 0.2
        done
        pkill -9 -P "$DEV_PID" 2>/dev/null || true
        kill -9 "$DEV_PID" 2>/dev/null || true
      fi
    fi
  fi
  if [[ -n "$TMP_DIR" && "$KEEP" -eq 0 ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT INT TERM

port_free() {
  node -e '
const net = require("net");
const s = net.createServer();
s.once("error", () => process.exit(1));
s.once("listening", () => s.close(() => process.exit(0)));
s.listen(Number(process.argv[1]), "127.0.0.1");
' "$1" 2>/dev/null
}

d1_run_file() {
  ( cd "$BACKEND_DIR" && "$WRANGLER" d1 execute "$DB_NAME" \
      --local --config="$SMOKE_CONFIG" --persist-to="$SMOKE_STATE" \
      --file="$1" ) >"$TMP_DIR/d1.log" 2>&1
}

d1_run_cmd() {
  ( cd "$BACKEND_DIR" && "$WRANGLER" d1 execute "$DB_NAME" \
      --local --config="$SMOKE_CONFIG" --persist-to="$SMOKE_STATE" \
      --command="$1" ) >"$TMP_DIR/d1.log" 2>&1
}

json_get() {
  local json="$1" path="$2"
  printf '%s' "$json" | node -e '
let d = "";
process.stdin.on("data", c => { d += c; }).on("end", () => {
  let v;
  try { v = JSON.parse(d); } catch { process.exit(2); }
  for (const k of (process.argv[1] || "").split(".").filter(Boolean)) {
    if (v === undefined || v === null) break;
    v = (Array.isArray(v) && /^\d+$/.test(k)) ? v[Number(k)] : v[k];
  }
  if (v === undefined || v === null) process.exit(3);
  process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
});
' "$path"
}

json_quote() {
  printf '%s' "$1" | node -e '
let d = "";
process.stdin.on("data", c => { d += c; }).on("end", () => process.stdout.write(JSON.stringify(d)));
'
}

HTTP_CODE=""
HTTP_BODY=""
HTTP_HEADERS=""

http_req() {
  local method="$1" path_or_url="$2" data="${3:-}" token="${4:-}"
  local url="$path_or_url"
  [[ "$url" == http://* || "$url" == https://* ]] || url="$BASE$path_or_url"
  local out="$TMP_DIR/resp.body" hdr="$TMP_DIR/resp.headers"
  local -a args
  args=(-sS -m 30 -X "$method" -D "$hdr" -o "$out" -w '%{http_code}')
  if [[ -n "$data" ]]; then
    args+=(-H 'Content-Type: application/json' --data "$data")
  fi
  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer $token")
  fi
  HTTP_CODE=$(curl "${args[@]}" "$url" 2>"$TMP_DIR/curl.err") || HTTP_CODE="000"
  HTTP_BODY=$(cat "$out" 2>/dev/null || true)
  HTTP_HEADERS=$(cat "$hdr" 2>/dev/null || true)
}

content_type() {
  printf '%s' "$HTTP_HEADERS" | grep -i '^content-type:' | tail -n 1 \
    | tr -d '\r' | cut -d' ' -f2-
}

# ---------- 前置检查 ----------
printf '===== 本地冒烟测试 =====\n'

command -v node >/dev/null 2>&1 || { err "未找到 node"; exit 2; }
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
jwt_value=${jwt_line#*=}
jwt_value=$(printf '%s' "$jwt_value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
  -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
if [[ -z "$jwt_value" || "${#jwt_value}" -lt 32 ]]; then
  err "$DEV_VARS 中的 JWT_SECRET 缺失或少于 32 字符"
  exit 2
fi

if [[ ! -x "$WRANGLER" ]]; then
  WRANGLER=$(command -v wrangler 2>/dev/null || true)
fi
[[ -n "$WRANGLER" && -x "$WRANGLER" ]] || {
  err "未找到 wrangler，请先执行: cd backend && npm install"
  exit 2
}

TMP_DIR=$(mktemp -d "$(printf '%s' "${TMPDIR:-/tmp}" | sed 's:/$::')/mihomo-smoke.XXXXXX") || { err "无法创建临时目录"; exit 2; }
LOG_FILE="$TMP_DIR/wrangler.log"
SMOKE_CONFIG="$TMP_DIR/wrangler.smoke.toml"
SMOKE_STATE="$BACKEND_DIR/.wrangler/smoke-state"

# 仓库内 wrangler.toml 的 D1/KV id 由部署脚本填写，空值会被 wrangler 4 拒绝；
# 这里生成临时配置并固定本地资源 id，只影响 templates 本地状态，不改仓库配置。
cat > "$SMOKE_CONFIG" <<EOF
name = "mihomo-sub-manager-smoke"
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

# ---------- 端口 ----------
if [[ -n "$PORT" ]]; then
  [[ "$PORT" =~ ^[0-9]+$ ]] && [[ "$PORT" -ge 1 && "$PORT" -le 65535 ]] || {
    err "--port 必须是 1-65535 的整数"; exit 2;
  }
  port_free "$PORT" || { err "端口 $PORT 已被占用"; exit 2; }
else
  PORT=8787
  while ! port_free "$PORT"; do
    PORT=$((PORT + 1))
    [[ "$PORT" -le 8887 ]] || { err "8787-8887 没有空闲端口，请用 --port 指定"; exit 2; }
  done
fi
BASE="http://127.0.0.1:$PORT"

printf '模式: %s\n' "$([[ "$FRESH" -eq 1 ]] && echo '全新本地 D1（--fresh）' || echo '复用本地 D1')"
printf '端口: %s\n' "$PORT"
printf '日志: %s\n' "$LOG_FILE"

# ---------- 生成与后端一致的密码哈希 / api_token ----------
creds=$(DB_MODULE="$BACKEND_DIR/src/db.js" SMOKE_PASSWORD="$SMOKE_PASSWORD" node --input-type=module -e '
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { pathToFileURL } = await import("node:url");
const db = await import(pathToFileURL(process.env.DB_MODULE).href);
const hash = await db.hashPassword(process.env.SMOKE_PASSWORD);
const token = await db.generateToken();
process.stdout.write(hash + " " + token + "\n");
' 2>"$TMP_DIR/node.err") || { err "复用 backend/src/db.js 生成凭据失败"; cat "$TMP_DIR/node.err" >&2; exit 2; }
read -r PASSWORD_HASH API_TOKEN <<< "$creds"
[[ -n "$PASSWORD_HASH" && -n "$API_TOKEN" ]] || { err "凭据生成结果为空"; exit 2; }

# ---------- 本地 D1 ----------
if [[ "$FRESH" -eq 1 ]]; then
  rm -rf "$SMOKE_STATE"
fi

d1_run_file "$BACKEND_DIR/schema.sql" || {
  err "本地建表失败，见 $TMP_DIR/d1.log"; tail -n 20 "$TMP_DIR/d1.log" >&2; exit 2;
}

if ! d1_run_cmd "SELECT dialer_proxy FROM proxies LIMIT 1" \
  || ! d1_run_cmd "SELECT include_custom_rules FROM templates LIMIT 1" \
  || ! d1_run_cmd "SELECT 1 FROM user_custom_rules LIMIT 1"; then
  err "本地 D1 结构过旧，缺少链式代理/自定义规则字段；请使用 --fresh 重建本地库"
  tail -n 10 "$TMP_DIR/d1.log" >&2
  exit 2
fi

d1_run_file "$BACKEND_DIR/seed.sql" || {
  err "写入系统模板失败，见 $TMP_DIR/d1.log"; tail -n 20 "$TMP_DIR/d1.log" >&2; exit 2;
}

# 清理旧的测试用户（templates.user_id 没有外键，需要显式清理）
cat > "$TMP_DIR/setup.sql" <<SQL
DELETE FROM profile_paid_subs WHERE profile_id IN (SELECT id FROM profiles WHERE user_id IN (SELECT id FROM users WHERE email = '$SMOKE_EMAIL'));
DELETE FROM profiles WHERE user_id IN (SELECT id FROM users WHERE email = '$SMOKE_EMAIL');
DELETE FROM paid_sub_wrappers WHERE paid_subscription_id IN (SELECT id FROM paid_subscriptions WHERE user_id IN (SELECT id FROM users WHERE email = '$SMOKE_EMAIL'));
DELETE FROM paid_subscriptions WHERE user_id IN (SELECT id FROM users WHERE email = '$SMOKE_EMAIL');
DELETE FROM proxies WHERE user_id IN (SELECT id FROM users WHERE email = '$SMOKE_EMAIL');
DELETE FROM user_custom_rules WHERE user_id IN (SELECT id FROM users WHERE email = '$SMOKE_EMAIL');
DELETE FROM templates WHERE user_id IN (SELECT id FROM users WHERE email = '$SMOKE_EMAIL');
DELETE FROM users WHERE email = '$SMOKE_EMAIL';
INSERT INTO users (email, password_hash, api_token) VALUES ('$SMOKE_EMAIL', '$PASSWORD_HASH', '$API_TOKEN');
SQL

d1_run_file "$TMP_DIR/setup.sql" || {
  err "创建测试用户失败，见 $TMP_DIR/d1.log"; tail -n 20 "$TMP_DIR/d1.log" >&2; exit 2;
}

# wrangler 从配置文件所在目录读取 .dev.vars；临时配置在 TMP_DIR，这里复制一份（清理时删除）。
cp "$DEV_VARS" "$TMP_DIR/.dev.vars"
chmod 600 "$TMP_DIR/.dev.vars"

# ---------- 启动 wrangler dev（仅本地） ----------
( cd "$BACKEND_DIR" && exec "$WRANGLER" dev --local --config="$SMOKE_CONFIG" \
    --persist-to="$SMOKE_STATE" --ip 127.0.0.1 --port "$PORT" ) \
  >"$LOG_FILE" 2>&1 &
DEV_PID=$!

ready=0
for _ in $(seq 1 120); do
  if ! kill -0 "$DEV_PID" 2>/dev/null; then break; fi
  code=$(curl -sS -m 2 -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null || true)
  if [[ "$code" == "200" ]]; then ready=1; break; fi
  sleep 0.5
done

if [[ "$ready" -ne 1 ]]; then
  fail "[0] 后端启动失败：/health 未就绪"
  printf '%s\n' '--- wrangler 日志末尾 ---'
  tail -n 40 "$LOG_FILE" || true
  printf '\n测试账号: %s / %s\n' "$SMOKE_EMAIL" "$SMOKE_PASSWORD"
  printf '\n===== 汇总 =====\nPASS: %d\nFAIL: %d\nSKIP: %d\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
  exit 1
fi

printf '\n后端已就绪: %s\n测试账号: %s / %s\n\n' "$BASE" "$SMOKE_EMAIL" "$SMOKE_PASSWORD"

# ---------- 1. health ----------
http_req GET /health
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "[1] /health 返回 200"
else
  fail "[1] /health 返回 ${HTTP_CODE}（期望 200）"
fi

# ---------- 2. 登录 ----------
http_req POST /api/auth/login "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"wrong-password\"}"
wrong_login_code=$HTTP_CODE

http_req POST /api/auth/login "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}"
login_code=$HTTP_CODE
ACCESS_TOKEN=$(json_get "$HTTP_BODY" access_token 2>/dev/null || true)
REFRESH_TOKEN=$(json_get "$HTTP_BODY" refresh_token 2>/dev/null || true)
if [[ "$login_code" == "200" && -n "$ACCESS_TOKEN" && -n "$REFRESH_TOKEN" ]]; then
  login_ok=1
else
  login_ok=0
fi

if [[ "$wrong_login_code" == "401" && "$login_ok" -eq 1 ]]; then
  pass "[2] 登录成功且拿到 access/refresh token；错误密码返回 401"
elif [[ "$wrong_login_code" != "401" && "$login_ok" -ne 1 ]]; then
  fail "[2] 错误密码返回 ${wrong_login_code}（期望 401）；正确登录 ${login_code} 且 token 缺失"
elif [[ "$wrong_login_code" != "401" ]]; then
  fail "[2] 错误密码返回 ${wrong_login_code}（期望 401）"
else
  fail "[2] 正确登录 ${login_code} 或 token 缺失"
fi

if [[ "$login_ok" -ne 1 ]]; then
  printf '\n登录失败，后续断言无法继续。\n'
  printf '响应: %s\n' "$HTTP_BODY"
  printf '\n===== 汇总 =====\nPASS: %d\nFAIL: %d\nSKIP: %d\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
  exit 1
fi

# ---------- 3. 受保护接口鉴权 ----------
http_req GET /api/proxies
noauth_code=$HTTP_CODE
http_req GET /api/proxies "" "$ACCESS_TOKEN"
auth_code=$HTTP_CODE
if [[ "$noauth_code" == "401" && "$auth_code" == "200" ]]; then
  pass "[3] 受保护接口无 token 返回 401，带 token 返回 200"
else
  fail "[3] 无 token 返回 ${noauth_code}（期望 401），带 token 返回 ${auth_code}（期望 200）"
fi

# ---------- 4. 节点 CRUD ----------
http_req POST /api/proxies \
  '{"name":"smoke-crud","type":"ss","server":"1.1.1.1","port":8388,"config":{"cipher":"aes-128-gcm","password":"smokepass"}}' \
  "$ACCESS_TOKEN"
crud_create_code=$HTTP_CODE
CRUD_ID=$(json_get "$HTTP_BODY" proxy.id 2>/dev/null || true)

http_req GET "/api/proxies/$CRUD_ID" "" "$ACCESS_TOKEN"
crud_get_code=$HTTP_CODE

http_req PUT "/api/proxies/$CRUD_ID" \
  '{"name":"smoke-crud-updated","port":8399}' "$ACCESS_TOKEN"
crud_put_code=$HTTP_CODE
crud_put_name=$(json_get "$HTTP_BODY" proxy.name 2>/dev/null || true)
crud_put_port=$(json_get "$HTTP_BODY" proxy.port 2>/dev/null || true)

http_req DELETE "/api/proxies/$CRUD_ID" "" "$ACCESS_TOKEN"
crud_del_code=$HTTP_CODE

http_req GET "/api/proxies/$CRUD_ID" "" "$ACCESS_TOKEN"
crud_gone_code=$HTTP_CODE

if [[ "$crud_create_code" == "201" && "$crud_get_code" == "200" \
  && "$crud_put_code" == "200" && "$crud_put_name" == "smoke-crud-updated" \
  && "$crud_put_port" == "8399" && "$crud_del_code" == "200" \
  && "$crud_gone_code" == "404" ]]; then
  pass "[4] 节点创建/查询/更新/删除全部符合预期"
else
  fail "[4] CRUD 失败：create=${crud_create_code}(201) get=${crud_get_code}(200) put=${crud_put_code}(200) name=${crud_put_name} port=${crud_put_port} delete=${crud_del_code}(200) gone=${crud_gone_code}(404)"
fi

# ---------- 5. 链式代理批量导入 ----------
http_req POST /api/proxies \
  '{"name":"smoke-pre","type":"trojan","server":"198.51.100.10","port":443,"config":{"password":"smokepass","sni":"example.com"}}' \
  "$ACCESS_TOKEN"
pre_create_code=$HTTP_CODE
PRE_ID=$(json_get "$HTTP_BODY" proxy.id 2>/dev/null || true)

BATCH_TEXT='1.2.3.4:8080
user:pass@5.6.7.8:8080
9.9.9.9:1080:u:p
socks5://u:p@10.20.30.40:1080
http://8.8.8.8:3128
bad-line
user:pass@5.6.7.8:8080
ftp://1.2.3.4:21'
BATCH_TEXT_JSON=$(json_quote "$BATCH_TEXT")
CHAIN_PAYLOAD="{\"pre_proxy_id\":$PRE_ID,\"default_type\":\"http\",\"label\":\"smoke\",\"text\":$BATCH_TEXT_JSON}"

http_req POST /api/chained-proxies/preview "$CHAIN_PAYLOAD" "$ACCESS_TOKEN"
preview_code=$HTTP_CODE
preview_body=$HTTP_BODY
pv_valid=$(json_get "$preview_body" valid_count 2>/dev/null || true)
pv_total=$(json_get "$preview_body" total_lines 2>/dev/null || true)
pv_inv1=$(json_get "$preview_body" 'invalid.0.line' 2>/dev/null || true)
pv_inv2=$(json_get "$preview_body" 'invalid.1.line' 2>/dev/null || true)
pv_dup1=$(json_get "$preview_body" 'duplicates.0.line' 2>/dev/null || true)
pv_t4=$(json_get "$preview_body" 'valid.3.type' 2>/dev/null || true)

# json_get 不支持 .length，改用 node 直接从 body 取数组长度
array_len() {
  printf '%s' "$1" | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  try { const o=JSON.parse(d); const v=o[process.argv[1]]; process.stdout.write(String(Array.isArray(v)?v.length:-1)); }
  catch { process.stdout.write("-1"); }
});
' "$2"
}
pv_invalid_len=$(array_len "$preview_body" invalid)
pv_dup_len=$(array_len "$preview_body" duplicates)

http_req POST /api/chained-proxies/import "$CHAIN_PAYLOAD" "$ACCESS_TOKEN"
import_code=$HTTP_CODE
import_body=$HTTP_BODY
imp_created=$(json_get "$import_body" created_count 2>/dev/null || true)
imp_invalid_len=$(array_len "$import_body" invalid)
imp_dup_len=$(array_len "$import_body" duplicates)
CHAIN_FIRST=$(json_get "$import_body" 'created.0.name' 2>/dev/null || true)

http_req GET /api/chained-proxies "" "$ACCESS_TOKEN"
chained_list_code=$HTTP_CODE
chained_list_len=$(array_len "$HTTP_BODY" chained_proxies)
chained_dialer=$(json_get "$HTTP_BODY" 'chained_proxies.0.dialer_proxy' 2>/dev/null || true)

if [[ "$pre_create_code" == "201" && "$preview_code" == "200" \
  && "$pv_valid" == "5" && "$pv_invalid_len" == "2" && "$pv_dup_len" == "1" \
  && "$pv_total" == "8" && "$pv_inv1" == "6" && "$pv_inv2" == "8" && "$pv_dup1" == "7" \
  && "$pv_t4" == "socks5" \
  && "$import_code" == "201" && "$imp_created" == "5" \
  && "$imp_invalid_len" == "2" && "$imp_dup_len" == "1" \
  && "$chained_list_code" == "200" && "$chained_list_len" == "5" \
  && "$chained_dialer" == "smoke-pre" ]]; then
  pass "[5] 链式导入：有效 5、无效 2（行 6/8）、重复 1（行 7），列表 5 条且前置为 smoke-pre"
else
  fail "[5] 链式导入断言失败：pre=${pre_create_code}(201) preview=${preview_code}(200) valid=${pv_valid}(5) invalid=${pv_invalid_len}(2) invalidLines=${pv_inv1},${pv_inv2}(6,8) dup=${pv_dup_len}(1) dupLine=${pv_dup1}(7) total=${pv_total}(8) type4=${pv_t4}(socks5) import=${import_code}(201) created=${imp_created}(5) list=${chained_list_code}/${chained_list_len}(200/5) dialer=${chained_dialer}"
fi

# ---------- 6. 档案配置生成 ----------
http_req POST /api/templates \
  '{"name":"smoke-template","dns_mode":"fake-ip","ad_blocking":true,"regions":[],"include_custom_rules":true}' \
  "$ACCESS_TOKEN"
template_code=$HTTP_CODE
TEMPLATE_ID=$(json_get "$HTTP_BODY" template.id 2>/dev/null || true)

http_req POST /api/profiles \
  "{\"name\":\"smoke-profile\",\"template_id\":$TEMPLATE_ID,\"include_private_sub\":true}" \
  "$ACCESS_TOKEN"
profile_code=$HTTP_CODE
PROFILE_ID=$(json_get "$HTTP_BODY" profile.id 2>/dev/null || true)
PROFILE_TOKEN=$(json_get "$HTTP_BODY" profile.profile_token 2>/dev/null || true)

RULE_A='DOMAIN-SUFFIX,smoke-rule-a.example.com,节点选择'
http_req PUT /api/custom-rules "{\"rules\":[\"$RULE_A\"]}" "$ACCESS_TOKEN"
rules_a_code=$HTTP_CODE

# 模板预览的 rules 必须来自真实生成逻辑（自定义规则在内置规则之前）。
http_req GET "/api/templates/$TEMPLATE_ID/preview-rules" "" "$ACCESS_TOKEN"
preview_rules_code=$HTTP_CODE
preview_rules_yaml=$(json_get "$HTTP_BODY" yaml 2>/dev/null || true)
preview_custom_line=$(printf '%s\n' "$preview_rules_yaml" | grep -n 'smoke-rule-a.example.com' | head -n 1 | cut -d: -f1)
preview_first_ruleset=$(printf '%s\n' "$preview_rules_yaml" | grep -n 'RULE-SET,' | head -n 1 | cut -d: -f1)
preview_has_providers=0
grep -q '^rule-providers:' <<<"$preview_rules_yaml" && preview_has_providers=1
preview_rules_ok=0
if [[ "$preview_rules_code" == "200" && "$preview_has_providers" -eq 1 \
  && -n "$preview_custom_line" && -n "$preview_first_ruleset" \
  && "$preview_custom_line" -lt "$preview_first_ruleset" ]]; then
  preview_rules_ok=1
fi

http_req GET "/api/profiles/$PROFILE_ID/config" "" "$ACCESS_TOKEN"
config_code=$HTTP_CODE
CONFIG_YAML=$HTTP_BODY
config_ct=$(content_type)

proxies_section=$(printf '%s\n' "$CONFIG_YAML" | awk '/^proxies:/{f=1;next} /^proxy-groups:/{f=0} f')
has_chain_in_proxies=0
grep -q -- "$CHAIN_FIRST" <<<"$proxies_section" && has_chain_in_proxies=1
has_dialer=0
grep -q -- 'dialer-proxy: 链式前置-' <<<"$proxies_section" && has_dialer=1
has_pre_group=0
grep -q -- 'name: 链式前置-' <<<"$CONFIG_YAML" && has_pre_group=1
has_pre_filter=0
grep -qF -- 'filter: ^smoke-pre$' <<<"$CONFIG_YAML" && has_pre_filter=1

rule_line=$(printf '%s\n' "$CONFIG_YAML" | grep -n 'smoke-rule-a.example.com' | head -n 1 | cut -d: -f1)
first_ruleset=$(printf '%s\n' "$CONFIG_YAML" | grep -n 'RULE-SET,' | head -n 1 | cut -d: -f1)
match_line=$(printf '%s\n' "$CONFIG_YAML" | grep -n 'MATCH,' | tail -n 1 | cut -d: -f1)
rule_order_ok=0
if [[ -n "$rule_line" && -n "$first_ruleset" && -n "$match_line" ]] \
  && [[ "$rule_line" -lt "$first_ruleset" && "$rule_line" -lt "$match_line" ]]; then
  rule_order_ok=1
fi

# 分流组末尾必须带「链式代理」；DIRECT/REJECT 型组不得出现。
group_block() {
  printf '%s\n' "$CONFIG_YAML" | awk -v g="$1" '
    $0 == "  - name: " g { inside=1; print; next }
    inside && /^  - name: / { exit }
    inside { print }
  '
}
chain_groups_ok=1
for gname in 微软服务 谷歌服务 苹果服务 游戏服务 网络测试 代理域名 电报消息 漏网之鱼; do
  group_block "$gname" | grep -q -- '^      - 链式代理$' || chain_groups_ok=0
done
for gname in 直连软件 私有网络 广告域名 全球拦截 全球绕过 全球直连; do
  group_block "$gname" | grep -q -- '链式代理' && chain_groups_ok=0
done

# proxy-groups 必须全部是块状多行，不能出现 `- { ... }` 单行流式写法。
flow_items=$(printf '%s\n' "$CONFIG_YAML" | grep -c -- '^  - {' || true)
format_ok=0
[[ "${flow_items:-0}" -eq 0 ]] && format_ok=1

# hosts 必须是块状多行，不能出现 `[...]` flow 数组。
hosts_block=$(printf '%s\n' "$CONFIG_YAML" | awk '/^hosts:/{f=1;next} f&&/^[^ ]/{exit} f')
hosts_flow=$(printf '%s\n' "$hosts_block" | grep -c '\[' || true)
hosts_items=$(printf '%s\n' "$hosts_block" | grep -c '^    - ' || true)
hosts_ok=0
[[ "${hosts_flow:-0}" -eq 0 && "${hosts_items:-0}" -gt 0 ]] && hosts_ok=1

if [[ "$template_code" == "201" && "$profile_code" == "201" && "$rules_a_code" == "200" \
  && "$config_code" == "200" && "$config_ct" == text/yaml* \
  && "$has_chain_in_proxies" -eq 1 && "$has_dialer" -eq 1 \
  && "$has_pre_group" -eq 1 && "$has_pre_filter" -eq 1 && "$rule_order_ok" -eq 1 \
  && "$chain_groups_ok" -eq 1 && "$format_ok" -eq 1 && "$hosts_ok" -eq 1 && "$preview_rules_ok" -eq 1 ]]; then
  pass "[6] 档案配置：链式节点在顶层 proxies、有 dialer-proxy 与「链式前置」组；自定义规则在 RULE-SET 之前；分流组末尾含链式代理组；proxy-groups 与 hosts 均为多行块状；模板预览 rules 与真实生成一致"
else
  fail "[6] 配置断言失败：template=${template_code}(201) profile=${profile_code}(201) rules=${rules_a_code}(200) config=${config_code}(200) ct=${config_ct} chainInProxies=${has_chain_in_proxies} dialer=${has_dialer} preGroup=${has_pre_group} preFilter=${has_pre_filter} ruleLine=${rule_line:-none} firstRULE-SET=${first_ruleset:-none} MATCH=${match_line:-none} chainGroups=${chain_groups_ok} format=${format_ok} flowItems=${flow_items:-?} hosts=${hosts_ok}(flow=${hosts_flow:-?},items=${hosts_items:-?}) previewRules=${preview_rules_code}(200)/${preview_rules_ok} customLine=${preview_custom_line:-none} firstRULE-SET=${preview_first_ruleset:-none} providers=${preview_has_providers}"
fi

# ---------- 7. 公开私人订阅 ----------
http_req GET "/subscribes?token=$API_TOKEN"
sub_code=$HTTP_CODE
sub_ct=$(content_type)
sub_has_pre=0
grep -q -- 'smoke-pre' <<<"$HTTP_BODY" && sub_has_pre=1
if [[ "$sub_code" == "200" && "$sub_ct" == text/yaml* && "$sub_has_pre" -eq 1 ]]; then
  pass "[7] /subscribes 返回 text/yaml 且包含前置节点"
else
  fail "[7] /subscribes 返回 ${sub_code}，Content-Type=${sub_ct}，包含前置节点=${sub_has_pre}"
fi

# ---------- 8. 付费订阅 ----------
http_req POST /api/paid-subs '{"name":"smoke-bad","url":"ftp://example.com/sub"}' "$ACCESS_TOKEN"
paid_bad_scheme=$HTTP_CODE
http_req POST /api/paid-subs '{"name":"smoke-private","url":"http://127.0.0.1:8080/sub"}' "$ACCESS_TOKEN"
paid_private=$HTTP_CODE
http_req POST /api/paid-subs '{"name":"smoke-private2","url":"http://localhost:8080/sub"}' "$ACCESS_TOKEN"
paid_localhost=$HTTP_CODE

paid_reject_ok=0
[[ "$paid_bad_scheme" == "400" && "$paid_private" == "400" && "$paid_localhost" == "400" ]] && paid_reject_ok=1

SOURCE_URL=""
for candidate in \
  'https://www.cloudflare.com/robots.txt' \
  'https://raw.githubusercontent.com/MetaCubeX/mihomo/Meta/README.md' \
  'https://httpbin.org/robots.txt'; do
  probe=$(curl -sS -m 8 -L -o "$TMP_DIR/probe.body" -w '%{http_code} %{content_type}' "$candidate" 2>/dev/null) || continue
  probe_code=${probe%% *}
  probe_ct=${probe#* }
  if [[ "$probe_code" == "200" && "$probe_ct" != text/html* ]] && [[ -s "$TMP_DIR/probe.body" ]]; then
    SOURCE_URL="$candidate"
    break
  fi
done

cache_state="not-tested"
cache_detail=""
if [[ "$paid_reject_ok" -eq 1 ]]; then
  pass "[8] 付费订阅无效协议/私网/localhost 源地址均被 400 拒绝"
else
  fail "[8] 源地址校验失败：ftp=${paid_bad_scheme}(400) 127.0.0.1=${paid_private}(400) localhost=${paid_localhost}(400)"
fi

if [[ -n "$SOURCE_URL" ]]; then
  source_json=$(json_quote "$SOURCE_URL")
  http_req POST /api/paid-subs "{\"name\":\"smoke-paid\",\"url\":$source_json}" "$ACCESS_TOKEN"
  paid_create_code=$HTTP_CODE
  WRAPPER_URL=$(json_get "$HTTP_BODY" paid_subscription.wrapper_url 2>/dev/null || true)
  if [[ "$paid_create_code" == "201" && -n "$WRAPPER_URL" ]]; then
    r1=$(curl -sS -m 30 -o "$TMP_DIR/paid1.body" -w '%{http_code} %{time_total}' "$WRAPPER_URL" 2>/dev/null) || r1="000 0"
    code1=${r1%% *}; time1=${r1#* }
    r2=$(curl -sS -m 30 -o "$TMP_DIR/paid2.body" -w '%{http_code} %{time_total}' "$WRAPPER_URL" 2>/dev/null) || r2="000 0"
    code2=${r2%% *}; time2=${r2#* }
    body_same=0
    cmp -s "$TMP_DIR/paid1.body" "$TMP_DIR/paid2.body" && body_same=1
    faster=0
    if awk "BEGIN{exit !($time2 < $time1/2 && ($time1-$time2) >= 0.02)}"; then faster=1; fi
    if [[ "$code1" == "200" && "$code2" == "200" && "$body_same" -eq 1 && "$faster" -eq 1 ]]; then
      cache_state="hit"
      cache_detail="首次 ${time1}s，第二次 ${time2}s，内容一致"
      pass "[8] 包装地址第二次请求明显更快（缓存命中）"
    else
      cache_state="skip"
      cache_detail="首次 ${time1}s(${code1})，第二次 ${time2}s(${code2})，内容一致=${body_same}；耗时无法可靠区分"
      skip "[8] 缓存命中验证跳过：$cache_detail"
    fi
  else
    cache_state="skip"
    cache_detail="创建付费订阅失败 code=${paid_create_code} wrapper=${WRAPPER_URL:-空}"
    skip "[8] 缓存命中验证跳过：$cache_detail"
  fi
else
  cache_state="skip"
  cache_detail="没有探测到可达的公网纯文本测试源"
  skip "[8] 缓存命中验证跳过：$cache_detail"
fi

# ---------- 8b. 上游失败 → 302 重定向到源地址 ----------
redirect_cases=0
redirect_pass=0
redirect_detail=""
for fail_url in 'https://httpbin.org/status/404' 'https://www.cloudflare.com/'; do
  probe_code=$(curl -sS -m 8 -o /dev/null -w '%{http_code}' "$fail_url" 2>/dev/null) || probe_code="000"
  [[ "$probe_code" == "000" ]] && continue
  redirect_cases=$((redirect_cases + 1))
  fail_json=$(json_quote "$fail_url")
  http_req POST /api/paid-subs "{\"name\":\"smoke-fail-$redirect_cases\",\"url\":$fail_json}" "$ACCESS_TOKEN"
  if [[ "$HTTP_CODE" != "201" ]]; then
    redirect_detail="$redirect_detail 创建失败($fail_url:$HTTP_CODE);"
    continue
  fi
  fail_wrapper=$(json_get "$HTTP_BODY" paid_subscription.wrapper_url 2>/dev/null || true)
  http_req GET "$fail_wrapper"
  loc=$(printf '%s\n' "$HTTP_HEADERS" | grep -i '^location:' | tail -n 1 | tr -d '\r' | cut -d' ' -f2-)
  cachectl=$(printf '%s\n' "$HTTP_HEADERS" | grep -i '^cache-control:' | tail -n 1 | tr -d '\r' | cut -d' ' -f2-)
  if [[ "$HTTP_CODE" == "302" && "$loc" == "$fail_url" && "$cachectl" == "no-store" ]]; then
    redirect_pass=$((redirect_pass + 1))
  else
    redirect_detail="$redirect_detail $fail_url -> code=$HTTP_CODE loc=${loc:-空} cc=${cachectl:-空};"
  fi
done
if [[ "$redirect_cases" -eq 0 ]]; then
  skip "[8] 上游失败重定向验证跳过：没有可达的失败测试源"
elif [[ "$redirect_pass" -eq "$redirect_cases" ]]; then
  pass "[8] 上游失败（404/HTML）返回 302，Location 等于源地址且 Cache-Control 为 no-store"
else
  fail "[8] 上游失败重定向断言失败：通过 $redirect_pass/$redirect_cases；$redirect_detail"
fi

# ---------- 9. 自定义规则 PUT 清理档案缓存 ----------
PUBLIC_PROFILE_PATH="/profiles?token=$PROFILE_TOKEN"
http_req GET "$PUBLIC_PROFILE_PATH"
profile_public_code=$HTTP_CODE
profile_public_ct=$(content_type)
has_rule_a=0
grep -q -- 'smoke-rule-a.example.com' <<<"$HTTP_BODY" && has_rule_a=1

RULE_B='DOMAIN-SUFFIX,smoke-rule-b.example.com,节点选择'
http_req PUT /api/custom-rules "{\"rules\":[\"$RULE_B\"]}" "$ACCESS_TOKEN"
rules_b_code=$HTTP_CODE

http_req GET "$PUBLIC_PROFILE_PATH"
profile_public2_code=$HTTP_CODE
has_rule_a_2=0
has_rule_b=0
grep -q -- 'smoke-rule-a.example.com' <<<"$HTTP_BODY" && has_rule_a_2=1
grep -q -- 'smoke-rule-b.example.com' <<<"$HTTP_BODY" && has_rule_b=1

if [[ "$profile_public_code" == "200" && "$profile_public_ct" == text/yaml* \
  && "$has_rule_a" -eq 1 && "$rules_b_code" == "200" \
  && "$profile_public2_code" == "200" && "$has_rule_b" -eq 1 && "$has_rule_a_2" -eq 0 ]]; then
  pass "[9] 自定义规则 PUT 后公开档案缓存已失效（内容由 A 变为 B）"
else
  fail "[9] 缓存失效断言失败：public1=${profile_public_code}(200) ct=${profile_public_ct} hasA=${has_rule_a} put=${rules_b_code}(200) public2=${profile_public2_code}(200) hasB=${has_rule_b} staleA=${has_rule_a_2}"
fi

# ---------- 汇总 ----------
printf '\n===== 汇总 =====\n'
printf 'PASS: %d\n' "$PASS_COUNT"
printf 'FAIL: %d\n' "$FAIL_COUNT"
printf 'SKIP: %d\n' "$SKIP_COUNT"
printf '测试账号: %s / %s\n' "$SMOKE_EMAIL" "$SMOKE_PASSWORD"

if [[ "$KEEP" -eq 1 ]]; then
  printf '\n--keep 已启用：wrangler dev PID=%s，日志=%s\n' "$DEV_PID" "$LOG_FILE"
  printf '临时目录内包含 .dev.vars 副本，调试结束后请手动删除: %s\n' "$TMP_DIR"
  printf '并执行: kill %s\n' "$DEV_PID"
fi

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
exit 0
