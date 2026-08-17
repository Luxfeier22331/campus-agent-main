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
- Runtime Command 对外 service 只编排请求接受、持久执行准入和产品终态，具体阶段规则由所属子模块
  维护；
- schema 和跨模块类型是 leaf dependency，不得反向导入 service、store facade 或运行时实现。

## 本地命令

```bash
pnpm install
pnpm dev:init
pnpm --dir apps/app-api dev
pnpm --dir apps/app-api test
pnpm --dir apps/app-api test:worker
pnpm --dir apps/app-api test:shared-db-integration
pnpm --dir apps/app-api test:migration-integration
pnpm --dir apps/app-api typecheck
pnpm --dir apps/app-api db:generate
pnpm --dir apps/app-api db:check
```

`pnpm dev:init` 为当前 worktree 生成隔离的本地配置和数据库。数据库结构变化通过声明式 schema 和
新增 migration 完成；不得修改已应用 SQL。本地数据库脚本位于 `ops/db/`，安装与部署顺序见 schema
Job README 和发布手册。

## 相关文档

- `docs/architecture/system/product-runtime.md`
- `docs/architecture/system/identity-authz.md`
- `docs/contracts/app-api/README.md`
- `docs/data/app-api/README.md`
- `docs/data/postgres-ownership.md`
- `docs/runbooks/release.md`
- `jobs/app-api-schema/README.md`
