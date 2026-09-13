# app-api

`campus-web` 使用的 Cloudflare Worker 产品后端。

## 职责

- 提供产品 HTTP、认证、会话和账号生命周期；
- 接收聊天请求并保存产品输入、事件和终态；
- 管理个人记忆产品状态与 execution-control 回调；
- 提供通知、食堂和其他已开放产品读取接口；
- 提供 Status Web 使用的匿名问答可用性信号。

本应用不拥有 Agent 编排、工具执行、浏览器界面、离线采集或运维页面。HTTP 字段以
`docs/contracts/app-api/` 为准，数据库结构以 `docs/data/app-api/` 和应用 schema 为准。

## 内部边界

- Chat 模块拥有会话、消息和产品事件写入；Profile Memory 模块拥有记忆来源失效、命令生成和状态
  协调，Chat 只能通过该模块暴露的窄入口触发记忆变更；
- Email Access 拥有邮箱规范化、校园域名分类和邮箱准入；Auth 拥有 Better Auth 运行时、会话及账号状态
  检查。Auth 和 Account Admin 可以消费 Email Access 的纯校园邮箱 leaf，但 Email Access 不得依赖
  `modules/auth` 实现；
- Runtime Command 对外 service 只编排请求接受、持久执行准入和产品终态，具体阶段规则由所属子模块
  维护；
- schema 和跨模块类型是 leaf dependency，不得反向导入 service、store facade 或运行时实现。

app-api 拥有认证、聊天、请求观测、用户资料和个人记忆产品状态的 Worker 侧 schema。它不
拥有采集任务、在线供应商配置、运维审计或执行运行状态。

数据文档：

- `docs/data/app-api/README.md`
- `docs/data/app-api/runtime.md`
- `docs/data/postgres-ownership.md`

`APP_API_DB` 是 app-api 唯一的 Hyperdrive 通道。部署配置关闭 Hyperdrive query cache，保留
连接池能力，所有产品读写都通过同一数据库绑定完成。

通知接口只读 `notices.*` 的业务表。站内详情返回已清洗 HTML、图片同源 URL，以及包含门户原生链接的
附件 metadata；外链通知只在列表中返回来源 URL。App API 不代理附件字节，通知图片与 Dining 一样
通过现有 derived bucket 读取路径交付，不向浏览器暴露对象存储身份。

学生食堂接口只读取已发布的 `dining.map_releases` 和 `dining.map_publication`，并从统一
derived bucket 读取按摘要命名的地图资源。staging 和 production 通过 `OBJECT_STORE_PRIVATE`
Workers VPC binding 访问集群内对象存储，不持有 S3 凭据或使用公开对象存储地址。App API 不读取
草稿，也不执行地图编辑或发布。

校园地图由 Campus Web 独占所有权和静态交付，入口为 Campus Web 的 `/campus-map/manifest.json`；
App API 不再提供地图路由、地点 read model 或地图静态资产，也不保留兼容 binding。

数据库 schema 与角色边界由 `docs/data/postgres-ownership.md` 维护；统一安装和迁移实现位于
`jobs/campus-agent-schema/`，README 不复制表清单和部署步骤。

Better Auth 负责认证运行时，认证表定义由 `src/db/schema/auth.ts` 统一纳入应用 Drizzle schema。
`app_auth.*` 的建表、升级和 migration ledger 由 `jobs/campus-agent-schema/` 统一管理；运行时和部署脚本
不调用 Better Auth `getMigrations()`，也不再维护 App API 专属 migration 目录。调整 Better Auth 核心字段
或插件时，先按官方 Drizzle adapter schema 更新 `auth.ts`，再在统一 migration Job 中提交审查后的 SQL。
已应用 SQL 不得修改；空库、旧 ledger、重复执行、未知状态和 hash 校验由 schema Job 的测试覆盖。
Better Auth 核心运行时要求 `DEPLOYMENT_ENVIRONMENT`、`BETTER_AUTH_SECRET`、`AUTH_SHELL_ORIGIN` 和
`AUTH_TURNSTILE_SECRET_KEY`；`APP_API_SAFETY_IDENTIFIER_HMAC_SECRET` 是聊天准入和就绪检查的核心
输入。认证邮件仅在实际发送时读取 `AUTH_EMAIL_FROM` 和 `RESEND_API_KEY`；`AUTH_EMAIL_FROM` 同时作为
发件人与回复地址。缺失这些值不会阻止已验证用户登录或刷新会话，但相应邮件操作会明确失败。

## 本地命令

```bash
pnpm install
pnpm dev:shared-reconcile
pnpm dev:init -- --target core
pnpm --dir apps/app-api dev
pnpm --dir apps/app-api test
pnpm --dir apps/app-api test:worker
pnpm --dir apps/app-api test:shared-db-integration
pnpm --dir apps/app-api typecheck
pnpm --dir jobs/campus-agent-schema test:migration-integration
```

`pnpm dev:init -- --target core` 为当前 worktree 生成隔离的本地配置和数据库。数据库结构变化通过声明式 schema 和
`jobs/campus-agent-schema` 中新增的统一 migration 完成；不得修改已应用 SQL。`ops/db/` 只保留显式
seed、授权来源和业务测试所需代码，业务 seed 不进入 migration。

## 相关文档

- `docs/architecture/system/product-runtime.md`
- `docs/architecture/system/identity-authz.md`
- `docs/contracts/app-api/README.md`
- `docs/data/app-api/README.md`
- `docs/data/postgres-ownership.md`
- `docs/runbooks/release.md`
- `jobs/campus-agent-schema/README.md`
