# app-api

`campus-web` 使用的 Cloudflare Worker 产品后端。

本应用拥有产品入口、认证与会话、聊天请求准入、产品投影和 execution-control 回调接口。它不
拥有代理编排、工具执行、浏览器界面或运维页面业务逻辑。

## 当前范围

- `GET /healthz`、`GET /readyz`；
- Better Auth 和当前用户投影；
- 联邦登录接口；
- 聊天提交与流式读取、运行事件与步骤读取、反馈写入；
- 个人记忆设置、显式记忆项和 Hindsight 命令 outbox；
- 食堂、班车等校园产品公开读取接口；
- 文档阅读器导入、导出和读取模型接口。

HTTP 字段以 `docs/contracts/app-api/` 为准；本文只作为应用入口。

## 数据所有权

app-api 拥有认证、聊天、请求观测、用户资料和个人记忆产品状态的 Worker 侧 schema。它不
拥有采集任务、在线供应商配置、运维审计或执行运行状态。

数据文档：

- `docs/data/app-api/README.md`
- `docs/data/app-api/runtime.md`
- `docs/data/postgres-ownership.md`

`APP_API_DB` 与 `APP_API_DB_FRESH` 是指向同一共享 PostgreSQL 的两条 Hyperdrive 通道，不是
两个逻辑数据库。只有数据所有者文档明确允许的路径才能使用写后立即读通道。

学生食堂接口只读取已发布的 `dining.*` 投影。食堂目录 fixture 属于
`packages/domains/dining`，导入与评价同步属于 `jobs/dining-sync`，不得进入 app-api 请求
主路径。

可重复的数据库入口位于应用自己的 `ops/`、`drizzle/0000_initial.sql` 和
`db/shared-product-schema/chat_current.sql`，不放入 package 生命周期脚本：

- `ops/db/bootstrap-shared-product-database.ts`
- `ops/db/ensure-app-auth-role-search-path.ts`

共享产品数据库包含 app-api 使用的 `app_auth.*`、`chat.*`、`profile.*`、`runtime.*`、
`dining.*`、`docs.*` 和 `campus_services.*`。历史 `identity.*`、`campus_services_ops.*`、
`observability.*` 与 `provider_config.*` 已由 migration 删除，不得恢复为 app-api 所有权。

## 相关文档

- 产品运行时：`docs/architecture/system/product-runtime.md`
- 当前架构：`docs/architecture/current.md`
- 身份与授权：`docs/architecture/system/identity-authz.md`
- 接口合同：`docs/contracts/app-api/README.md`
- 数据所有权：`docs/data/app-api/README.md`
- 运行排查：`docs/decisions/adr-0072-self-hosted-ops-web.md`
- 公开官网采集：`docs/domains/official-web.md`
- 食堂：`docs/architecture/domains/dining/architecture.md`、`docs/data/dining.md`

## 本地开发

```bash
pnpm install
pnpm --dir apps/app-api dev
pnpm --dir apps/app-api test
pnpm --dir apps/app-api test:node
pnpm --dir apps/app-api test:worker
pnpm --dir apps/app-api test:shared-db-integration
pnpm ci:app-api-migration
pnpm --dir apps/app-api typecheck
```

本地 Wrangler 与 Drizzle 进程变量放在 `apps/app-api/.env`，Worker 字符串变量放在
`apps/app-api/.dev.vars`。从所属密钥存储或 runbook 直接填写应用本地文件，不从根目录
`.env` 扩散数据库 URL。

## 部署

依赖新 schema 的 Worker 上线前，使用直接管理连接运行完整 schema 安装器：

```bash
APP_API_OPERATOR_DATABASE_URL="$DIRECT_DATABASE_URL" \
  pnpm --dir apps/app-api exec tsx ops/db/schema.ts
```

不得通过 Hyperdrive 或长期 Worker 进程运行 migration。安装后使用同一直接连接验证预期表与
列，再继续部署。

缺少认证、数据库或 execution-control 配置时，Worker 必须失败关闭。动态产品
响应默认使用 `Cache-Control: no-store`，除非具体合同另有规定。app-api 不把观测平台查询
结果当作产品事实。
