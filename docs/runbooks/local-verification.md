---
doc_type: runbook
owner_boundary: local-development
status: active
---

# 本地运行检查

## 边界

本地开发可以使用 `infra/local/docker-compose.execution-runtime.yml` 作为诊断工具。本文只覆盖本地
开发和受控浏览器检查。

产品页面本地开发使用 worktree profile 和应用本地托管环境文件，不读取根 `.env`。仓库只生成 loopback 数据库凭据和应用本地随机 secret；Provider、Qdrant、Temporal、Hindsight 与其他外部凭据仍由开发者进程环境显式提供。

默认 compose 使用 debug OTel Collector。只有验证本地 Agent trace 到 Langfuse 的转发时加入
`docker-compose.execution-runtime.langfuse.yml`。

## Worker 检查

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose
pnpm --dir apps/campus-web test:worker -- --reporter=verbose
```

## Campus Web 与文档阅读

```bash
pnpm --dir apps/campus-web test:node:fast
pnpm --dir apps/campus-web build:test
pnpm dev
```

`build:test` 只供浏览器回归使用确定性测试内容。`pnpm dev` 负责当前 worktree profile 的本地服务启动；
文档来源、构建输入和 `docs:source:update` 的维护见[文档站架构](../architecture/system/document-site.md)
与[Campus Docs 维护](./campus-docs.md)。本地 profile、共享依赖、故障诊断与实例清理由
[环境变量与本地开发](../environment/env.md)维护。

## Ops Web API

Ops Web 本地 API、fixture 和就绪接口由[Ops Web README](../../apps/ops-web/README.md)与
[Ops Web 合同](../contracts/ops-web/README.md)维护。

## Provider 配置

模型设置、本地运行关系和密钥操作见[在线模型密钥操作](./provider-secrets.md)。

## Campus Web 浏览器回归

浏览器业务回归只在本地执行，不进入 GitHub Actions：

```bash
pnpm --dir apps/campus-web test:e2e:smoke
pnpm --dir apps/campus-web test:e2e:full
```

Temporal 工作流 E2E 按需在本地执行。测试会启动 Temporal Dev Server，不连接 staging 或其他部署环境：

```bash
go -C apps/execution-control test -tags=temporal_e2e ./internal/temporalruntime ./internal/httpapi -count=1
```
