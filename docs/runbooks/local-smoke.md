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
pnpm --dir apps/operator-console-web test:worker -- --reporter=verbose
```

## Provider 配置

```bash
pnpm --dir apps/app-api exec tsx ./scripts/run-with-local-env.ts pnpm exec tsx \
  ./ops/dev/seed-local-provider-config.ts --stage prompt
pnpm --dir apps/app-api exec tsx ./scripts/run-with-local-env.ts pnpm exec tsx \
  ./ops/dev/seed-local-provider-config.ts --stage embedding

pnpm exec tsx apps/execution-control/scripts/sync-provider-config-projection.ts \
  --output .tmp/provider-config-projection.json
```

seed 和 projection refresh 都是显式命令，不能在应用启动时静默执行。

## Chat 检查

先确认 execution-control 已由开发者选择的平台启动：

```bash
curl -sS http://127.0.0.1:27051/healthz
curl -sS http://127.0.0.1:27051/readyz
pnpm smoke:app-api -- chat-dev
```

`chat-dev` 不负责启动或重启 execution-control。runtime 缺失是阻塞项，不是恢复旧 lifecycle
脚本的理由。
