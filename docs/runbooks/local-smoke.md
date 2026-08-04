---
doc_type: runbook
owner_boundary: local-development
status: active
---

# 本地运行检查

## 边界

本地开发可以使用 `infra/local/docker-compose.execution-runtime.yml` 作为诊断工具，但仓库不在
Kubernetes/GitOps 之外维护第二套 staging 生命周期。

产品页面本地开发使用 worktree profile 和应用本地托管环境文件，不读取根 `.env`。仓库只生成 loopback 数据库凭据和应用本地随机 secret；Provider、Qdrant、Temporal、Hindsight 与其他外部凭据仍由开发者进程环境显式提供。

默认 compose 使用 debug OTel Collector。只有验证外部 fan-out 时加入
`docker-compose.execution-runtime.fanout.yml`，需要本地 Langfuse 时再启动对应 compose。

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

`build:test` 只供浏览器回归使用确定性测试内容。Campus Web 的正常开发和构建读取对象存储固定键
`campus-docs/source.json`；在运行 `pnpm dev` 前，向
`env/commands/campus-docs-source.env` 注入对象存储地址和派生桶凭据。根命令首次运行时自动执行
`pnpm dev:init`，随后同时启动 Campus Web、app-api 和包含 Node API 的 Ops Web。命令输出当前
worktree 的三个 URL；Dining 学生端、运维编辑器和持久化数据库使用同一个实例。

文档准备进程读取对象存储配置并生成按来源摘要命名的本地目录；随后启动的 Vite 进程只接收该目录、
构建目标和页面运行所需配置，不接收对象存储凭据。没有对象存储访问时，应使用 `build:test` 和
Worker fixture 检查，不要把测试环境改成读取远端文档。

初始化失败时运行：

```bash
pnpm dev:doctor
pnpm dev:instances
```

database 与 bucket 必须同时存在或同时不存在。只有一个存在表示上次供应中断，初始化会 fail closed；按 `pnpm dev:destroy` 输出的确认命令删除该实例后重新初始化。单独启动应用只适合所属应用调试，仍要求当前 worktree 已执行 `pnpm dev:init`。

## Provider 配置

在线配置由 execution-control 的模型配置数据库和 keyring 持有。需要修改时启动本地
execution-control admin 与 Ops Web，按 `provider-secrets.md` 保存并验证 LLM 和 Embedding 当前值；
应用启动不能静默 seed 在线配置。

## Chat 检查

先确认 execution-control 已由开发者选择的平台启动：

```bash
curl -sS http://127.0.0.1:27051/healthz
curl -sS http://127.0.0.1:27051/readyz
pnpm smoke:app-api -- chat-dev
```

`chat-dev` 不负责启动或重启 execution-control；运行前必须显式启动所需依赖。

浏览器业务回归只在本地执行，不进入 GitHub Actions：

```bash
pnpm --dir apps/campus-web test:e2e:smoke
pnpm --dir apps/campus-web test:e2e:full
```

staging 的真实登录路径使用 `docs/runbooks/e2e.md` 中的 `chat-staging` 命令，并由发布执行者即时
取得测试账号和 Turnstile token。
