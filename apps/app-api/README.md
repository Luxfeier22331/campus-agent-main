# app-api

`campus-web` 使用的 Cloudflare Worker 产品后端。

本应用拥有产品 HTTP 接口、认证与会话、聊天请求准入、产品投影和 execution-control 回调
接口。它不拥有 Agent 编排、工具执行、浏览器界面、离线采集或运维页面业务逻辑。

## 当前范围

- `GET /healthz`、`GET /readyz`；
- Better Auth 和当前用户投影；
- 校园邮箱准入、逐地址邀请、邮箱验证和认证邮件；
- 封禁、会话撤销、临时密码、强制改密和异步账号注销；
- 联邦登录接口；
- 聊天提交与流式读取、运行事件与步骤读取、反馈写入；
- 个人记忆设置、显式记忆项和 Hindsight 命令 outbox；
- 食堂、班车等校园产品公开读取接口；
- 文档导航、摘要、版本、解析和访问准入接口。

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

学生食堂接口只读取已发布的 `dining.map_releases` 和 `dining.map_publication`，并从统一
derived bucket 读取按摘要命名的地图资源。staging 和 production 通过 `OBJECT_STORE_PRIVATE`
Workers VPC binding 访问集群内对象存储，不持有 S3 凭据或使用公开对象存储地址。App API 不读取
草稿，也不执行地图编辑或发布。

数据库 schema 与角色边界由 `docs/data/postgres-ownership.md` 维护，安装和迁移实现位于应用
`ops/db/` 与 schema Job；README 不复制表清单和部署步骤。

Better Auth 负责认证运行时，认证表定义由 `src/db/schema/auth.ts` 统一纳入应用 Drizzle schema。
`app_auth.*` 的建表、升级和 migration ledger 只由 `apps/app-api/drizzle/` 与 schema Job 管理，
运行时和部署脚本不调用 Better Auth `getMigrations()`。调整 Better Auth 核心字段或插件时，应先按
Better Auth 官方 Drizzle adapter schema 更新 `auth.ts`，再使用 Drizzle Kit 生成并审查迁移。
`test/fixtures/app-auth-pre-drizzle.sql` 是 Drizzle 接管前从已部署数据库导出的不可变 schema-only
测试基线，不是当前 schema，也不得手工维护。修改 `drizzle/` 后应在提交 PR 前运行
`pnpm ci:app-api-migration`，同时覆盖真实历史升级和空数据库安装。
认证邮件要求 `AUTH_EMAIL_FROM` 和 `RESEND_API_KEY`；`AUTH_EMAIL_REPLY_TO` 可选。

## 相关文档

- 产品运行时：`docs/architecture/system/product-runtime.md`
- 当前架构：`docs/architecture/current.md`
- 身份与授权：`docs/architecture/system/identity-authz.md`
- 接口合同：`docs/contracts/app-api/README.md`
- 数据所有权：`docs/data/app-api/README.md`
- 运行排查：`docs/architecture/system/ops-observability.md`、`docs/runbooks/execution.md`
- 食堂地图：`docs/product/dining.md`

## 本地开发

```bash
pnpm install
pnpm dev:init
pnpm --dir apps/app-api dev
pnpm --dir apps/app-api test
pnpm --dir apps/app-api test:node
pnpm --dir apps/app-api test:worker
pnpm --dir apps/app-api test:shared-db-integration
pnpm ci:app-api-migration
pnpm --dir apps/app-api typecheck
```

`pnpm dev:init` 在当前 worktree 的 App API 目录生成 `.env.local` 与 `.dev.vars.local`。不要手工修改或从根 `.env` 复制；外部凭据通过启动命令的进程环境或可选 secret manager 注入。只启动本应用时仍使用 profile 中的独立端口和 database。
本地 Dining 平面图读取地址由生成的 `OBJECT_STORE_LOCAL_BASE_URL` 提供；部署环境不读取该变量。

数据库安装入口见 `jobs/app-api-schema/README.md`，部署顺序见 `docs/runbooks/release.md`。
