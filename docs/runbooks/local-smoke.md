---
doc_type: runbook
owner_boundary: local-development
status: active
---

# 本地运行检查

## 边界

本地开发可以使用 `infra/local/docker-compose.execution-runtime.yml` 作为诊断工具，但仓库不在
Kubernetes/GitOps 之外维护第二套 staging 生命周期。

本地命令只读取明确的 root/app `.env`、Worker `.dev.vars` 或 `env/commands/` 文件。仓库
不生成通用 env bundle 或本地 secret；缺失 provider、database、Qdrant、Temporal 或 Hindsight
配置时由开发者环境显式提供。

默认 compose 使用 debug OTel Collector。只有验证外部 fan-out 时加入
`docker-compose.execution-runtime.fanout.yml`，需要本地 Langfuse 时再启动对应 compose。

## Worker 检查

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose
pnpm --dir apps/campus-web test:worker -- --reporter=verbose
pnpm --dir apps/ops-web test
pnpm --dir apps/ops-web test:browser
```

## Campus Web 与文档阅读

```bash
pnpm --dir apps/campus-web test:node:fast
pnpm --dir apps/campus-web build:docs:fixture
pnpm dev
```

`build:docs:fixture` 使用仓库内无凭据 manifest 和 reader assets，不读取数据库或对象存储。根
`pnpm dev` 同时启动 Campus Web 与 app-api，避免文档准入、账号、聊天和 Dining 的同源
`/api/*` 依赖变成服务缺失错误。单独启动 Campus Web 只适合静态资源和纯界面调试。

## Provider 配置

准备 `apps/ops-web/.env` 后运行 `pnpm --dir apps/ops-web start`，再从“模型服务配置”创建、验证和
激活 profile。file publisher 原子写入 `.env` 指定的 projection 路径；应用启动不执行 seed 或
隐式同步。

## Chat 检查

先确认 execution-control 已由开发者选择的平台启动：

```bash
curl -sS http://127.0.0.1:27051/healthz
curl -sS http://127.0.0.1:27051/readyz
pnpm smoke:app-api -- chat-dev
```

`chat-dev` 不负责启动或重启 execution-control。runtime 缺失是阻塞项，不是恢复旧 lifecycle
脚本的理由。
