# Agent Note: 本地 Ops Web 内部凭据解析代理

Status: implemented

## 背景

开发环境的公开页面和服务端 API 由不同入口提供。通知采集 worker 通过 `OPS_WEB_INTERNAL_URL`
请求内部门户凭据解析接口；该 URL 未指向 API owner 时，开发服务器不会代理 `/internal`，请求会落到
前端兜底路由并使采集失败。

## 决策

本地 Vite 开发服务器同时代理 `/internal` 到 Ops Web API 端口。这样保留公开端口作为 worker 的内部 URL，且不改变生产部署的同源服务路由和内部 token 合同。

## 未采用方案

- 将 `OPS_WEB_INTERNAL_URL` 改为 API 端口：API 端口属于 automation host，应用会拒绝不在 `/api/automation` 下的内部路径。
- 在 worker 中绕过 Ops Web 直接读取凭据：会破坏 Ops Web 对 TGC 凭据的所有权边界。

## 后果

内部路径现在由 Ops Web API owner 处理；内部门户凭据仍由环境配置提供，采集、分类、发布和
artifact worker 的完整链路继续按环境 runbook 验证。
