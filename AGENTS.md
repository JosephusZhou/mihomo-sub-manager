# AGENTS.md

面向 AI 编码助手的项目约定。改动前先读 [README.md](README.md)；本文件只记录从真实代码中总结出的架构、约束和边界，不写通用规范。

## 项目形态

- **后端**：单个 Cloudflare Worker，入口 `backend/src/index.js`，运行时为 Workers（非 Node）。`backend/wrangler.toml` 中 `name = "mihomo-sub-manager"`、`main = "src/index.js"`、`compatibility_flags = ["nodejs_compat"]`（`jose` 需要）。
- **前端**：Vue 3 + Vite 的纯静态 SPA，无 SSR、无 Cloudflare Functions。开发端口 3000，构建产物 `frontend/dist`，Pages 项目名 `mihomo-sub-manager-webui`。
- **根目录**：没有 `package.json` 或 workspace；常规命令在 `backend/` / `frontend/` 执行，部署统一走根目录 `scripts/deploy.sh`。
- **数据**：D1 存业务数据，KV 只做订阅结果缓存；没有 ORM，全部是 `env.DB.prepare(...)` 原生 SQL。

## 关键事实（不要凭直觉改动）

| 项 | 事实 |
| --- | --- |
| Worker 名称 | `mihomo-sub-manager`（`backend/wrangler.toml`）；D1 名称 `mihomo-sub-manager-db` |
| Pages 项目 | `mihomo-sub-manager-webui` |
| Worker 绑定 | D1：`env.DB`；KV：`env.CACHE` |
| 变量 | `WORKER_URL`、`ACCESS_TOKEN_TTL=900`、`REFRESH_TOKEN_TTL=2592000`、`SUB_CACHE_TTL=3600`（付费订阅包装缓存秒数，支持 `3600s`/`60m`/`1h`，范围 60–86400）；`JWT_SECRET` 是 Secret，不在仓库内，必须至少 32 字符；`src/auth.js` 在缺失或过短时直接抛错，没有开发回退值 |
| 鉴权 | `/api/*` 用 JWT Bearer（HS256）；`/subscribes`、`/profiles` 用查询参数 `token`，**不带 `/api`**；`/subscribes` 同时接受 `users.api_token`（私人订阅）与 `paid_sub_wrappers.token`（付费订阅包装地址），用户 token 优先 |
| Token 格式 | `api_token` / `profile_token` / 付费包装 token = 36 字节随机数的 base64url，48 字符（`src/db.js` 的 `generateToken`） |
| 密码哈希 | `SHA-256(密码 + "mihomo-salt-2026")` 小写十六进制（`src/db.js` 的 `hashPassword`） |
| 缓存 TTL | `/subscribes` 私人订阅 → `sub:v2:<sha256(api_token)>`，600 秒；`/profiles` → `profile:<sha256(profile_token)>`，300 秒；付费包装 → `paidsub:v2:<sha256(wrapper_token)>`，默认 3600 秒（`SUB_CACHE_TTL`），失败不缓存；键与失效集中在 `services/cache.js` |
| 公开响应 | 订阅与配置返回 `text/yaml; charset=utf-8`；CORS 统一 `Access-Control-Allow-Origin: *` |
| 节点类型 | 自定义节点表单支持 `ss`、`trojan`、`hysteria2`、`vmess`、`vless`、`tuic`；生成逻辑与 `routes/proxies.js` 的 `VALID_TYPES` 另含 `http`、`socks5`，只由链式导入产生 |
| 链式代理 | 与普通节点同表，靠 `dialer_proxy`（值为同用户前置节点 `name`）区分；`/api/chained-proxies` 提供列表/预览/导入/单条删除；单次导入上限 200 条、输入上限 2000 行 / 256 KB；前置节点必须是普通节点；删除前置节点会级联删除链式节点；私人订阅（`api_token`）只含 `dialer_proxy` 为空的节点 |
| 地区 | 共 10 个聚合地区：香港、台湾、韩国、日本、新加坡、美国、亚洲其他、美洲其他、欧洲、其他 |
| DNS 示例域名 | `nameserver-policy` 使用 `example.com` / `example.net` 等保留域作为占位，部署时按需替换，不是内置业务域名 |
| 自定义规则 | 每用户一份 `user_custom_rules`（JSON 数组，保持顺序）；`templates.include_custom_rules` 仅控制是否注入。勾选时插在 `rules:` 最前面（所有内置规则之前、`MATCH` 之前），按完整字符串去重；与内置规则重复时保留自定义那条；不勾选完全不注入。归一化在 `services/custom-rules.js`：trim/去空/去重，每条必须含逗号、≤512 字符、无 `\r\n`、禁用 `MATCH,` 开头，最多 500 条 |

## 目录与职责

```text
backend/src/index.js                 仅做路径分发、OPTIONS、CORS、顶层异常处理
backend/src/routes/*.js              每个资源一个 handler，内含参数校验与 SQL
backend/src/routes/chained-proxies.js 链式代理列表/预览/导入/单条删除（批量删除由前端逐条 DELETE）
backend/src/routes/templates.js      模板 CRUD + `/api/templates/:id/preview-rules`（真实 rule-providers/rules）
backend/src/routes/custom-rules.js   用户级共享自定义规则 GET/PUT（读写后清理档案缓存）
backend/src/auth.js                  signAccessToken / signRefreshToken / verifyToken / requireAuth / jsonResponse
backend/src/db.js                    generateToken / hashPassword / verifyPassword / sha256
backend/src/services/cache.js               缓存键生成与失效（订阅/档案/全部档案/用户级）
backend/src/services/config-generator.js     模板 + 私有节点 + 付费订阅 → 完整 Mihomo YAML
backend/src/services/custom-rules.js         共享规则读取（getUserCustomRules）与格式归一化（normalizeCustomRules）
backend/src/services/subscription-builder.js 节点 → `proxies:` 列表 YAML
backend/src/services/chained-proxy-parser.js 链式代理文本解析、去重、MAX_IMPORT=200
backend/src/services/paid-sub-fetcher.js     付费源地址 SSRF 校验、mihomo UA 拉取、SUB_CACHE_TTL 解析
backend/src/services/paid-sub-wrapper.js     包装 token 生成/复用、wrapper_url 拼装

frontend/src/api/client.js           axios 实例，baseURL = `${API_BASE_URL}/api`，401 自动 refresh
frontend/src/config.js               API_BASE_URL = import.meta.env.VITE_API_BASE_URL
frontend/src/stores/*.js             Pinia setup store，统一使用 swrFetch + invalidateCache
frontend/src/utils/cache.js          localStorage SWR，key 前缀 `cache:`，TTL 30 秒
frontend/src/utils/proxyConfig.js    粘贴 YAML 的键归一化与链式判断
frontend/src/views/*.vue             页面（含 ChainedProxiesView）；components/* 复用组件

scripts/deploy.sh                    交互式幂等部署：登录检查、D1/KV 自动创建/回填、schema、JWT 密钥、Worker、Pages、初始用户
scripts/dev-local.sh                 本地一键开发：本地 D1 + wrangler dev + vite dev，不接触远程
scripts/local-smoke.sh               本地接口冒烟测试（wrangler --local）
scripts/lib/wrangler-config.mjs      脚本用的极简 TOML 读写（get/set/set-routes）
```

## 命令

后端（`cd backend`）：

```bash
npm install
npm run dev                 # wrangler dev，默认 8787
npm run deploy              # wrangler deploy
npm run db:migrate          # 本地建表
npm run db:seed             # 本地系统模板
npm run db:remote:migrate   # 线上建表
npm run db:remote:seed      # 线上系统模板
```

前端（`cd frontend`）：

```bash
npm install
npm run dev                 # http://localhost:3000
npm run build               # dist/
npm run preview
```

部署（根目录）：

```bash
./scripts/deploy.sh                    # 交互式：wrangler whoami/login、参数提问、可选创建初始用户
./scripts/deploy.sh --env prod                    # 全流程（交互模式下仍会询问未指定的域名/seed/TTL）
./scripts/deploy.sh --non-interactive --env prod --api-domain api.example.com   # CI：默认值、不提问、不创建初始用户
./scripts/deploy.sh --env prod --api-domain api.example.com   # 后端自定义域名（routes + custom_domain）
./scripts/deploy.sh --env prod --api-domain api.example.com --web-domain app.example.com
./scripts/deploy.sh --frontend-only --api-domain api.example.com
./scripts/deploy.sh --env staging                 # 生成 wrangler.staging.toml，资源隔离
./scripts/deploy.sh --env prod --rotate-jwt-secret  # 主动轮换 JWT_SECRET，旧 token 立即失效
./scripts/deploy.sh --env prod --sub-cache-ttl 30m   # 付费包装缓存 30 分钟（默认 60m）
```

本地脚本（根目录，均不接触远程资源）：

```bash
./scripts/dev-local.sh                 # 本地 D1 + wrangler dev + vite dev；固定账号 dev@local.test
./scripts/dev-local.sh --no-build      # 跳过前端构建
./scripts/dev-local.sh --reset-password
./scripts/local-smoke.sh --fresh       # 本地接口冒烟，PASS/FAIL 汇总
./scripts/local-smoke.sh --keep --port 8790
```

`dev-local.sh` 与 `local-smoke.sh` 都依赖 `backend/.dev.vars` 中至少 32 字符的 `JWT_SECRET`；各自会创建 `.local-dev/`、`backend/.wrangler/smoke-state` 等本地状态（已 gitignore）。

仓库没有测试、lint、format 脚本，也没有提交 CI 配置（README 仅给出 GitHub Actions 示例）。改完至少跑一次 `cd frontend && npm run build`，并运行 `./scripts/local-smoke.sh --fresh`。

## 代码风格

- 全仓 ESM；2 空格缩进、单引号、语句末尾分号。
- 后端：路由文件导出 `handleXxx(request, env, path)`；响应统一走 `jsonResponse`，错误形状为 `{ error, details? }`，并带合适的 4xx/5xx。
- SQL 列名全部 snake_case；数字布尔在数据库中是 `0/1`。API 对外时，`include_private_sub` 转成真正的 boolean；`ad_blocking`、档案的 `enabled` 仍按 0/1 返回/接收，不要单方面“统一”；`proxies`、`paid_subscriptions` 已无 `enabled`。
- `config`、`regions`、`user_custom_rules.rules` 在 D1 中是 JSON 字符串，读出来后必须 `JSON.parse`；写入前必须 `JSON.stringify`。`templates` 已无 `custom_rules` 列。
- 前端：Vue `<script setup>` + Composition API；Pinia 用 setup store；样式只用 Tailwind utility class，不新增 CSS 文件。
- UI 文案为中文，没有 i18n 框架；新增文案直接写中文，不要引入 i18n。
- 不引入新依赖，除非确实必要；后端只有 `jose`（JWT）与 `js-yaml`（生成 YAML），前端已有 `js-yaml`（节点 YAML 粘贴解析）、`axios` 和 `uqr`（档案二维码本地渲染）。

## 修改边界（硬性要求）

1. **公开路径不能加 `/api`**。`/subscribes`、`/profiles` 同时在 `backend/src/index.js`、`frontend/vite.config.js` 的 proxy 和前端地址拼接中出现。改路径要同步：入口分发、Vite proxy、`ProxiesView.vue`（`/subscribes`）、`ProfilesView.vue` 与 `ProfileEditorView.vue`（`/profiles`）、`config-generator.js` 的 `customSubUrl`。
2. **前端展示地址与后端生成地址必须同源**。前端用 `API_BASE_URL`，后端用 `WORKER_URL`；换域名时 `frontend/.env.production` 与 `backend/wrangler.toml` 必须一起改，否则私人订阅会指向错误域名。推荐直接 `./scripts/deploy.sh --api-domain api.example.com`，它会同时写入 `routes`、`WORKER_URL` 并注入构建环境变量。不要在源码里硬编码域名。`.env.production` 里的 `https://api.example.com` 只是占位值。
3. **地区列表三处同步**：`backend/src/services/config-generator.js` 的 `REGION_BUCKETS`（含 `OTHER_EXCLUDE_FILTER`）、`backend/src/routes/templates.js` 的 `ALL_REGIONS`、`frontend/src/views/TemplateEditorView.vue` 的 `allRegions`（`TemplatesView.vue` 还有一份用于预览展示）。
4. **新增协议三处同步**：`backend/src/routes/proxies.js` 的 `VALID_TYPES`、`backend/src/services/subscription-builder.js` 的 `switch`、`frontend/src/components/proxy/ProxyForm.vue` 的类型下拉。`http`/`socks5` 只用于链式导入，解析入口在 `services/chained-proxy-parser.js` 的 `SCHEMES`；`subscription-builder.js` 的 `pick()` 同时接受下划线与连字符键（`plugin_opts`/`plugin-opts`、`ws_opts`/`ws-opts` 等），新增协议时保持该兼容策略。
5. **写操作必须失效缓存**，统一调用 `services/cache.js`（不要在各路由重复实现）。修改节点（含链式导入）→ `invalidateUserCache`（删订阅键 + 全部档案键）；修改模板/自定义规则/付费订阅 → `deleteAllProfileCaches`，付费订阅另加 `deletePaidSubCache`（删除订阅时先删缓存再删 token）。重置 `api_token` 时必须先按旧 token 删除缓存再更新数据库。不要只在路由里改数据而漏掉缓存。
6. **schema 变更只改 `schema.sql`**，并明确区分本地/线上执行命令；没有迁移框架，不要假设自动升级已有表结构。`templates.user_id = 0` 是系统模板，API 层只读。
7. **档案的“私人订阅”语义**：`profiles.include_private_sub = 1` 表示包含该用户**全部普通节点**（`proxies` 表按 `sort_order, id`，不含链式节点），不是逐节点选择；节点已没有启用/禁用状态。链式节点始终进入完整配置的顶层 `proxies`，不受该开关影响。`profile_paid_subs` 用于档案的付费订阅关联，正常参与生成。`profiles.enabled` 仅在 `updateProfile` 接受，`createProfile` 固定写入 1，公开接口在 0 时返回 403，前端没有启用/禁用开关。
8. **前端缓存键要登记**：`src/utils/cache.js` 的前缀是 `cache:`；`stores/auth.js` 的 `clearSwrCaches()` 手动清理 `proxies`、`chainedProxies`、`paidSubs`、`templates`、`profiles`、`customRules` 六个 key（`logout()` 与跨标签登出都会调用）。新增带缓存的 store 时，必须把 key 加进该函数，避免跨用户数据泄漏。
9. **不要提交密钥**。`JWT_SECRET`、`.dev.vars`、任何私钥都不得写入仓库；**禁止**写进 `wrangler.toml` 的 `[vars]`（明文配置）。`scripts/deploy.sh` 的取值顺序是：显式 `JWT_SECRET` 环境变量 → `backend/.dev.vars` 中已有的值 → 用 `openssl rand -hex 32` 生成并写入 `.dev.vars`（权限 600，已在 `.gitignore` 中），再通过 `wrangler secret put` 写入 Worker，全程不回显明文。**只在两处都不存在时生成一次，之后部署一律复用，绝不能每次部署重新生成**，否则所有已签发 token 立即失效；只有显式 `--rotate-jwt-secret` 才允许轮换（轮换会使旧 token 失效）。本地 `wrangler dev` 依赖 `backend/.dev.vars` 提供 `JWT_SECRET`（至少 32 字符），`src/auth.js` 没有开发回退值。GitHub Actions 部署时把密钥放仓库 Secrets（`secrets.JWT_SECRET`）并以环境变量传入，不落盘、不进日志。`wrangler.toml` 里的 D1/KV ID 不是密钥，但属于当前账号，复刻时由脚本自动替换。
10. **不要新增“用户注册”流程**，除非用户明确要求。当前只有登录接口。`scripts/deploy.sh` 在交互模式且后端部署完成后会询问是否创建初始用户（邮箱 + 两遍 `read -s` 密码，复用 `src/db.js` 的 `hashPassword` / `generateToken`；邮箱已存在则提示并跳过，不覆盖密码）。密码只通过 stdin 传给 Node，SQL 写入权限 600 的临时文件并在成功/失败后立即删除，明文与哈希不得出现在命令行参数、`ps` 或日志中；`--non-interactive` 或无 TTY 时不创建初始用户。手动 SQL 插入仍可作为兜底（README 有命令）。同理，不要在未确认的情况下新增管理员、计费、多租户等能力。
11. **部署名称与资源名由脚本统一管理**：Worker `mihomo-sub-manager`、Pages `mihomo-sub-manager-webui`、D1 `mihomo-sub-manager-db`、KV `mihomo-sub-manager-cache`；非 prod 环境追加 `-<env>`（KV 为 `mihomo-sub-manager-<env>-cache`）。改这些名称时同步修改 `scripts/deploy.sh`、README、AGENTS 和 `backend/wrangler.toml`。**D1 不能原地改名**：脚本检测到配置里的库名不是目标名时，会按名称创建/复用新库；本项目首版全新部署，不提供旧库迁移流程。`backend/package.json` 的 db 脚本也依赖 `mihomo-sub-manager-db`。
12. **后端自定义域名走 `routes` + `custom_domain`**。`--api-domain` 写入 `backend/wrangler.toml` 的顶层 `routes`，由 `wrangler deploy` 自动绑定；域名必须与 Worker 同账号且 DNS 由 Cloudflare 托管，否则部署失败。域名只写主机名（如 `api.example.com`），不要带 `https://` 或路径。**前端 Pages 自定义域名没有 CLI**，`wrangler pages` 无域名子命令；脚本只打印人工待办，不要实现 API Token 自动绑定。
13. **`scripts/lib/wrangler-config.mjs` 只支持项目所需的最小 TOML 子集**（顶层、`[[d1_databases]]`、`[[kv_namespaces]]`、`[vars]` 的字符串/数字键，以及 `set-routes` 生成的 `routes` 数组）。不要把它扩展成通用 TOML 解析器；新增分段时同步收窄假设并测试 `bash -n` 与真实配置读写。
14. **付费订阅必须走包装地址**。源地址只存 `paid_subscriptions.url`，列表/创建/更新响应与生成的 YAML 一律使用 `paid_sub_wrappers.token` 派生的 `${WORKER_URL}/subscribes?token=...`（仅 `GET /api/paid-subs/:id` 用 `includeSource` 为编辑放开源地址）；不要用可逆编码把源地址塞进 URL。新增/修改源地址必须经过 `paid-sub-fetcher.js` 的 `validateSourceUrl`（仅 http/https，拒绝 localhost/私网/云元数据）；拉取用 `redirect: 'manual'` 逐跳校验，避免 SSRF。缓存键必须由 token 派生，不得使用源地址；失败结果不缓存。`SUB_CACHE_TTL` 默认 3600 秒，解析后由后端截断到 60–86400，可用 `--sub-cache-ttl` 或 `[vars]` 调整。**`paid_subscriptions` 已无 `enabled` 字段**：不要重新引入启用/禁用开关或 `enabled = 1` 过滤，包装 token 有效即拉取。上游侧失败（超时、4xx/5xx、空内容、返回 HTML/非订阅）在 `/subscribes` 命中包装 token时改为 `302` 重定向到源地址（`Cache-Control: no-store`，不缓存）；请求侧失败（token 无效、订阅已删除、SSRF）仍返回错误。该重定向会向客户端暴露源地址，属于已确认的设计取舍。
15. **`proxies` 表没有 `enabled` 字段**（已彻底移除）：不要新增启用/禁用开关、`enabled` 参数或 `enabled = 1` 过滤；档案生成包含该用户全部节点（普通节点 + 链式节点），私人订阅只包含 `dialer_proxy` 为空的普通节点。
16. **模板不再存自定义规则**：`templates` 没有 `custom_rules` 列，只有 `include_custom_rules`（0/1）。规则统一放 `user_custom_rules.rules`（每用户一行 JSON 数组），通过 `/api/custom-rules` GET/PUT 维护。生成配置时由 `config-generator.js` 判断开关后再注入；不要在任何模板表单里重新引入规则编辑。首版全新部署，不需要旧库规则合并或 `ALTER TABLE`。
17. **链式代理的单一数据源**：`dialer_proxy` 列是唯一来源，节点 `config` 中的 `dialer_proxy`/`dialer-proxy` 在创建/更新时由 `routes/proxies.js` 丢弃。前置节点必须是同用户的普通节点（`dialer_proxy` 为空）；删除前置节点会级联删除引用它的链式节点；改名会同步更新引用。导入解析与上限（200 条 / 2000 行 / 256 KB）只在 `services/chained-proxy-parser.js` 中实现，预览与导入共用；批量删除由前端逐条调用 `DELETE /api/chained-proxies/:id`，没有后端批量接口。

## 改动后的验证清单

- 后端：`cd backend && npm run dev`；至少验证 `GET /health`、登录、一个受保护资源的 401/200 分支，以及对应公开订阅 URL 返回 YAML。
- 前端：`cd frontend && npm run build`；若改了登录、档案或订阅地址，确认 `API_BASE_URL` 拼接结果没有重复 `/api` 或双斜杠。
- 改了生成逻辑：用“档案预览”（`GET /api/profiles/:id/config`）或直接请求 `/profiles?token=` 对比 YAML，重点检查 `proxy-providers` 的 URL、`proxy-groups` 的地区组与链式组、`rules` 顺序（自定义规则在最前）。
- 改了链式代理：用 `POST /api/chained-proxies/preview` 验证各导入格式、去重与 200 条上限；确认私人订阅不包含链式节点、完整配置包含 `dialer-proxy`。
- 改了 KV 相关：确认缓存键的 sha256 计算与删除逻辑仍成对出现（统一走 `services/cache.js`）。
- 整体快速回归：`./scripts/local-smoke.sh --fresh`。

## 已知空缺（不要自行编造）

- 没有测试与 lint；`scripts/local-smoke.sh` 是唯一的自动化回归脚本，不要把它说成“测试套件”，只能报告实际执行的 PASS/FAIL。
- 没有提交 `_redirects`；`scripts/deploy.sh` 在构建后写入 `frontend/dist/_redirects`，不要假设源码目录里存在该文件。
- 仓库内没有提交 CI/CD 配置；README 提供了 GitHub Actions 示例（密钥走仓库 Secrets），实际发布仍由 `scripts/deploy.sh` 或手动 `wrangler deploy` / `wrangler pages deploy` 完成。
- 后端自定义域名由 `--api-domain` 写入 `routes` 并随 `wrangler deploy` 自动绑定；账号归属与 DNS 托管需用户自行满足。
- 前端 Pages 自定义域名与 DNS 只能由维护者在 Cloudflare 控制台处理；脚本不自动绑定，也不接入 Cloudflare API Token。
- 没有用户注册、找回密码、管理员角色。
- `profile_paid_subs` 正常参与档案生成。
- 首版不考虑历史兼容：没有迁移框架、旧库升级脚本或旧字段兼容代码；部署时对空库执行 `schema.sql` + `seed.sql`。
