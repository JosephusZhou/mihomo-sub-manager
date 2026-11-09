#!/usr/bin/env bash
#
# 从零部署 Mihomo 管理平台（macOS / bash 3.2+ 可直接运行）。
#
# 幂等行为：
#   - D1 / KV 已存在且 id 与当前账号、目标名称匹配时跳过创建；否则自动创建/复用并回填配置。
#   - 每次都会应用 schema.sql（CREATE TABLE IF NOT EXISTS），seed 默认执行（可用 --no-seed 关闭）。
#   - Pages 项目存在则跳过创建，始终重新构建并发布。
#   - --api-domain 会写入 wrangler 的 routes + custom_domain，由 wrangler deploy 自动绑定后端自定义域名。
#   - Pages 自定义域名不在脚本内自动绑定，结束时打印控制台人工操作提示。
#
# 交互行为（仅在 stdin 为终端且未传 --non-interactive 时启用）：
#   - 部署开始先执行 wrangler whoami；未登录时执行 wrangler login 打开浏览器授权。
#   - 依次询问环境、Worker 名称、Pages 项目名称、后端自定义域名、前端自定义域名、
#     是否 seed、付费订阅缓存 TTL；已有对应命令行参数时不重复提问。
#   - 后端部署完成后询问是否创建初始用户（邮箱 + 两遍密码，密码不回显）。
#   - --non-interactive 或没有 TTY 时使用默认值、跳过全部提问，且不创建初始用户。
#
# 密钥：显式 JWT_SECRET 环境变量 → backend/.dev.vars → 本地用 openssl 生成并写入 .dev.vars（权限 600）。
#       生成值不会回显；.dev.vars 已在 .gitignore 中。之后部署一律复用，不会重新生成。
#       只有显式传入 --rotate-jwt-secret 才会轮换，轮换后旧 token 立即失效。

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
CONFIG_HELPER="$SCRIPT_DIR/lib/wrangler-config.mjs"

ENV_NAME="prod"
SEED=1
DO_BACKEND=1
DO_FRONTEND=1
API_DOMAIN_ARG=""
API_DOMAIN=""
WEB_DOMAIN=""
API_URL=""
D1_LOCATION=""
PAGES_BRANCH="main"
ROTATE_JWT=0
SUB_CACHE_TTL_ARG=""

WORKER_NAME_ARG=""
WORKER_NAME_SET=0
PAGES_PROJECT_ARG=""
PAGES_PROJECT_SET=0

ENV_ARG_SET=0
API_DOMAIN_SET=0
WEB_DOMAIN_SET=0
SEED_SET=0
SUB_CACHE_TTL_SET=0
NON_INTERACTIVE=0
INTERACTIVE=0
INITIAL_USER_SQL_FILE=""

DEPLOY_LOG=""
D1_LIST_JSON=""
KV_LIST_JSON=""
PAGES_LIST_JSON=""

if [[ -t 1 ]]; then
  C_INFO=$'\033[36m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_INFO=""; C_WARN=""; C_ERR=""; C_DIM=""; C_RESET=""
fi

log()  { printf '%s[deploy]%s %s\n' "$C_INFO" "$C_RESET" "$*"; }
warn() { printf '%s[warn]%s %s\n' "$C_WARN" "$C_RESET" "$*" >&2; }
die()  { trap - ERR; printf '%s[error]%s %s\n' "$C_ERR" "$C_RESET" "$*" >&2; exit 1; }

on_error() {
  printf '%s[error]%s 部署中止（第 %s 行）。请查看上方输出。\n' "$C_ERR" "$C_RESET" "$LINENO" >&2
}
trap on_error ERR

cleanup() {
  [[ -n "$DEPLOY_LOG" && -f "$DEPLOY_LOG" ]] && rm -f "$DEPLOY_LOG"
  [[ -n "$INITIAL_USER_SQL_FILE" && -f "$INITIAL_USER_SQL_FILE" ]] && rm -f "$INITIAL_USER_SQL_FILE"
  return 0
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

prompt_value() {
  local prompt="$1" default="$2" outvar="$3" input
  if [[ -n "$default" ]]; then
    printf '%s [%s]: ' "$prompt" "$default"
  else
    printf '%s（留空跳过）: ' "$prompt"
  fi
  IFS= read -r input || { printf '\n'; return 1; }
  [[ -n "$input" ]] || input="$default"
  printf -v "$outvar" '%s' "$input"
}

prompt_parameters() {
  [[ "$INTERACTIVE" -eq 1 ]] || return 0
  if [[ "$ENV_ARG_SET" -eq 0 ]]; then
    prompt_value "部署环境 (prod/staging)" "prod" ENV_NAME || return 1
  fi
  # ENV_NAME 已确定，计算默认资源名供提示使用
  local default_worker default_pages
  if [[ "$ENV_NAME" == "prod" ]]; then
    default_worker="mihomo-sub-manager"
    default_pages="mihomo-sub-manager-webui"
  else
    default_worker="mihomo-sub-manager-$ENV_NAME"
    default_pages="mihomo-sub-manager-webui-$ENV_NAME"
  fi
  if [[ "$WORKER_NAME_SET" -eq 0 ]]; then
    prompt_value "Worker 名称（留空使用默认值）" "$default_worker" WORKER_NAME_ARG || return 1
    [[ -n "$WORKER_NAME_ARG" ]] && WORKER_NAME_SET=1
  fi
  if [[ "$PAGES_PROJECT_SET" -eq 0 ]]; then
    prompt_value "Pages 项目名称（留空使用默认值）" "$default_pages" PAGES_PROJECT_ARG || return 1
    [[ -n "$PAGES_PROJECT_ARG" ]] && PAGES_PROJECT_SET=1
  fi
  if [[ "$API_DOMAIN_SET" -eq 0 ]]; then
    prompt_value "后端自定义域名（留空使用 workers.dev 地址）" "" API_DOMAIN_ARG || return 1
  fi
  if [[ "$WEB_DOMAIN_SET" -eq 0 ]]; then
    prompt_value "前端自定义域名（留空跳过）" "" WEB_DOMAIN || return 1
  fi
  if [[ "$SEED_SET" -eq 0 ]]; then
    local ans
    printf '执行 seed.sql 初始化系统模板？[Y/n]: '
    IFS= read -r ans || { printf '\n'; return 1; }
    case "${ans:-y}" in
      y|Y|yes|YES) SEED=1 ;;
      n|N|no|NO) SEED=0 ;;
      *) warn "未识别的回答，按默认值执行 seed"; SEED=1 ;;
    esac
  fi
  if [[ "$SUB_CACHE_TTL_SET" -eq 0 ]]; then
    prompt_value "付费订阅缓存 TTL（如 60m，留空使用配置默认值）" "" SUB_CACHE_TTL_ARG || return 1
  fi
}

usage() {
  cat <<'EOF'
用法：
  ./scripts/deploy.sh [选项]

选项：
  --worker-name <名称>       自定义 Worker 名称。默认 prod 环境为 mihomo-sub-manager，
                             其他环境为 mihomo-sub-manager-<env>。只能包含小写字母、数字和连字符。
  --pages-project <名称>     自定义 Pages 项目名称。默认 prod 环境为 mihomo-sub-manager-webui，
                             其他环境为 mihomo-sub-manager-webui-<env>。只能包含小写字母、数字和连字符。
                             不能与 Worker 名称相同。
  --env <prod|staging|名称>  部署环境，默认 prod。
                             prod 使用 backend/wrangler.toml；其他环境会生成 backend/wrangler.<env>.toml。
                             D1 / KV 名称仍由环境决定，不受自定义 Worker / Pages 名称影响。
  --api-domain <域名>       后端自定义域名，只写主机名（如 api.example.com，不含 https:// 和路径）。
                             会写入 wrangler 配置的 routes + custom_domain，并回填 WORKER_URL；
                             前端构建也注入 https://<域名>。域名必须与 Worker 同属一个 Cloudflare
                             账号且 DNS 由 Cloudflare 托管，否则 wrangler deploy 会失败。
                             不传时沿用配置中已有的 WORKER_URL；若资源是新建的，则使用首次部署
                             输出的 workers.dev 地址并自动二次部署。
  --web-domain <域名>       前端 Pages 自定义域名，只写主机名（如 app.example.com）。
                             脚本不会自动绑定；部署结束会打印控制台人工绑定提示。
                             该域名不能与 --api-domain 相同。
  --seed                     显式开启 seed.sql（默认已开启）。
  --no-seed                  跳过 seed.sql。
  --backend-only             只处理后端。
  --frontend-only            只处理前端（必须能确定 API 地址）。
  --d1-location <区域>       仅在新建 D1 时传给 wrangler d1 create，如 apac、weur、eeur。
  --pages-branch <分支>      Pages 生产分支，默认 main。
  --rotate-jwt-secret        强制生成新的 JWT_SECRET，覆盖 backend/.dev.vars，并写入 Worker。
                             轮换后所有旧 token 立即失效，仅在需要时使用。
                             该参数不能与 JWT_SECRET 环境变量同时使用，避免轮换被覆盖。
  --sub-cache-ttl <时长>     付费订阅包装地址的 KV 缓存时长，默认 60m。
                             支持秒/分钟/小时：3600、3600s、60m、1h；范围 60s–24h。
                             机场更新频繁可用 15m–30m；多人共用可调 2h–3h。
  --non-interactive          跳过所有交互提问，使用默认值，且不创建初始用户。
                             适用于 CI、无 TTY 或需要无人值守部署的场景。
  -h, --help                 显示帮助。

交互流程（stdin 为终端且未传 --non-interactive 时）：
  1. 先执行 wrangler whoami 检查登录；未登录时自动执行 wrangler login 打开浏览器授权。
  2. 依次询问部署环境、Worker 名称、Pages 项目名称、后端自定义域名、前端自定义域名、
     是否执行 seed、付费订阅缓存 TTL；已有对应参数时不重复提问。
  3. 后端部署完成后询问是否创建初始用户；输入邮箱和两遍密码（密码不回显），
     邮箱已存在时提示并跳过，不会覆盖现有用户。

示例：
  ./scripts/deploy.sh --env prod
  ./scripts/deploy.sh --env prod --api-domain api.example.com
  ./scripts/deploy.sh --env prod --api-domain api.example.com --web-domain app.example.com
  ./scripts/deploy.sh --env staging --no-seed
  ./scripts/deploy.sh --frontend-only --api-domain api.example.com
  ./scripts/deploy.sh --env prod --rotate-jwt-secret
  ./scripts/deploy.sh --env prod --sub-cache-ttl 30m
  ./scripts/deploy.sh --non-interactive --env prod --api-domain api.example.com
  ./scripts/deploy.sh --frontend-only --api-domain api.example.com --non-interactive
  ./scripts/deploy.sh --worker-name my-worker --pages-project my-webui --api-domain api.example.com
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --worker-name)
      [[ $# -ge 2 ]] || die "--worker-name 需要参数"
      WORKER_NAME_SET=1; WORKER_NAME_ARG="$2"; shift 2 ;;
    --pages-project)
      [[ $# -ge 2 ]] || die "--pages-project 需要参数"
      PAGES_PROJECT_SET=1; PAGES_PROJECT_ARG="$2"; shift 2 ;;
    --env)
      [[ $# -ge 2 ]] || die "--env 需要参数"
      ENV_ARG_SET=1; ENV_NAME="$2"; shift 2 ;;
    --api-domain)
      [[ $# -ge 2 ]] || die "--api-domain 需要参数"
      API_DOMAIN_SET=1; API_DOMAIN_ARG="$2"; shift 2 ;;
    --web-domain)
      [[ $# -ge 2 ]] || die "--web-domain 需要参数"
      WEB_DOMAIN_SET=1; WEB_DOMAIN="$2"; shift 2 ;;
    --seed)
      SEED=1; SEED_SET=1; shift ;;
    --no-seed)
      SEED=0; SEED_SET=1; shift ;;
    --backend-only)
      DO_BACKEND=1; DO_FRONTEND=0; shift ;;
    --frontend-only)
      DO_BACKEND=0; DO_FRONTEND=1; shift ;;
    --d1-location)
      [[ $# -ge 2 ]] || die "--d1-location 需要参数"
      D1_LOCATION="$2"; shift 2 ;;
    --pages-branch)
      [[ $# -ge 2 ]] || die "--pages-branch 需要参数"
      PAGES_BRANCH="$2"; shift 2 ;;
    --rotate-jwt-secret)
      ROTATE_JWT=1; shift ;;
    --sub-cache-ttl)
      [[ $# -ge 2 ]] || die "--sub-cache-ttl 需要参数"
      SUB_CACHE_TTL_SET=1; SUB_CACHE_TTL_ARG="$2"; shift 2 ;;
    --non-interactive)
      NON_INTERACTIVE=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      die "未知参数：$1（使用 --help 查看用法）" ;;
  esac
done

if [[ "$NON_INTERACTIVE" -eq 0 && -t 0 ]]; then
  INTERACTIVE=1
fi
if [[ "$INTERACTIVE" -eq 1 ]]; then
  prompt_parameters || die "读取交互输入失败"
fi

[[ "$ENV_NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "环境名只能包含小写字母、数字和连字符：$ENV_NAME"
if [[ "$ROTATE_JWT" -eq 1 && "$DO_BACKEND" -eq 0 ]]; then
  die "--rotate-jwt-secret 需要处理后端，不能与 --frontend-only 同时使用。"
fi
if [[ -n "$SUB_CACHE_TTL_ARG" && ! "$SUB_CACHE_TTL_ARG" =~ ^[0-9]+(s|m|h)?$ ]]; then
  die "--sub-cache-ttl 格式应为 3600、3600s、60m 或 1h：$SUB_CACHE_TTL_ARG"
fi

if [[ "$ENV_NAME" == "prod" ]]; then
  WORKER_NAME="mihomo-sub-manager"
  PAGES_PROJECT="mihomo-sub-manager-webui"
  D1_NAME="mihomo-sub-manager-db"
  KV_TITLE="mihomo-sub-manager-cache"
  CONFIG="$BACKEND_DIR/wrangler.toml"
else
  WORKER_NAME="mihomo-sub-manager-$ENV_NAME"
  PAGES_PROJECT="mihomo-sub-manager-webui-$ENV_NAME"
  D1_NAME="mihomo-sub-manager-db-$ENV_NAME"
  KV_TITLE="mihomo-sub-manager-$ENV_NAME-cache"
  CONFIG="$BACKEND_DIR/wrangler.$ENV_NAME.toml"
fi

if [[ "$WORKER_NAME_SET" -eq 1 ]]; then
  [[ -n "$WORKER_NAME_ARG" ]] || die "--worker-name 不能为空。"
  [[ "$WORKER_NAME_ARG" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "Worker 名称只能包含小写字母、数字和连字符：$WORKER_NAME_ARG"
  WORKER_NAME="$WORKER_NAME_ARG"
fi
if [[ "$PAGES_PROJECT_SET" -eq 1 ]]; then
  [[ -n "$PAGES_PROJECT_ARG" ]] || die "--pages-project 不能为空。"
  [[ "$PAGES_PROJECT_ARG" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "Pages 项目名称只能包含小写字母、数字和连字符：$PAGES_PROJECT_ARG"
  PAGES_PROJECT="$PAGES_PROJECT_ARG"
fi
[[ "$WORKER_NAME" == "$PAGES_PROJECT" ]] && die "Worker 与 Pages 项目名称不能相同：$WORKER_NAME"

command -v node >/dev/null 2>&1 || die "未找到 node，请先安装 Node.js 18+"
command -v npm  >/dev/null 2>&1 || die "未找到 npm，请先安装 Node.js 18+"

ensure_deps() {
  local dir="$1"
  if [[ ! -d "$dir/node_modules" ]]; then
    log "安装依赖：$dir"
    if [[ -f "$dir/package-lock.json" ]]; then
      (cd "$dir" && npm ci)
    else
      (cd "$dir" && npm install)
    fi
  fi
}

WRANGLER_BIN="$BACKEND_DIR/node_modules/.bin/wrangler"
w() {
  if [[ -x "$WRANGLER_BIN" ]]; then
    "$WRANGLER_BIN" "$@"
  else
    npx --yes wrangler "$@"
  fi
}

normalize_url() {
  local url="$1"
  while [[ "$url" == */ ]]; do url="${url%/}"; done
  [[ "$url" =~ ^https://[^[:space:]]+$ ]] || die "API 地址必须是 https:// 开头且不含空格：$1"
  printf '%s' "$url"
}

normalize_domain() {
  local domain="$1"
  domain="${domain#http://}"
  domain="${domain#https://}"
  while [[ "$domain" == */ ]]; do domain="${domain%/}"; done
  [[ "$domain" != */* && "$domain" != *[[:space:]]* ]] || die "域名只写主机名，不要包含协议和路径：$1"
  [[ "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "域名格式不合法：$1"
  [[ "$domain" != *..* ]] || die "域名格式不合法：$1"
  printf '%s' "$domain" | tr '[:upper:]' '[:lower:]'
}

if [[ -n "$API_DOMAIN_ARG" ]]; then
  API_DOMAIN="$(normalize_domain "$API_DOMAIN_ARG")"
fi
if [[ -n "$WEB_DOMAIN" ]]; then
  WEB_DOMAIN="$(normalize_domain "$WEB_DOMAIN")"
fi
if [[ -n "$API_DOMAIN" && -n "$WEB_DOMAIN" && "$API_DOMAIN" == "$WEB_DOMAIN" ]]; then
  die "--api-domain 与 --web-domain 不能是同一个域名：$API_DOMAIN"
fi

get_conf() { node "$CONFIG_HELPER" get "$CONFIG" "$1" "$2"; }
set_conf() { node "$CONFIG_HELPER" set "$CONFIG" "$1" "$2" "$3"; }
set_routes() { node "$CONFIG_HELPER" set-routes "$CONFIG" "$1"; }

generate_config() {
  log "生成 Wrangler 配置：$CONFIG"
  cat > "$CONFIG" <<EOF
name = "$WORKER_NAME"
main = "src/index.js"
compatibility_date = "2026-11-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "$D1_NAME"

[[kv_namespaces]]
binding = "CACHE"

[vars]
WORKER_URL = ""
ACCESS_TOKEN_TTL = 900
REFRESH_TOKEN_TTL = 2592000
SUB_CACHE_TTL = "3600"
EOF
}

prepare_config() {
  if [[ ! -f "$CONFIG" ]]; then
    generate_config
  fi

  set_conf '' name "$WORKER_NAME"
  set_conf d1 database_name "$D1_NAME"
  set_conf kv binding "CACHE"

  # 只在显式传参时覆盖，缺省保留配置文件中的值。
  if [[ -n "$SUB_CACHE_TTL_ARG" ]]; then
    set_conf vars SUB_CACHE_TTL "$SUB_CACHE_TTL_ARG"
  fi
}


normalize_list() {
  node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.result) ? data.result : null);
    if (!list) process.exit(1);
    process.stdout.write(JSON.stringify(list));
  } catch {
    process.exit(1);
  }
});
'
}

refresh_d1_list() {
  local raw
  if ! raw="$(w d1 list --json 2>/dev/null)"; then
    die "无法读取 D1 列表，请检查登录状态与账号权限。"
  fi
  D1_LIST_JSON="$(printf '%s' "$raw" | normalize_list)" || die "D1 列表不是合法 JSON。"
}

refresh_kv_list() {
  local raw
  if ! raw="$(w kv namespace list 2>/dev/null)"; then
    die "无法读取 KV namespace 列表，请检查登录状态与账号权限。"
  fi
  KV_LIST_JSON="$(printf '%s' "$raw" | normalize_list)" || die "KV 列表不是合法 JSON。"
}

refresh_pages_list() {
  local raw
  if ! raw="$(w pages project list --json 2>/dev/null)"; then
    die "无法读取 Pages 项目列表，请检查登录状态与账号权限。"
  fi
  PAGES_LIST_JSON="$(printf '%s' "$raw" | normalize_list)" || die "Pages 项目列表不是合法 JSON。"
}

d1_id_exists() {
  printf '%s' "$D1_LIST_JSON" | node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const id = process.argv[1];
  const list = JSON.parse(raw);
  process.exit(list.some((item) => (item.uuid || item.database_id) === id) ? 0 : 1);
});
' "$1"
}

d1_find_id_by_name() {
  printf '%s' "$D1_LIST_JSON" | node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const name = process.argv[1];
  const list = JSON.parse(raw);
  const hit = list.find((item) => item.name === name || item.database_name === name);
  if (hit) process.stdout.write(hit.uuid || hit.database_id || "");
});
' "$D1_NAME"
}

d1_name_by_id() {
  printf '%s' "$D1_LIST_JSON" | node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const id = process.argv[1];
  const list = JSON.parse(raw);
  const hit = list.find((item) => (item.uuid || item.database_id) === id);
  if (hit) process.stdout.write(hit.name || hit.database_name || "");
});
' "$1"
}

kv_id_exists() {
  printf '%s' "$KV_LIST_JSON" | node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const id = process.argv[1];
  const list = JSON.parse(raw);
  process.exit(list.some((item) => item.id === id) ? 0 : 1);
});
' "$1"
}

kv_find_id_by_title() {
  printf '%s' "$KV_LIST_JSON" | node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const title = process.argv[1];
  const list = JSON.parse(raw);
  const hit = list.find((item) => item.title === title);
  if (hit) process.stdout.write(hit.id || "");
});
' "$KV_TITLE"
}

pages_project_exists() {
  printf '%s' "$PAGES_LIST_JSON" | node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const name = process.argv[1];
  const list = JSON.parse(raw);
  const hit = list.some((item) => item["Project Name"] === name || item.name === name);
  process.exit(hit ? 0 : 1);
});
' "$PAGES_PROJECT"
}

ensure_d1() {
  local current_id current_name found_id
  current_id="$(get_conf d1 database_id || true)"
  refresh_d1_list

  if [[ -n "$current_id" ]]; then
    if d1_id_exists "$current_id"; then
      current_name="$(d1_name_by_id "$current_id")"
      if [[ "$current_name" == "$D1_NAME" ]]; then
        log "D1 已存在，跳过创建：$current_id（$current_name）"
        return 0
      fi
      warn "配置中的 D1 名称是 ${current_name}，目标名称是 ${D1_NAME}。"
      warn "D1 不支持原地改名，将创建/复用目标名称的新库；旧库数据不会自动迁移。"
    else
      warn "配置中的 database_id（${current_id}）不属于当前账号，将重新创建并回填。"
    fi
  fi

  found_id="$(d1_find_id_by_name || true)"
  if [[ -n "$found_id" ]]; then
    log "按名称复用已有 D1：$D1_NAME"
  else
    log "创建 D1 数据库：$D1_NAME"
    if [[ -n "$D1_LOCATION" ]]; then
      (cd "$BACKEND_DIR" && w d1 create "$D1_NAME" --config "$CONFIG" --location "$D1_LOCATION")
    else
      (cd "$BACKEND_DIR" && w d1 create "$D1_NAME" --config "$CONFIG")
    fi
    refresh_d1_list
    found_id="$(d1_find_id_by_name || true)"
    [[ -n "$found_id" ]] || die "D1 创建成功但无法从列表解析 database_id。"
  fi

  set_conf d1 database_id "$found_id"
  log "已回填 database_id：$found_id"
}

ensure_kv() {
  local current_id found_id
  current_id="$(get_conf kv id || true)"
  refresh_kv_list

  if [[ -n "$current_id" ]]; then
    if kv_id_exists "$current_id"; then
      log "KV 已存在，跳过创建：$current_id"
      return 0
    fi
    warn "配置中的 KV id（${current_id}）不属于当前账号，将重新创建并回填。"
  fi

  found_id="$(kv_find_id_by_title || true)"
  if [[ -n "$found_id" ]]; then
    log "按名称复用已有 KV：$KV_TITLE"
  else
    log "创建 KV namespace：$KV_TITLE"
    (cd "$BACKEND_DIR" && w kv namespace create "$KV_TITLE" --config "$CONFIG")
    refresh_kv_list
    found_id="$(kv_find_id_by_title || true)"
    [[ -n "$found_id" ]] || die "KV 创建成功但无法从列表解析 id。"
  fi

  set_conf kv id "$found_id"
  log "已回填 KV id：$found_id"
}

apply_sql() {
  local name="$1"
  log "应用 SQL：$name"
  (cd "$BACKEND_DIR" && w d1 execute "$D1_NAME" --remote --config "$CONFIG" --file="$name" -y)
}

read_dev_var() {
  local name="$1" file="$BACKEND_DIR/.dev.vars" line value
  [[ -f "$file" ]] || return 1
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${name}[[:space:]]*=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1
  value="${line#*=}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  [[ -n "$value" ]] || return 1
  printf '%s' "$value"
}

generate_jwt_secret() {
  command -v openssl >/dev/null 2>&1 || die "未找到 openssl，无法自动生成 JWT_SECRET。请设置 JWT_SECRET 环境变量，或在 backend/.dev.vars 中提供。"
  openssl rand -hex 32
}

write_dev_var() {
  local name="$1" value="$2" file="$BACKEND_DIR/.dev.vars" tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/mihomo-dev-vars.XXXXXX")"
  chmod 600 "$tmp"
  if [[ -f "$file" ]]; then
    grep -vE "^[[:space:]]*(export[[:space:]]+)?${name}[[:space:]]*=" "$file" > "$tmp" || true
  fi
  printf '%s=%s\n' "$name" "$value" >> "$tmp"
  mv "$tmp" "$file"
  chmod 600 "$file"
}

load_jwt_secret() {
  local secret=""

  if [[ "$ROTATE_JWT" -eq 1 ]]; then
    [[ -z "${JWT_SECRET:-}" ]] || die "检测到 JWT_SECRET 环境变量；请先取消该变量再执行 --rotate-jwt-secret，避免轮换被环境变量覆盖。"
    secret="$(generate_jwt_secret)"
    write_dev_var JWT_SECRET "$secret"
    printf '%s[deploy]%s JWT_SECRET 已轮换并保存到 backend/.dev.vars（权限 600），请妥善备份，不要提交到仓库。\n' "$C_INFO" "$C_RESET" >&2
    printf '%s[deploy]%s 旧 token 会立即失效，请重新登录。\n' "$C_INFO" "$C_RESET" >&2
    printf '%s' "$secret"
    return 0
  fi

  if [[ -n "${JWT_SECRET:-}" ]]; then
    secret="$JWT_SECRET"
  else
    secret="$(read_dev_var JWT_SECRET || true)"
  fi

  if [[ -z "$secret" ]]; then
    secret="$(generate_jwt_secret)"
    write_dev_var JWT_SECRET "$secret"
    printf '%s[deploy]%s 未找到 JWT_SECRET，已生成并保存到 backend/.dev.vars（权限 600）。请妥善备份，不要提交到仓库。\n' "$C_INFO" "$C_RESET" >&2
  fi

  [[ -n "$secret" ]] || die "JWT_SECRET 不能为空。"
  if [[ ${#secret} -lt 32 ]]; then
    die "JWT_SECRET 至少需要 32 个字符（当前 ${#secret}）。"
  fi
  printf '%s' "$secret"
}

put_jwt_secret() {
  local secret="$1"
  log "写入 Worker secret：JWT_SECRET"
  if ! printf '%s' "$secret" | (cd "$BACKEND_DIR" && w secret put JWT_SECRET --config "$CONFIG" --name "$WORKER_NAME" >/dev/null); then
    die "写入 JWT_SECRET 失败，请检查登录状态、账号权限以及 Worker 是否存在。"
  fi
}

deploy_worker() {
  log "部署 Worker：$WORKER_NAME"
  [[ -n "$DEPLOY_LOG" && -f "$DEPLOY_LOG" ]] && rm -f "$DEPLOY_LOG"
  DEPLOY_LOG="$(mktemp "${TMPDIR:-/tmp}/mihomo-deploy-log.XXXXXX")"
  if ! (cd "$BACKEND_DIR" && w deploy --config "$CONFIG" --name "$WORKER_NAME") 2>&1 | tee "$DEPLOY_LOG"; then
    die "Worker 部署失败。若使用 --api-domain，请确认该域名与 Worker 同属一个 Cloudflare 账号且 DNS 由 Cloudflare 托管，并查看上方 Wrangler 输出。"
  fi
}

extract_deploy_url() {
  grep -Eo 'https://[A-Za-z0-9._-]+\.workers\.dev' "$DEPLOY_LOG" | tail -n 1 || true
}

deploy_backend() {
  ensure_deps "$BACKEND_DIR"
  [[ -x "$WRANGLER_BIN" ]] || die "未找到 wrangler，请先在 backend 执行 npm ci。"

  prepare_config

  if [[ -n "$API_DOMAIN" ]]; then
    log "配置后端自定义域名：$API_DOMAIN"
    log "要求：该域名与 Worker 同属一个 Cloudflare 账号，且 DNS 由 Cloudflare 托管。"
    set_routes "$API_DOMAIN"
    set_conf vars WORKER_URL "https://$API_DOMAIN"
    API_URL="https://$API_DOMAIN"
  else
    API_URL=""
  fi

  ensure_d1
  ensure_kv

  apply_sql schema.sql
  if [[ "$SEED" -eq 1 ]]; then
    apply_sql seed.sql
  else
    log "已跳过 seed.sql"
  fi

  local secret
  secret="$(load_jwt_secret)"

  deploy_worker
  put_jwt_secret "$secret"
  unset secret

  local deployed_url config_url
  deployed_url="$(extract_deploy_url)"
  config_url="$(get_conf vars WORKER_URL || true)"

  if [[ -z "$API_URL" ]]; then
    if [[ -n "$config_url" ]]; then
      API_URL="$config_url"
    elif [[ -n "$deployed_url" ]]; then
      API_URL="$deployed_url"
    fi
  fi

  [[ -n "$API_URL" ]] || die "无法确定 Worker 对外地址。请使用 --api-domain 指定自定义域名。"

  API_URL="$(normalize_url "$API_URL")"
  if [[ "$(get_conf vars WORKER_URL || true)" != "$API_URL" ]]; then
    set_conf vars WORKER_URL "$API_URL"
    warn "WORKER_URL 已更新为 ${API_URL}，需要重新部署使配置生效。"
    deploy_worker
  fi

  log "后端完成：$API_URL"
  if [[ "$ROTATE_JWT" -eq 1 ]]; then
    warn "JWT_SECRET 已轮换，所有旧 token 立即失效；请通知用户重新登录。"
  fi
}

deploy_frontend() {
  ensure_deps "$BACKEND_DIR"
  ensure_deps "$FRONTEND_DIR"
  [[ -x "$WRANGLER_BIN" ]] || die "未找到 wrangler，请先在 backend 执行 npm ci。"

  refresh_pages_list
  if pages_project_exists; then
    log "Pages 项目已存在，跳过创建：$PAGES_PROJECT"
  else
    log "创建 Pages 项目：$PAGES_PROJECT"
    w pages project create "$PAGES_PROJECT" --production-branch "$PAGES_BRANCH"
    refresh_pages_list
  fi

  log "构建前端（VITE_API_BASE_URL=${API_URL}）"
  (cd "$FRONTEND_DIR" && VITE_API_BASE_URL="$API_URL" npm run build)

  # Cloudflare Pages 的 SPA 回退规则；若 public/ 已生成同名文件则不覆盖。
  if [[ ! -f "$FRONTEND_DIR/dist/_redirects" ]]; then
    printf '/* /index.html 200\n' > "$FRONTEND_DIR/dist/_redirects"
  fi

  log "发布 Pages：$PAGES_PROJECT"
  (cd "$FRONTEND_DIR" && w pages deploy dist --project-name "$PAGES_PROJECT" --branch "$PAGES_BRANCH" --commit-dirty=true)

  log "前端完成：https://$PAGES_PROJECT.pages.dev"
}

ensure_login() {
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    log "检测到 CLOUDFLARE_API_TOKEN，跳过交互登录检查。"
    return 0
  fi
  if (cd "$BACKEND_DIR" && w whoami) >/dev/null 2>&1; then
    log "Cloudflare 已登录。"
    return 0
  fi
  if [[ "$INTERACTIVE" -eq 0 ]]; then
    die "Cloudflare 未登录，且当前为非交互环境。请先执行 \`cd backend && npx wrangler login\`，或设置 CLOUDFLARE_API_TOKEN 后重试。"
  fi
  log "Cloudflare 未登录，正在打开浏览器执行 wrangler login ..."
  if ! (cd "$BACKEND_DIR" && w login); then
    die "wrangler login 失败，请检查浏览器授权或网络；也可设置 CLOUDFLARE_API_TOKEN 后重试。"
  fi
  if ! (cd "$BACKEND_DIR" && w whoami) >/dev/null 2>&1; then
    die "wrangler login 后仍未确认登录状态，请重试。"
  fi
  log "Cloudflare 登录成功。"
}

create_initial_user() {
  local email password password2 sql_email sq count creds hash token sql_file
  printf '邮箱（留空跳过）: '
  IFS= read -r email || { printf '\n'; log "已跳过初始用户创建。"; return 0; }
  if [[ -z "$email" ]]; then
    log "已跳过初始用户创建。"
    return 0
  fi
  if [[ ! "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
    warn "邮箱格式不合法：${email}，已跳过初始用户创建。"
    return 0
  fi

  printf '密码（留空跳过）: '
  IFS= read -rs password || { printf '\n'; log "已跳过初始用户创建。"; return 0; }
  printf '\n'
  if [[ -z "$password" ]]; then
    log "已跳过初始用户创建。"
    return 0
  fi
  printf '再次输入密码: '
  IFS= read -rs password2 || { printf '\n'; log "已跳过初始用户创建。"; return 0; }
  printf '\n'
  if [[ "$password" != "$password2" ]]; then
    warn "两次输入的密码不一致，已跳过初始用户创建。"
    unset password password2
    return 0
  fi

  # SQL 字符串里的单引号需要写成两个单引号。
  sq="'"
  sql_email="${email//$sq/$sq$sq}"
  if ! count="$(cd "$BACKEND_DIR" && w d1 execute "$D1_NAME" --remote --config "$CONFIG" --json --command "SELECT COUNT(*) AS cnt FROM users WHERE email = '$sql_email'" 2>/dev/null)"; then
    unset password password2
    die "查询 D1 用户失败，请检查登录状态、账号权限与 D1 名称。"
  fi
  count="$(printf '%s' "$count" | node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.result) ? data.result : [data]);
    for (const item of list) {
      const row = item && item.results && item.results[0];
      if (row && row.cnt !== undefined) { process.stdout.write(String(row.cnt)); return; }
    }
    process.exit(1);
  } catch {
    process.exit(1);
  }
});
')" || { unset password password2; die "无法解析 D1 查询结果。"; }
  if [[ "$count" != "0" ]]; then
    warn "邮箱已存在，跳过创建：$email"
    unset password password2
    return 0
  fi

  # 密码只通过 stdin 传给 Node，不出现在命令行参数与 ps 输出中。
  if ! creds="$(printf '%s' "$password" | node --input-type=module -e '
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { pathToFileURL } from "node:url";
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", async () => {
  try {
    const db = await import(pathToFileURL(process.argv[1]).href);
    const hash = await db.hashPassword(raw);
    const token = await db.generateToken();
    process.stdout.write(hash + "\n" + token);
  } catch (err) {
    process.stderr.write(String(err && err.message ? err.message : err) + "\n");
    process.exit(1);
  }
});
' "$BACKEND_DIR/src/db.js")"; then
    unset password password2
    die "生成密码哈希失败，请检查 Node.js 环境与 backend/src/db.js。"
  fi
  hash="${creds%%$'\n'*}"
  token="${creds#*$'\n'}"
  unset password password2 creds
  [[ -n "$hash" && -n "$token" ]] || die "生成密码哈希或 api_token 失败。"

  sql_file="$(mktemp "${TMPDIR:-/tmp}/mihomo-initial-user.XXXXXX")" || die "无法创建临时 SQL 文件。"
  chmod 600 "$sql_file"
  INITIAL_USER_SQL_FILE="$sql_file"
  printf "INSERT INTO users (email, password_hash, api_token) VALUES ('%s', '%s', '%s');\n" \
    "$sql_email" "$hash" "$token" > "$sql_file"
  unset hash token

  if ! (cd "$BACKEND_DIR" && w d1 execute "$D1_NAME" --remote --config "$CONFIG" --file="$sql_file" -y); then
    rm -f "$sql_file"
    INITIAL_USER_SQL_FILE=""
    die "初始用户写入失败，请检查 D1 状态与账号权限。"
  fi
  rm -f "$sql_file"
  INITIAL_USER_SQL_FILE=""
  log "初始用户已创建：$email"
  warn "请妥善保管密码；脚本不会保存或输出明文密码与密码哈希。"
}

prompt_initial_user() {
  local answer
  printf '是否创建初始用户？[y/N]: '
  IFS= read -r answer || { printf '\n'; log "已跳过初始用户创建。"; return 0; }
  case "$answer" in
    y|Y|yes|YES) create_initial_user ;;
    *) log "已跳过初始用户创建。" ;;
  esac
}

main() {
  log "环境：$ENV_NAME"
  log "Worker：${WORKER_NAME}；Pages：${PAGES_PROJECT}；配置文件：${CONFIG}"

  ensure_deps "$BACKEND_DIR"
  ensure_login

  if [[ "$DO_BACKEND" -eq 1 ]]; then
    deploy_backend
    if [[ "$INTERACTIVE" -eq 1 ]]; then
      prompt_initial_user
    else
      log "非交互模式：跳过初始用户创建。"
    fi
  fi

  if [[ "$DO_FRONTEND" -eq 1 ]]; then
    if [[ -z "$API_URL" ]]; then
      if [[ -n "$API_DOMAIN" ]]; then
        API_URL="https://$API_DOMAIN"
      elif [[ -f "$CONFIG" ]]; then
        API_URL="$(get_conf vars WORKER_URL || true)"
      fi
      [[ -n "$API_URL" ]] || die "前端构建需要 API 地址：请使用 --api-domain，或先部署后端并在配置中写入 WORKER_URL。"
      API_URL="$(normalize_url "$API_URL")"
    fi
    deploy_frontend
  fi

  printf '\n%s完成%s\n  Worker: %s\n  API:    %s\n  Pages:  https://%s.pages.dev\n' \
    "$C_INFO" "$C_RESET" "$WORKER_NAME" "$API_URL" "$PAGES_PROJECT"

  if [[ "$DO_FRONTEND" -eq 1 ]]; then
    printf '\n%s人工待办%s\n' "$C_WARN" "$C_RESET"
    if [[ -n "$WEB_DOMAIN" ]]; then
      printf '  1. 到 Cloudflare 控制台 → Workers & Pages → %s → Custom domains 绑定前端域名：%s\n' "$PAGES_PROJECT" "$WEB_DOMAIN"
    else
      printf '  1. 到 Cloudflare 控制台 → Workers & Pages → %s → Custom domains 绑定前端自定义域名。\n' "$PAGES_PROJECT"
    fi
    if [[ -n "$API_DOMAIN" ]]; then
      printf '  2. 绑定完成后，确认前端访问的 API 地址指向已绑定的后端自定义域名：https://%s\n' "$API_DOMAIN"
    else
      printf '  2. 绑定完成后，确认前端访问的 API 地址指向后端地址：%s（建议用 --api-domain 配置自定义域名）。\n' "$API_URL"
    fi
    printf '  3. 若控制台要求 DNS 记录，可将前端域名 CNAME 到 %s.pages.dev（同账号下通常由控制台自动处理）。\n' "$PAGES_PROJECT"
    printf '  脚本不会自动绑定 Pages 自定义域名，请以上述控制台操作为准。\n'
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
