---
doc_type: plan
status: completed
created: 2026-04-02
updated: 2026-04-02
---

# Env Bootstrap And Provider Configuration Governance

**Goal:** 把 `campus-agent` 当前围绕 `LLM_API_KEY` / `EVAL_LLM_API_KEY` / `.env` bootstrap / 多 worktree 本地运行的配置路径，从“依赖隐式 shell 状态的局部约定”收口为“entrypoint 明确 bootstrap、library 只读进程环境、deploy 只认 secret store”的长期架构。

**Architecture:** 本文定义 env ownership、bootstrap boundary、provider precedence、fail-fast diagnostics 与 deploy secret governance 的长期重构方向。它不重写 retrieval / supervisor / app topology，只修正这条配置链路的长期真相。

**Tech Stack:** `packages/shared` env bootstrap helper, typed settings resolver, `packages/evals`, `apps/supervisor-api`, app-local `.env` / `.dev.vars`, Cloudflare or host secret store

---

## Summary

当前 repo 的真实问题不是“`LLM_API_KEY` 值本身坏掉”，而是：

- 当前 worktree `.env` 已经存在 key，但 ad-hoc `uv run ... python - <<'PY'` 进程默认不会自动装载它
- repo-shipped CLI 和 ad-hoc 脚本的 bootstrap 行为没有形成单一、显式、可诊断的 contract
- `packages/evals` 的错误文案会把“缺 key”“没 bootstrap”“读错 surface”都压扁成 `LLM_API_KEY is required`
- 文档仍有一处错误地写成“必要时回退根 worktree `.env`”，与实现和测试不一致

长期上，这条链路必须固定为：

1. secret source
2. explicit bootstrap at entrypoint
3. typed provider resolver
4. runtime consumer
5. diagnostics and verification

## Current Repo Problem

### 1. Env source 存在，但 process visibility 不稳定

当前 worktree `.env` 已经配置了：

- `LLM_API_KEY`
- `EVAL_LLM_API_KEY`
- `EMBEDDING_API_KEY`
- `EVAL_RAGAS_MODEL`
- 其他 eval/provider 相关键

但 ad-hoc `uv run --all-packages python - <<'PY'` 默认仍读不到这些值。只有显式调用 `campus_shared.load_repo_env()` 后，当前进程环境才会出现这些键。

### 2. 文档、实现、测试存在 drift

- 文档仍写 repo-shipped Python CLI “必要时回退根 worktree `.env`”
- 实现当前只读取当前 worktree `.env`
- 测试也明确锁定“不回退根 worktree `.env`”

这会直接误导后续排障。

### 3. Provider precedence 不是单点真相

当前 eval settings 自己解析：

- `EVAL_LLM_API_KEY > LLM_API_KEY`
- `EVAL_EMBEDDING_API_KEY > EMBEDDING_API_KEY`

这套优先级方向本身没问题，但它仍散落在 consumer 层，而不是 shared resolver。

### 4. Error model 太弱

当前错误只会报：

- `LLM_API_KEY is required`
- `EMBEDDING_API_KEY is required`

这不够区分：

- 当前进程根本没 bootstrap
- `.env` 存在，但没被入口装载
- override key 缺失，但 fallback key 存在
- 当前 surface 用错了 key owner

## Non-Goals

本轮不做以下事情：

- 不把 `.env` 读取逻辑塞进 library / settings / adapter 的 import side effect
- 不把根 worktree `.env` silent fallback 当作长期便利能力
- 不把 deploy secret ownership 回退成 repo-root `.env` 真相
- 不把 provider-specific SDK 细节泄漏进 `packages/contracts`
- 不把这条配置治理工作扩成新的 app/runtime topology 讨论

## Target State

### 1. Bootstrap boundary 固定为 entrypoint-only

只有 repo-shipped entrypoint 可以负责 bootstrap。

允许：

- `python -m campus_evals.*`
- `apps/supervisor-api` 本地 dev entrypoint
- 其他 repo-shipped CLI

不允许：

- `RagasSettings.from_env()` 自己去读 `.env`
- `JudgeLLMSettings.from_env()` 自己去读 `.env`
- 任意 helper 在 import 时偷偷装载 env 文件

### 2. Runtime truth 固定为 current worktree / current app

本地运行时只认：

- 当前 worktree `.env`
- 当前 app-local `.env`
- 当前 app-local `.dev.vars`
- 当前 shell 已显式注入的环境变量

长期上不接受：

- silent fallback 到根 worktree `.env`
- 因为“本地方便”而让解析来源变得不可追踪

### 3. Provider precedence 固定为 shared resolver

长期上所有 consumer 都只能消费同一个 provider resolver 输出。

至少应有：

- shared llm provider
- shared embedding provider
- eval llm override
- eval embedding override
- resolved provider settings

固定优先级：

- `EVAL_LLM_* > LLM_*`
- `EVAL_EMBEDDING_* > EMBEDDING_*`

模型名继续链路分离：

- `EVAL_RAGAS_MODEL`
- `EVAL_JUDGE_MODEL`

### 4. Diagnostics 固定为 typed config errors + doctor command

缺配置时应直接报告：

- logical config item 缺失的名称
- 实际检查过的 env key 顺序
- 当前是否执行过 bootstrap
- 当前命中的 bootstrap source path
- 当前 surface / consumer 名称

同时提供 repo 级 doctor 命令，只输出 presence/source/precedence，不泄露 secret 值。

### 5. Deploy 只认 secret store

本地 `.env` 只用于本地。

长期 deploy 语义固定为：

- `dev`
- `staging`
- `prod`

各环境独立 key / 独立预算 / 独立轮换。

如果 provider 是 OpenAI，则优先使用不同 Project 的 API keys，而不是跨环境共用同一把 key。

## Workstreams

### Workstream 1: Freeze ownership and fix doc drift

交付物：

- 统一写清 env ownership
- 明确 current worktree bootstrap truth
- 明确 ad-hoc 脚本不会自动 bootstrap `.env`
- 记录不再接受 root worktree fallback

要求：

- `docs/environment/README.md` 与实现一致
- `docs/README.md` 收录本计划
- `.planning` 插入独立 phase，避免把这项 urgent work 继续藏在 Phase 8 的“缺 key”叙事里

### Workstream 2: Shared bootstrap and provider resolver foundation

交付物：

- `packages/shared` 新的 bootstrap contract
- typed provider resolver
- typed config errors
- bootstrap state introspection helper

要求：

- entrypoint 才能触发 bootstrap
- consumer 不再分散拼装 precedence
- library 仍保持 env-only 读取姿态

### Workstream 3: Consumer migration

交付物：

- `packages/evals` settings 改为消费 shared resolver
- `apps/supervisor-api` 与其他 repo-shipped Python entrypoint 统一 bootstrap 行为
- ad-hoc 脚本文档显式保留“不自动 bootstrap”的语义

要求：

- 不新增双路径临时兼容层
- 不把 root fallback 重新带回 repo

### Workstream 4: Doctor and verification lane

交付物：

- `doctor_env` 风格命令
- bootstrap / precedence / error-model 单测
- eval/readme/runbook 更新

要求：

- 诊断输出只报告 presence/source，不打印 secret
- 能明确区分 missing key、missing bootstrap、wrong owner

### Workstream 5: Deploy secret governance

交付物：

- deploy-side runbook
- env-specific key ownership
- rotate / revoke / verification checklist

要求：

- 不再把 deploy readiness 写成 root `.env` 问题
- local convenience 与 deploy truth 完全分开

## Execution Order

推荐顺序固定为：

1. 文档与 roadmap 收口
2. shared bootstrap / resolver 基础设施
3. eval consumer 迁移
4. doctor + tests + error model
5. deploy governance / runbook

不建议先做的事情：

- 不先改 error 文案而不改 resolver
- 不先加 root fallback 解决眼前问题
- 不先把 ad-hoc shell 习惯包装成长期 repo truth

## Acceptance Gates

### Gate 1: Bootstrap truth

- repo-shipped Python CLI 在当前 worktree `.env` 存在时能稳定读取 provider env
- ad-hoc inline Python 默认不会自动 bootstrap `.env`
- 文档明确把这种差异写成预期行为，而不是偶发问题

### Gate 2: Resolver truth

- 所有 LLM provider consumer 使用同一个 precedence 规则
- 所有 embedding provider consumer 使用同一个 precedence 规则
- 缺配置时错误信息包含 key precedence，而不是笼统 `is required`

### Gate 3: Multi-worktree truth

- 当前 worktree 没有 `.env` 时不会 silent fallback 到根 worktree
- 如需复用根 worktree 值，只能通过显式同步脚本或 shell 注入

### Gate 4: Deploy truth

- deploy docs 明确 secret owner 和注入位置
- `dev/staging/prod` provider key 分离
- rotate / revoke / verification 路径可重复执行

## Canonical References

- `docs/environment/README.md`
- `packages/shared/src/campus_shared/env_bootstrap.py`
- `tests/test_repo_env_bootstrap.py`
- `packages/evals/src/campus_evals/settings.py`
- `packages/evals/README.md`
- `.env.example`
- `apps/supervisor-api/src/campus_supervisor_api/dev_server.py`

## Phase Mapping

这份计划由 `.planning` 中新增的 `Phase 09.1: Env Bootstrap And Provider Configuration Governance` 承接。

该 phase 的目标不是“补一把 key”，而是把当前围绕 live eval / handbook accept 的配置链路从局部约定重构成长期稳定 contract。
