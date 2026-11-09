# Mihomo 管理平台

一个面向 [Mihomo](https://github.com/MetaCubeX/mihomo)（Clash.Meta）的订阅与配置管理平台。用户在网页端维护私人代理节点、链式代理、付费机场订阅和配置模板，并生成可直接导入 Mihomo 的完整 YAML 配置；同时每个“配置档案”都有独立的公开订阅地址和 Token，便于分享或在多台设备上使用。

项目为前后端分离结构，两部分独立安装、独立运行、独立部署：

- **后端**：Cloudflare Workers（`backend/`），Worker 名称 `mihomo-sub-manager`，使用 D1（SQLite）存数据、KV 做订阅缓存，负责鉴权、CRUD、生成 Mihomo YAML。
- **前端**：Vue 3 + Vite + Tailwind CSS 单页应用（`frontend/`），Cloudflare Pages 项目名 `mihomo-sub-manager-webui`，构建为静态文件，也可部署到任意静态托管。

> 根目录没有 `package.json` 或 workspace 配置。除 `scripts/*.sh` 外，其余命令都需要进入 `backend/` 或 `frontend/` 后执行。

## 技术栈

| 部分 | 主要依赖 | 说明 |
| --- | --- | --- |
| 后端 | `wrangler ^4.0.0`、`jose ^6.0.11`、`js-yaml ^5.5.0` | Worker 运行时；`jose` 负责 HS256 JWT（需要 `nodejs_compat`）；`js-yaml` 负责生成 YAML |
| 前端 | `vue ^3.5.13`、`vue-router ^4.5.0`、`pinia ^2.3.0`、`axios ^1.7.9`、`js-yaml ^4.1.0`、`uqr ^0.1.3` | SPA、路由、状态管理、请求、YAML 解析、本地二维码渲染 |
| 前端构建 | `vite ^6.0.5`、`@vitejs/plugin-vue ^5.2.1`、`tailwindcss ^3.4.17`、`postcss ^8.4.49`、`autoprefixer ^10.4.20` | 构建与样式 |

## 目录结构

```text
.
├── backend/                     # Cloudflare Worker
│   ├── src/
│   │   ├── index.js             # Worker 入口：OPTIONS/CORS、按路径分发、顶层异常
│   │   ├── auth.js              # JWT 签发/校验、requireAuth、JSON 响应工具
│   │   ├── db.js                # Token 生成、SHA-256、密码哈希
│   │   ├── routes/
│   │   │   ├── auth.js          # /api/auth/*
│   │   │   ├── proxies.js       # /api/proxies/*（自定义节点）
│   │   │   ├── chained-proxies.js # /api/chained-proxies/*（链式代理导入/预览/删除）
│   │   │   ├── paid-subs.js     # /api/paid-subs/*
│   │   │   ├── templates.js     # /api/templates/*（含 preview-rules）
│   │   │   ├── custom-rules.js  # /api/custom-rules（用户级共享规则）
│   │   │   ├── profiles.js      # /api/profiles/*
│   │   │   └── public.js        # /subscribes、/profiles（Token 公开访问）
│   │   └── services/
│   │       ├── cache.js                # 缓存键生成与失效（订阅/档案/付费包装）
│   │       ├── config-generator.js     # 模板 + 节点 + 付费订阅 → 完整 Mihomo YAML
│   │       ├── custom-rules.js         # 共享规则读取与格式归一化
│   │       ├── subscription-builder.js # 节点 → `proxies:` 列表 YAML
│   │       ├── chained-proxy-parser.js # 链式代理文本解析与上限
│   │       ├── paid-sub-fetcher.js     # 付费源 SSRF 校验、拉取、SUB_CACHE_TTL 解析
│   │       └── paid-sub-wrapper.js     # 包装 token 生成/复用、wrapper_url 拼装
│   ├── schema.sql               # D1 建表语句
│   ├── seed.sql                 # 4 个系统模板
│   ├── wrangler.toml            # Worker 名称、D1/KV 绑定、vars
│   └── package.json
├── frontend/                    # Vue 3 SPA
│   ├── src/
│   │   ├── api/client.js        # axios 实例、Bearer 注入、401 自动刷新
│   │   ├── config.js            # API_BASE_URL（读取 VITE_API_BASE_URL）
│   │   ├── router/index.js      # 路由与登录守卫
│   │   ├── stores/              # auth / proxies / chainedProxies / paidSubs / templates / customRules / profiles
│   │   ├── views/               # 仪表盘、节点、链式代理、付费订阅、模板、自定义规则、档案、登录
│   │   ├── components/          # 布局、弹窗、节点表单、节点预览
│   │   └── utils/               # cache.js（SWR）、proxyConfig.js（YAML 粘贴归一化）、toast.js
│   ├── vite.config.js           # 端口 3000、@ 别名、/api 等代理
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── .env.development         # VITE_API_BASE_URL=http://localhost:8787
│   ├── .env.production          # VITE_API_BASE_URL=https://api.example.com（占位）
│   ├── index.html
│   └── package.json
├── scripts/
│   ├── deploy.sh                # 交互式幂等部署：登录检查、D1/KV、schema、secrets、Worker、Pages、初始用户
│   ├── dev-local.sh             # 本地一键开发：本地 D1 + wrangler dev + vite dev
│   ├── local-smoke.sh           # 本地接口冒烟测试（--local，不接触远程）
│   └── lib/wrangler-config.mjs  # 脚本用的极简 wrangler TOML 读写工具
├── .gitignore
├── README.md
└── AGENTS.md
```

## 架构与数据流

```text
浏览器 (Vue SPA)
  └─ axios baseURL = `${VITE_API_BASE_URL}/api`
        └─ Cloudflare Worker
              ├─ 鉴权：JWT Bearer（/api/*）
              ├─ D1：users / proxies / paid_subscriptions / paid_sub_wrappers /
              │      templates / user_custom_rules / profiles /
              │      profile_paid_subs
              └─ KV：订阅结果缓存

Mihomo 客户端
  └─ GET {WORKER_URL}/subscribes?token=<api_token>      私人节点订阅
  └─ GET {WORKER_URL}/subscribes?token=<wrapper_token>  付费订阅包装地址
  └─ GET {WORKER_URL}/profiles?token=<profile_token>    完整配置
        └─ Worker → D1（模板/节点/付费订阅）→ KV 缓存 → YAML
```

要点：

- Worker 在 [index.js](backend/src/index.js) 中按路径前缀分发；所有 `/api/*` 需要 JWT，`OPTIONS` 预检在入口统一处理。
- `/subscribes` 与 `/profiles` 是**公开接口，不带 `/api` 前缀**，用查询参数 `token` 鉴权。
- 私人节点订阅缓存键为 `sub:v2:<sha256(api_token)>`，TTL 600 秒；完整配置缓存键为 `profile:<sha256(profile_token)>`，TTL 300 秒。缓存键与删除逻辑集中在 [cache.js](backend/src/services/cache.js)。
- 私人节点订阅（`api_token`）只包含**普通节点**（`dialer_proxy` 为空）；链式代理不会进入 `proxy-providers`，而是写进完整配置的顶层 `proxies`，避免 Mihomo 在 provider 内部无法解析 `dialer-proxy`。
- 付费订阅采用**包装地址**：源地址只存 D1，列表/创建/更新响应与生成的 YAML 只暴露 `${WORKER_URL}/subscribes?token=<wrapper_token>`；仅 `GET /api/paid-subs/:id` 为编辑表单额外返回源地址 `url`。访问包装地址时 Worker 以 mihomo UA 拉取源地址并回传。包装结果缓存在 KV，键为 `paidsub:v2:<sha256(wrapper_token)>`，默认 3600 秒（`SUB_CACHE_TTL`）；失败结果不缓存。
- 包装地址拉取**上游侧失败**时返回 `302` 重定向到源订阅地址（`Location` 为完整源 URL，`Cache-Control: no-store`，重定向结果不缓存）。**触发重定向**：上游超时、上游返回 4xx/5xx、上游内容为空、上游返回 HTML/非订阅内容。**不触发重定向**：包装 token 不存在或无效（401）、订阅已删除（401）、源地址本身不合法（SSRF 校验失败，创建/更新时 400）。重定向会把源地址完整暴露给客户端，这是“宁可让客户端直连源站也不在本服务失败”的知情取舍。
- `/subscribes` 同时承载两类 token：先按 `users.api_token` 匹配私人节点订阅，未命中再按 `paid_sub_wrappers.token` 匹配付费订阅包装地址；302 只作用于后者。
- 配置档案（profile）绑定一个模板，并选择是否包含全部普通节点、以及包含哪些付费订阅；生成配置时付费订阅只使用包装地址。
- 自定义规则是**用户级共享**的：每个用户一份规则库（`user_custom_rules`），模板只保存 `include_custom_rules` 开关。勾选时规则插在 `rules:` 的最前面（所有内置规则之前、`MATCH,漏网之鱼` 之前），并按完整字符串去重；与内置规则重复时保留自定义那条；未勾选的模板完全不注入。PUT 会失效该用户全部档案缓存。
- 前端展示的订阅地址由 `API_BASE_URL` 拼接，后端生成配置里的“自建节点”地址由 `WORKER_URL` 拼接。两者必须指向同一个 Worker（见“常见坑”）。

## 功能说明

### 代理节点

- 左侧菜单「代理节点」只展示**自定义节点**（`dialer_proxy` 为空）。链式节点由「链式代理」页统一管理。
- 表单支持的协议：`ss`、`trojan`、`hysteria2`、`vmess`、`vless`、`tuic`，支持 UI 表单和粘贴 Clash YAML（单个或多个节点）两种方式。
- 后端 `VALID_TYPES` 额外包含 `http`、`socks5`，仅供链式代理导入使用；表单不提供这两项。
- 节点没有启用/禁用状态，创建后始终参与生成；档案的“包含私人节点”控制的是该用户的**全部普通节点**，不是逐节点勾选。
- 页面顶部展示私人订阅地址（`${API_BASE_URL}/subscribes?token=<api_token>`）与 Token，可复制或重置；重置后旧订阅地址立即失效。

### 链式代理

- 左侧菜单「链式代理」，数据与自定义节点存在同一张 `proxies` 表，通过 `dialer_proxy` 列标记前置节点名称；`dialer_proxy` 为空即普通节点。
- 每个链式代理表示“本机 → 前置私人节点 → HTTP/SOCKS5 代理”。前置节点必须是普通私人节点，链式代理本身不能再作为前置。
- 批量导入支持以下行格式（每行一个代理，空行与 `#` 开头的行忽略）：
  - `host:port`
  - `user:pass@host:port`
  - `host:port:user:pass`
  - `http://host:port`、`https://host:port`（`https` 记为 `http` + `tls: true`）
  - `socks5://user:pass@host:port`、`socks5h://user:pass@host:port`
  - 带协议前缀时以协议前缀为准；不带前缀时按页面选择的默认类型（HTTP/SOCKS5）解析。
- 限制（[chained-proxy-parser.js](backend/src/services/chained-proxy-parser.js)）：单次最多导入 **200 条**有效代理；输入最多 2000 行、256 KB。重复行会被识别并跳过（按协议 + 主机 + 端口 + 用户名 + 密码去重）。
- 导入前可先“解析预览”，返回有效行、无效行（含行号与原因）、重复行与总数；预览与导入都复用同一解析逻辑。
- 导入后写入 `proxies` 表（带 `dialer_proxy`），自动命名（`<前缀>-HTTP-序号` / `<前缀>-SOCKS5-序号`，前缀最多 16 字符，重名自动加 `-2`、`-3` 后缀），并按 `sort_order` 追加。
- 删除：单条删除或页面批量删除（批量删除由前端逐条调用 `DELETE /api/chained-proxies/:id` 并统计成功/失败数量）。删除前置节点时，`DELETE /api/proxies/:id` 会级联删除引用它的链式节点。
- 节点预览复用自定义节点页的 `ProxyPreviewModal`，会额外显示 `dialer-proxy`。
- 生成的完整配置中：链式节点写入顶层 `proxies`；每个前置节点生成一个 `链式前置-N` 分组（`filter` 精确匹配前置节点名）；所有链式节点汇总到 `链式代理` 分组，并追加到分流组列表末尾。

### 付费订阅

- 左侧菜单「付费订阅」，只保存源地址（`paid_subscriptions.url`）与包装 token；页面展示的是包装地址。
- 源地址创建/更新时必须通过 SSRF 校验：仅 `http`/`https`，拒绝 localhost、私网地址与云元数据地址；拉取时使用 `redirect: 'manual'` 逐跳校验。
- 已移除启用/禁用开关：包装 token 有效即拉取，没有 `enabled` 字段或过滤条件。
- 上游失败时按上面的 302 规则处理；`Cache-Control: no-store` 避免中间层缓存重定向。
- 源地址会通过 302 暴露给客户端，属于已确认的设计取舍。

### 配置模板

- 字段：`name`、`dns_mode`（`fake-ip` / `real-ip`）、`ad_blocking`（0/1）、`regions`（数组，10 个聚合地区）、`include_custom_rules`（0/1）。
- `regions` 为空表示包含全部 10 个地区：香港、台湾、韩国、日本、新加坡、美国、亚洲其他、美洲其他、欧洲、其他。
- 系统模板 `user_id = 0`、`is_system = 1`，API 层只读（`PUT` / `DELETE` 返回 403）。
- 模板编辑页在「自定义规则」区域只提供“加入自定义规则”开关，规则本身在「自定义规则」页维护。
- 预览接口 `GET /api/templates/:id/preview-rules` 返回 `yaml`，其中 `rule-providers` 与 `rules` 来自真实生成逻辑；模板页预览中的 `proxies`、`proxy-groups` 等段落是**前端拼的示意结构**，不来自该接口，依赖节点与档案上下文的真实内容只会在完整档案配置中出现。

### 自定义规则

- 每个用户一份 JSON 数组（`user_custom_rules.rules`），GET/PUT `/api/custom-rules` 读写，PUT 为全量覆盖。
- 规则会做格式归一化：去空白、去空行、去重（保持首次出现顺序）；每条必须包含逗号、不得超过 512 字符、不能包含 `\r` / `\n`，且禁用 `MATCH,` 开头的规则（漏网之鱼由生成器统一追加）；最多 500 条。
- 勾选模板的 `include_custom_rules` 后，自定义规则插在 `rules:` 最前面（所有内置规则之前、`MATCH` 之前）；与内置规则重复时保留自定义那条；未勾选完全不注入。
- PUT 后删除该用户全部 `profile:<hash>` 缓存，所有档案下次请求即生效。

### 配置档案

- 字段：`name`、`template_id`、`include_private_sub`（boolean，API 对外转换）、`paid_sub_ids`（数组）。
- `include_private_sub = true` 表示包含该用户**全部普通节点**（按 `sort_order, id`，不含链式节点），不是逐节点选择；链式节点独立于该开关，始终参与完整配置。
- `profiles.enabled` 仍存在于表和 API：`createProfile` 固定写入默认值 1，`updateProfile` 接受 `enabled`；公开接口在 `enabled = 0` 时返回 403。前端当前**没有**启用/禁用开关。
- 公开地址为 `${API_BASE_URL}/profiles?token=<profile_token>`，页面可复制、预览 YAML、重置 Token。

## 本地开发

前置条件：Node.js 18+（Vite 6 / Wrangler 4 的最低要求）、一个 Cloudflare 账号（仅在部署或使用远程资源时需要）。

### 后端 `.dev.vars`

`wrangler dev` 与本地脚本都需要 `backend/.dev.vars` 提供至少 32 字符的 `JWT_SECRET`。文件已在 `.gitignore` 中，不要提交：

```bash
openssl rand -hex 32 | sed 's/^/JWT_SECRET=/' > backend/.dev.vars
chmod 600 backend/.dev.vars
```

`src/auth.js` 没有开发回退值，缺失或过短会直接抛错。

### 手动启动

```bash
cd backend
npm install
npm run db:migrate   # 在本地 D1 执行 schema.sql
npm run db:seed      # 写入 4 个系统模板
npm run dev          # wrangler dev，默认 http://localhost:8787
```

`db:migrate` / `db:seed` 默认带 `--local`，数据写入本机 `backend/.wrangler/state`（已被 `.gitignore` 忽略），与线上 D1 相互独立。

### 一键本地开发脚本

[dev-local.sh](scripts/dev-local.sh) 只使用本地资源，不执行任何 `--remote` 或 `deploy`：

```bash
./scripts/dev-local.sh                  # 检查环境 → 安装依赖 → 本地 migrate/seed → 建初始用户 → 前端构建 → 启动前后端
./scripts/dev-local.sh --no-build       # 跳过前端构建（dev 模式不依赖 dist）
./scripts/dev-local.sh --backend-port 8788 --frontend-port 3001
./scripts/dev-local.sh --force-install  # 强制重新 npm install
./scripts/dev-local.sh --reset-password # 重置初始用户密码，不修改 api_token
```

- 依赖：`bash`、`node`、`npm`、`curl`、项目内 `wrangler` / `vite`、已存在的 `backend/.dev.vars`。
- 脚本会在 `.local-dev/` 生成临时 wrangler 配置、本地 D1/KV 状态与日志（已 gitignore），端口被占用时直接报错。
- 固定本地账号：`dev@local.test` / `dev-password-123`；`--reset-password` 只改密码。
- `Ctrl+C` / `SIGTERM` 会同时清理前后端进程。

### 冒烟测试脚本

[local-smoke.sh](scripts/local-smoke.sh) 在本地启动 `wrangler dev --local`，自建测试数据并断言接口行为：

```bash
./scripts/local-smoke.sh               # 复用 backend/.wrangler/smoke-state
./scripts/local-smoke.sh --fresh       # 删除冒烟专用状态后重新建库
./scripts/local-smoke.sh --port 8790   # 指定后端端口
./scripts/local-smoke.sh --keep        # 保留进程与临时目录，便于手工调试
```

- 依赖：`bash`、`curl`、`node`、`backend/.dev.vars`（至少 32 字符的 `JWT_SECRET`）、`backend/node_modules/.bin/wrangler`。
- 固定测试账号：`smoke@test.local` / `smoke-password-123`；密码哈希与 `api_token` 直接复用 `src/db.js` 的实现生成。
- 覆盖范围：健康检查、登录与 401、受保护接口、节点 CRUD、链式导入（有效/无效/重复/前置节点）、档案 YAML（链式节点与 `dialer-proxy`、自定义规则位置、块状数组）、私人订阅、付费源 SSRF 拒绝、付费缓存命中、上游失败 302、自定义规则 PUT 后档案缓存失效。
- 不执行任何 `--remote` 或 `deploy` 命令。

### 创建初始用户

项目**没有注册接口**，只有登录接口。密码哈希规则是 `SHA-256(密码 + "mihomo-salt-2026")` 的小写十六进制；`api_token` 是 36 字节随机数的 base64url（48 字符）。

**推荐**：直接运行 `./scripts/deploy.sh` 交互式部署，后端完成后会询问是否创建初始用户。密码输入不回显，要求输入两遍并校验一致；邮箱已存在时提示并跳过，不会覆盖现有密码。密码不会出现在命令行参数、`ps` 或日志中。

也可以手动生成凭据并写入 D1：

```bash
node -e "const c=require('node:crypto');const p=process.argv[1];console.log('password_hash:',c.createHash('sha256').update(p+'mihomo-salt-2026').digest('hex'));console.log('api_token:',c.randomBytes(36).toString('base64url'))" '你的密码'
```

```bash
cd backend
npx wrangler d1 execute mihomo-sub-manager-db --local --command="INSERT INTO users (email, password_hash, api_token) VALUES ('you@example.com', '<password_hash>', '<api_token>');"
```

线上库把 `--local` 换成 `--remote`；或直接使用 `./scripts/dev-local.sh` 自动创建本地账号。

### 启动前端

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

`.env.development` 已把 `VITE_API_BASE_URL` 指向 `http://localhost:8787`。前端开发服务器端口固定为 3000（见 [vite.config.js](frontend/vite.config.js)），并配置了 `/api`、`/subscribes`、`/profiles` 代理，但 axios 使用绝对地址 `API_BASE_URL`，实际请求直接打到 Worker；Worker 已对所有来源开放 CORS。

## D1 初始化

建表内容见 [schema.sql](backend/schema.sql)，共 9 张表：

| 表 | 用途 |
| --- | --- |
| `users` | 邮箱、密码哈希、`api_token` |
| `proxies` | 节点表；`config` 为 JSON 字符串；`dialer_proxy` 标记链式代理的前置节点名 |
| `paid_subscriptions` | 付费机场订阅源地址（仅后端可见） |
| `paid_sub_wrappers` | 付费订阅包装 token；对外地址由该 token 派生 |
| `templates` | 配置模板；`user_id = 0` 且 `is_system = 1` 为系统模板；`include_custom_rules` 控制是否注入共享规则 |
| `user_custom_rules` | 每用户一份共享自定义规则，`rules` 为 JSON 数组并保持顺序 |
| `profiles` | 配置档案，含唯一 `profile_token`、`enabled`、`include_private_sub` |
| `profile_paid_subs` | 档案-付费订阅关联表 |

`seed.sql` 通过 `INSERT OR IGNORE` 写入 4 个系统模板（Fake-IP / Real-IP × 去广告 / 不去广告）。

> 本项目是首版，**全新部署即可，无需任何数据迁移**。直接对空库执行 `schema.sql` + `seed.sql`；仓库不含旧库升级、`ALTER TABLE` 或数据合并脚本。

常用命令（均需在 `backend/` 执行）：

```bash
npm run db:migrate          # 本地建表
npm run db:seed             # 本地写入系统模板
npm run db:remote:migrate   # 线上建表
npm run db:remote:seed      # 线上写入系统模板
```

仓库没有引入迁移框架，schema 变更需要直接修改 `schema.sql` 并重新执行；已有表使用 `CREATE TABLE IF NOT EXISTS`，不会自动改列。

## 环境变量与密钥

### 后端

`wrangler.toml` 中已有的绑定与变量：

| 名称 | 类型 | 当前值/说明 |
| --- | --- | --- |
| `DB` | D1 binding | `database_name = "mihomo-sub-manager-db"` |
| `CACHE` | KV binding | 订阅缓存 |
| `WORKER_URL` | `[vars]` | 生成配置时的订阅基地址；由部署脚本按 `--api-domain` 回填为 `https://<后端域名>`，未指定时回退到首次部署输出的 workers.dev 地址 |
| `ACCESS_TOKEN_TTL` | `[vars]` | `900`（秒） |
| `REFRESH_TOKEN_TTL` | `[vars]` | `2592000`（秒，30 天） |
| `SUB_CACHE_TTL` | `[vars]` | 付费订阅包装地址的 KV 缓存时长，默认 `3600`（秒，60 分钟）。支持 `3600`/`3600s`/`60m`/`1h`，解析后限制在 60 秒–24 小时 |
| `JWT_SECRET` | **Secret** | 未写在仓库中，必须通过 Wrangler 或 `scripts/deploy.sh` 设置，至少 32 字符 |

`src/auth.js` 强制要求 `JWT_SECRET`：缺失或少于 32 字符时直接抛错，没有开发回退值。

### 密钥从哪里来、怎么不泄露

`JWT_SECRET` 只应存在于两个地方：

1. 本地 `backend/.dev.vars`（已加入 `.gitignore`，权限 600），供 `wrangler dev` 使用。
2. Cloudflare Worker 的加密 secret，通过 `wrangler secret put` 写入，运行时以 `env.JWT_SECRET` 读取。

**禁止**把 `JWT_SECRET` 写进 `backend/wrangler.toml` 的 `[vars]`：`[vars]` 是明文配置。`wrangler secret list` 只能看到 secret 名称，看不到值。

`scripts/deploy.sh` 的取值顺序：

1. 显式 `JWT_SECRET` 环境变量；
2. `backend/.dev.vars` 中已有的 `JWT_SECRET`；
3. 前两者都不存在时，用 `openssl rand -hex 32` 生成随机值，写入 `backend/.dev.vars`（权限 600），再通过 `wrangler secret put` 写入 Worker。

生成过程不回显明文。之后每次部署都会复用环境变量或 `.dev.vars` 中的值，**不会自动重新生成**，否则所有已签发的 token 都会失效。只有显式 `--rotate-jwt-secret` 才允许轮换：

```bash
./scripts/deploy.sh --env prod --rotate-jwt-secret
```

轮换会生成新密钥、覆盖 `backend/.dev.vars` 并写入 Worker，执行后旧 token 立即失效；不能与 `JWT_SECRET` 环境变量同时使用（脚本会拒绝执行）。

手动设置：

```bash
cd backend
npx wrangler secret put JWT_SECRET
```

> `database_id` 与 KV `id` 属于当前 Cloudflare 账号下的具体资源，不是密钥但与环境强绑定。使用 `scripts/deploy.sh` 时会自动创建、解析并回填，**不需要手工改 id**。

### 前端

| 文件 | 用途 |
| --- | --- |
| `frontend/.env.development` | `vite dev` 使用，`VITE_API_BASE_URL=http://localhost:8787` |
| `frontend/.env.production` | `vite build` 使用，仓库内是占位值 `VITE_API_BASE_URL=https://api.example.com`；部署脚本会用 `--api-domain` 注入真实地址 |

`VITE_` 开头的变量会被打包进浏览器产物，**不要**在这里放任何密钥。修改后需要重新启动开发服务器或重新构建。

## 部署

### 一键部署（推荐）

`scripts/deploy.sh` 幂等执行全流程，D1/KV 的 id 自动创建、解析并回填。

在终端直接运行时是**交互式部署**：先检查 Cloudflare 登录状态（未登录会自动执行 `wrangler login` 打开浏览器授权），再依次询问部署环境、Worker 名称、Pages 项目名称、后端自定义域名、前端自定义域名、是否执行 seed、付费订阅缓存 TTL；已经通过命令行参数指定的项不会重复提问。后端部署完成后会询问是否创建初始用户（邮箱 + 两遍密码，密码不回显）。CI 或无 TTY 环境不会提问，直接在命令里加 `--non-interactive` 使用默认值，且**不会创建初始用户**。

```bash
# 交互式：直接运行，按提示输入
./scripts/deploy.sh

# 生产环境：首次部署与日常发布都可用
./scripts/deploy.sh --env prod

# 指定后端自定义域名（自动写入 routes，并由 wrangler deploy 绑定）
./scripts/deploy.sh --env prod --api-domain api.example.com

# 同时指定前端 Pages 自定义域名（脚本只打印人工绑定提示，不自动绑定）
./scripts/deploy.sh --env prod --api-domain api.example.com --web-domain app.example.com

# 跳过 seed.sql
./scripts/deploy.sh --env prod --no-seed

# 只重建/发布前端（需要能确定 API 域名）
./scripts/deploy.sh --frontend-only --api-domain api.example.com

# 独立 staging：生成 backend/wrangler.staging.toml，资源名按环境隔离（KV 为 mihomo-sub-manager-staging-cache）
./scripts/deploy.sh --env staging

# 主动轮换 JWT_SECRET（旧 token 立即失效）
./scripts/deploy.sh --env prod --rotate-jwt-secret

# 调整付费订阅包装缓存（默认 60 分钟）
./scripts/deploy.sh --env prod --sub-cache-ttl 30m

# CI / 无人值守：使用默认值、跳过全部提问，且不创建初始用户
./scripts/deploy.sh --non-interactive --env prod --api-domain api.example.com

# 自定义 Worker 和 Pages 名称（D1 / KV 名称仍由 ENV_NAME 决定）
./scripts/deploy.sh --worker-name my-worker --pages-project my-webui --api-domain api.example.com
```

参数：

| 参数 | 说明 |
| --- | --- |
| `--worker-name <名称>` | 自定义 Worker 名称；默认 prod 为 `mihomo-sub-manager`、其他环境为 `mihomo-sub-manager-<env>`。只能含小写字母、数字、连字符 |
| `--pages-project <名称>` | 自定义 Pages 项目名称；默认 prod 为 `mihomo-sub-manager-webui`、其他环境为 `mihomo-sub-manager-webui-<env>`。只能含小写字母、数字、连字符；不能与 Worker 名称相同 |
| `--env <名称>` | 默认 `prod`；其他值会生成 `backend/wrangler.<env>.toml`，Worker/Pages/D1 追加 `-<env>`，KV 为 `mihomo-sub-manager-<env>-cache` |
| `--api-domain <域名>` | 后端自定义域名，只写主机名（如 `api.example.com`）。写入 `routes` + `custom_domain`、回填 `WORKER_URL`，并作为前端 `VITE_API_BASE_URL` |
| `--web-domain <域名>` | 前端 Pages 自定义域名，只写主机名（如 `app.example.com`）。不自动绑定，仅在结束时提示手动操作；不能与 `--api-domain` 相同 |
| `--seed` / `--no-seed` | 是否执行 `seed.sql`；默认执行，`--no-seed` 跳过 |
| `--backend-only` / `--frontend-only` | 只处理其中一端 |
| `--d1-location <区域>` | 新建 D1 时传给 `wrangler d1 create`，如 `apac`、`weur`、`eeur` |
| `--pages-branch <分支>` | Pages 生产分支，默认 `main` |
| `--rotate-jwt-secret` | 强制生成新的 `JWT_SECRET`，覆盖 `backend/.dev.vars` 并写入 Worker；不能与 `JWT_SECRET` 环境变量同时使用 |
| `--sub-cache-ttl <时长>` | 写入 `[vars] SUB_CACHE_TTL`；支持 `3600`、`3600s`、`60m`、`1h`，实际取值由后端限制在 60–86400 秒 |
| `--non-interactive` | 跳过所有交互提问，使用默认值，且不创建初始用户；适用于 CI、无 TTY 或无人值守场景 |

脚本流程：

1. 登录检查：有 `CLOUDFLARE_API_TOKEN` 时跳过；否则执行 `wrangler whoami`，未登录且处于交互模式时自动执行 `wrangler login` 打开浏览器授权。非交互且未登录时直接报错退出，并提示先手动 `cd backend && npx wrangler login` 或设置 `CLOUDFLARE_API_TOKEN`。
2. 交互模式（stdin 是终端且未传 `--non-interactive`）下依次询问：环境、Worker 名称（留空用默认）、Pages 项目名称（留空用默认）、后端域名、前端域名、是否 seed、缓存 TTL；已有对应参数的问题直接跳过。名称校验为 `^[a-z0-9][a-z0-9-]*$`，Worker 与 Pages 名称不能相同。
3. 根据 ENV_NAME 和可选的 `--worker-name` / `--pages-project` 计算出 Worker 名称（默认 prod 为 `mihomo-sub-manager`、其他环境为 `mihomo-sub-manager-<env>`）和 Pages 项目名（默认 prod 为 `mihomo-sub-manager-webui`、其他环境为 `mihomo-sub-manager-webui-<env>`）。D1 与 KV 名称仍只由 ENV_NAME 决定，不受自定义 Worker / Pages 名称影响。
4. 读取或生成 `wrangler.<env>.toml`（prod 环境为 `wrangler.toml`），把 `name` 对齐为目标 Worker 名称；空环境下不写入 `database_id` / `id`，等 D1/KV 创建后再回填。
5. D1：配置中的 `database_id` 属于当前账号且名称等于目标名称时跳过；否则按名称复用或 `wrangler d1 create` 创建，再从 `d1 list --json` 解析并回填。D1 不支持原地改名，名称不一致时会使用目标名称的新库。
6. KV：同 D1，自动创建/复用目标名称的 namespace 并回填 `id`。
7. 对线上 D1 执行 `schema.sql`；默认执行 `seed.sql`（`--no-seed` 可跳过）。
8. 读取密钥：`JWT_SECRET` 环境变量 → `backend/.dev.vars` → 都没有时用 `openssl rand -hex 32` 生成并写入 `.dev.vars`（权限 600）。部署 Worker 后用 `wrangler secret put` 写入，全程不回显明文。
9. 若传了 `--api-domain`，写入 `routes = [{ pattern = "<域名>", custom_domain = true }]`，并把 `WORKER_URL` 设为 `https://<域名>`。
10. 部署 Worker（名称由 `--worker-name` 或默认规则决定）；自定义域名由 `wrangler deploy` 自动绑定。
11. 确定 API 地址：`--api-domain` 优先；否则沿用配置中的 `WORKER_URL`；若资源是新建的，则使用首次部署输出的 `*.workers.dev` 地址，回填后自动二次部署。
12. 后端完成后（交互模式）询问是否创建初始用户：输入邮箱与两遍密码（`read -s` 不回显，两次必须一致）。邮箱已存在时提示并跳过，不覆盖现有密码；密码哈希与 `api_token` 复用 `backend/src/db.js` 的 `hashPassword` / `generateToken`，SQL 写入权限 600 的临时文件后执行，成功或失败都会立即删除。
13. Pages：项目名由 `--pages-project` 或默认规则决定，不存在则创建；注入 `VITE_API_BASE_URL` 构建；写入 `dist/_redirects`（`/* /index.html 200`）后发布；结束时打印前端自定义域名的人工绑定提示。

### GitHub Actions 部署示例

仓库本身没有提交 workflow 文件，下面是可复制到 `.github/workflows/deploy.yml` 的示例。密钥只放在仓库 **Settings → Secrets and variables → Actions** 中，通过 `env` 注入脚本，不写入工作流文件、不落盘、不进日志。

```yaml
name: deploy

on:
  workflow_dispatch:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      JWT_SECRET: ${{ secrets.JWT_SECRET }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: ./scripts/deploy.sh --non-interactive --env prod --api-domain api.example.com
```

- `--non-interactive` 让脚本在 CI 中不等待任何输入，使用默认值，且不创建初始用户。
- `JWT_SECRET` 以环境变量传入后，脚本会优先使用它，不会读取或生成 `.dev.vars`。
- `CLOUDFLARE_API_TOKEN` 需要有 Workers、D1、KV、Pages 的编辑权限；`CLOUDFLARE_ACCOUNT_ID` 可在 Cloudflare 控制台查看。

### 自定义域名

#### 后端：由 `--api-domain` 自动绑定

`--api-domain api.example.com` 会在 `backend/wrangler.toml` 中生成：

```toml
routes = [
  { pattern = "api.example.com", custom_domain = true }
]
```

前置条件（不满足时 `wrangler deploy` 会失败）：

- 该域名与 Worker 属于**同一个 Cloudflare 账号**。
- 该域名的 DNS 由 **Cloudflare 托管**（在该账号下已有 zone）。
- 域名不能仍绑定在旧 Worker 上。

绑定成功后，脚本会把 `WORKER_URL` 写成 `https://api.example.com`，前端构建也使用该地址，保证前端展示地址与后端生成的订阅地址同源。

不传 `--api-domain` 时，脚本保留配置中已有的 `routes`；若配置也没有 `WORKER_URL`，则回退到首次部署输出的 `*.workers.dev` 地址。

#### 前端 Pages：需要手动在控制台绑定

`wrangler` CLI 没有 Pages 自定义域名命令，因此脚本**不会自动绑定**前端域名。传 `--web-domain app.example.com` 只是让结束提示带上具体域名。

部署结束后请手工完成：

1. 打开 Cloudflare 控制台 → **Workers & Pages** → `mihomo-sub-manager-webui` → **Custom domains**，添加前端域名。
2. 按控制台提示完成 DNS：若域名在同一账号下通常会自动创建记录；否则把前端域名 CNAME 到 `mihomo-sub-manager-webui.pages.dev`。
3. 确认前端访问的 API 地址是已绑定的后端自定义域名（`https://api.example.com`），而不是 `*.workers.dev`。若地址不一致，重新执行 `./scripts/deploy.sh --frontend-only --api-domain api.example.com`。

### 手动部署（脚本不可用时）

后端：

```bash
cd backend
npx wrangler login            # 或使用 CLOUDFLARE_API_TOKEN
npx wrangler d1 create mihomo-sub-manager-db               # 仅首次，记录 database_id
npx wrangler kv namespace create mihomo-sub-manager-cache  # 仅首次，记录 id
# 将上面两个 id 填回 wrangler.toml
npm run db:remote:migrate
npm run db:remote:seed
npx wrangler secret put JWT_SECRET
npm run deploy                # 发布 name = "mihomo-sub-manager"
```

手动绑定后端自定义域名时，在 `wrangler.toml` 顶层加入：

```toml
routes = [
  { pattern = "api.example.com", custom_domain = true }
]
```

并把 `[vars]` 的 `WORKER_URL` 改为 `https://api.example.com` 后重新部署。

前端：

```bash
cd frontend
VITE_API_BASE_URL=https://api.example.com npm run build
npx wrangler pages deploy dist --project-name mihomo-sub-manager-webui \
  --branch main --commit-dirty=true
```

- 前端使用 `createWebHistory`，Pages 需要 SPA 回退规则；脚本会自动写 `dist/_redirects`，手动部署时请自行创建内容 `/* /index.html 200`。
- Pages 自定义域名在控制台 **Custom domains** 绑定，CLI 不支持。

发布后可用 `curl https://api.example.com/health` 检查，正常返回：

```json
{"service":"mihomo-sub-manager","status":"ok","version":"1.0.0"}
```

## API 一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | 无 | 邮箱 + 密码换取 access/refresh token |
| POST | `/api/auth/refresh` | refresh token | 刷新 token |
| GET | `/api/auth/me` | JWT | 当前用户信息（含 `api_token`） |
| POST | `/api/auth/regenerate-token` | JWT | 重置 `api_token` 并清除旧订阅缓存 |
| GET / POST | `/api/proxies` | JWT | 列表 / 新建自定义节点 |
| GET / PUT / DELETE | `/api/proxies/:id` | JWT | 详情 / 更新 / 删除（删除前置节点会级联删除链式节点） |
| GET | `/api/chained-proxies` | JWT | 链式代理列表（`dialer_proxy` 非空的节点） |
| POST | `/api/chained-proxies/preview` | JWT | 解析预览（不入库） |
| POST | `/api/chained-proxies/import` | JWT | 批量导入，落成普通节点记录 |
| DELETE | `/api/chained-proxies/:id` | JWT | 删除单条链式代理 |
| GET / POST | `/api/paid-subs` | JWT | 列表 / 新建付费订阅 |
| GET / PUT / DELETE | `/api/paid-subs/:id` | JWT | 详情 / 更新 / 删除 |
| GET / POST | `/api/templates` | JWT | 列表（含系统模板）/ 新建 |
| GET / PUT / DELETE | `/api/templates/:id` | JWT | 详情 / 更新 / 删除（系统模板只读） |
| GET | `/api/templates/:id/preview-rules` | JWT | 预览真实 `rule-providers` + `rules` |
| GET / PUT | `/api/custom-rules` | JWT | 读取 / 全量保存当前用户的共享自定义规则 |
| GET / POST | `/api/profiles` | JWT | 列表 / 新建配置档案 |
| GET / PUT / DELETE | `/api/profiles/:id` | JWT | 详情 / 更新 / 删除 |
| GET | `/api/profiles/:id/config` | JWT | 预览完整 YAML |
| POST | `/api/profiles/:id/regenerate-token` | JWT | 重置档案 Token |
| GET | `/subscribes?token=<api_token>` | 查询参数 | 私人节点订阅（YAML，仅普通节点） |
| GET | `/subscribes?token=<wrapper_token>` | 查询参数 | 付费订阅包装地址，由 Worker 代理拉取源订阅 |
| GET | `/profiles?token=<profile_token>` | 查询参数 | 完整 Mihomo 配置（YAML） |
| GET | `/`、`/health` | 无 | 健康检查 |

所有路径都支持 `OPTIONS` 预检（入口统一返回），响应统一带 `Access-Control-Allow-Origin: *`。节点类型：自定义节点表单支持 `ss`、`trojan`、`hysteria2`、`vmess`、`vless`、`tuic`；后端 `VALID_TYPES` 另含 `http`、`socks5`，用于链式导入。

## 常见坑

1. **线上没设 `JWT_SECRET`**：会直接抛错（接口返回 500）。`scripts/deploy.sh` 会强制要求至少 32 字符的密钥；手动部署时务必 `wrangler secret put JWT_SECRET`。
2. **本地库和线上库混用**：`db:migrate`、`db:seed` 默认操作本地 D1；线上必须用 `db:remote:*` 脚本，或直接使用 `scripts/deploy.sh`。
3. **没有注册入口**：必须先插入 `users` 记录，或使用 `./scripts/dev-local.sh` 自动创建本地账号。
4. **`WORKER_URL` 与前端 API 地址不一致**：后端生成的私人订阅地址是 `${WORKER_URL}/subscribes?token=...`，前端展示的档案地址是 `${VITE_API_BASE_URL}/profiles?token=...`。换域名时两处都要改；使用脚本时传 `--api-domain` 即可同时处理两处。
5. **公开接口不要加 `/api`**：`/subscribes`、`/profiles` 是顶层路径；加 `/api` 会落到 404。
6. **缓存导致改动不生效**：私人节点订阅缓存 600 秒、配置缓存 300 秒、付费订阅包装缓存默认 3600 秒（`SUB_CACHE_TTL`）。通过 API 修改数据会主动删除相关缓存键，但直接改 D1（手动 SQL、`seed`）不会；此时需要等待 TTL 或手动删除 `sub:v2:<sha256>` / `profile:<sha256>` / `paidsub:v2:<sha256>` 键。
7. **系统模板改不动**：`templates.user_id = 0` 的记录只读，需要新增用户模板。
8. **自定义规则不属于模板**：规则在「自定义规则」页按用户维护；模板只保存 `include_custom_rules` 开关。修改规则后，所有勾选了该开关的档案输出都会变化。
9. **链式节点不在「代理节点」页**：本页只显示 `dialer_proxy` 为空的普通节点；链式节点在「链式代理」页管理。私人订阅（`api_token`）也不包含链式节点。
10. **档案的“包含私人订阅”控制的是该用户的全部节点**，不是单节点勾选。
11. **D1 数据库名是 `mihomo-sub-manager-db`**：Cloudflare D1 不支持用 wrangler 原地改名；脚本发现配置里的库名不一致时会创建/复用目标名称的新库。本项目为全新部署，不需要旧库迁移。
12. **后端域名必须由 Cloudflare 托管 DNS**：`--api-domain` 依赖 `routes` + `custom_domain`，域名与 Worker 必须同账号且 DNS 在 Cloudflare；否则 `wrangler deploy` 直接失败。
13. **Pages 自定义域名没有 CLI**：`wrangler pages` 没有域名子命令，脚本只打印人工待办，必须到控制台 **Custom domains** 绑定。
14. **Pages 深层路由 404**：`createWebHistory` 需要 SPA 回退规则；`scripts/deploy.sh` 会自动写入 `dist/_redirects`，手动部署时需自行创建。
15. **`jose` 依赖 `nodejs_compat`**：`wrangler.toml` 中的 `compatibility_flags = ["nodejs_compat"]` 不要删除。
16. **`nameserver-policy` 的域名是示例占位**：real-ip 模板使用 `example.com` / `example.net` 等保留域，实际部署时按需替换为自己的域名，不是内置业务域名。

## 仓库现状与待补充

- 未配置测试、lint、格式化脚本和 CI；改动后至少执行 `cd frontend && npm run build`，并运行 `./scripts/local-smoke.sh --fresh`。
- D1/KV 资源 ID 由 `scripts/deploy.sh` 自动创建并回填；全新部署无需手改。
- 后端自定义域名由 `--api-domain` 写入 `routes` 并随 `wrangler deploy` 自动绑定；域名与账号/DNS 的约束仍需用户自行满足。
- 前端 Pages 自定义域名与 DNS 必须由维护者在 Cloudflare 控制台处理，脚本不自动绑定。
- 前端 Pages 项目名为 `mihomo-sub-manager-webui`；`_redirects` 由部署脚本生成，未作为源文件提交。

## 开源协议

本项目采用 [MIT License](LICENSE)。允许自由使用、复制、修改、合并、发布、分发、再许可和/或出售软件副本，只需保留版权声明与许可声明；软件按“原样”提供，不附带任何明示或暗示的担保。完整条款见根目录 [LICENSE](LICENSE)。
