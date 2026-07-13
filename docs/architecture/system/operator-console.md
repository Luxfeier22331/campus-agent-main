---
doc_type: architecture
truth_scope: system
owner_boundary: apps/operator-console-web
status: active
created: 2026-06-13
updated: 2026-07-12
---

# Operator Console

## 文档边界

本文定义 Cloudflare Worker 上的受控配置工作台。请求排查和运行观测由 self-hosted Ops Web
负责；source-processing API 的存在不自动成为本工作台页面。

## 当前页面

一级导航固定为：

- `/operations/provider-config`：模型服务连接、profile 和 active selection。

根路径和未知路径重定向到 provider config。当前没有 request list/detail、runtime、dining、
notice、ingestion 或通用 dashboard 页面。

## 运行边界

- Worker 提供静态 React shell、`/api/overview`、登录态校验和受控 app-api proxy。
- `APP_API` Service Binding 是配置 API 的上游；浏览器不直接持有 app-api shared secret。
- `/api/overview` 只返回当前 operator context 和 protection envelope，不聚合运行指标。
- 页面使用 TanStack Query、React Router 和仓库现有 shadcn/Radix 风格组件。

## 访问控制

- Cloudflare Access 负责外层身份；Worker 校验 Access context 和 operator allowlist。
- app-api 再执行自己的 operator authz；console 身份不自动获得数据库或 runtime 权限。
- 缺少 Access、binding、shared secret 或 app-api readiness 时失败关闭。

## 与 Ops Web 的分工

| Operator Console | Ops Web |
| --- | --- |
| 修改 provider config | 读取运行概况和请求摘要 |
| Cloudflare Worker | self-hosted Node/Hono |
| 通过 app-api 写受控配置 | 直接使用最小数据库权限和内部观测接口 |
| 不展示 request diagnosis | 不修改产品配置或运行状态 |

Operator Console 不保留 request 兼容路由，也不代理 Ops Web。

## 禁止形态

- 不恢复 `Requests`、runtime health、autoscaler 或 queue posture 页面。
- 不直连 PostgreSQL、Temporal、Langfuse、OpenObserve、Hindsight 或 execution-control。
- 不把 app-api operator source-processing API 自动生成成页面。
- 不把配置写入 Worker 本地状态或环境变量作为 active profile truth。

## 可执行来源

- `apps/operator-console-web/src/panel/app.tsx`
- `apps/operator-console-web/src/index/worker.ts`
- `apps/operator-console-web/README.md`
- `apps/app-api/src/app/routes/operator.ts`
