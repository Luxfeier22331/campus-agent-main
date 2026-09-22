# Agent Note: 本地 Ops Web 内部凭据解析代理

Status: implemented

## 背景

本地 Ops Web 将公开页面放在 `opsWeb` 端口，将服务端 API 放在 `opsWebApi` 端口。通知采集 worker 通过 `OPS_WEB_INTERNAL_URL` 请求内部门户凭据解析接口；该 URL 继续指向公开端口时，Vite 只代理 `/api`，请求 `/internal/ops/internal-portal/credentials/resolve` 会落到前端兜底路由，真实采集在 Temporal 中以 404 失败。

## 决策

本地 Vite 开发服务器同时代理 `/internal` 到 Ops Web API 端口。这样保留公开端口作为 worker 的内部 URL，且不改变生产部署的同源服务路由和内部 token 合同。

## 未采用方案

- 将 `OPS_WEB_INTERNAL_URL` 改为 API 端口：API 端口属于 automation host，应用会拒绝不在 `/api/automation` 下的内部路径。
- 在 worker 中绕过 Ops Web 直接读取凭据：会破坏 Ops Web 对 TGC 凭据的所有权边界。

## 后果

本地真实请求已从前端 404 变为 Ops Web 的业务响应；当前 worktree 未配置可用的内部门户凭据，因此 workflow 能进入 `notice-pipeline` 队列并由 worker 执行，但最终因 `OPS_INTERNAL_PORTAL_CREDENTIAL_UNAVAILABLE` 失败。凭据准备后可复用同一 API 重新验证采集、分类、发布和 artifact worker 链路。
