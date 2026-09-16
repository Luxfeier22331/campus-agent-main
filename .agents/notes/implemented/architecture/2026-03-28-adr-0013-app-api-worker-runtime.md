# Agent Note: ADR-0013 App API Worker 运行时

Status: implemented

## 背景

共享产品后端需要与 Worker 浏览器界面兼容的运行环境，同时私有执行和数据服务继续
自托管。

## 决策

`apps/app-api` 作为 Cloudflare Worker 运行，并保持 modular monolith。它拥有产品 HTTP
合同，通过环境管理的 Cloudflare 私网连接访问 PostgreSQL。

Campus Web 使用已开放的同源 proxy 或 Service Binding。app-api
origin 不是第二个公开产品入口，浏览器不得借此绕过所属 Web 界面。

execution-control 继续自托管。app-api 发送 typed execution request 并消费有界 projection，
不托管 Temporal worker、检索或模型执行。

## 未采用方案

- **并行维护自托管产品后端**：可以与私有服务共用部署平台，但会形成 Worker 之外的第二个产品后端；
  产品 HTTP 合同仍由 app-api 统一拥有，私有执行继续留在 execution-control。

## 后果

- app-api 不作为并行 Docker/Kubernetes 产品后端部署。
- 数据库 migration 使用 management connection，不使用 Worker runtime binding。
- Worker 部署细节和域名属于环境配置。
- framework 内部变化不改变此运行时边界。

## 相关文档

- [产品运行时](../../../../docs/architecture/system/product-runtime.md)
