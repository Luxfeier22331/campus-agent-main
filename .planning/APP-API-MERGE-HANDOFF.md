# App API Merge Handoff

## Status

Pending merge on 2026-03-28.

这份 handoff 只服务于后续把 `apps/app-api` 的独立 worktree 实现先回 `develop`、再经 PR 进入 `main`。它不把 worktree 内尚未合入的实现写成当前 merged truth。

## Goal

把独立 worktree 中的 `app-api` Worker 实现，对齐到当前 `develop` 已冻结的 shared seam：

- `ContextProjection`
- `SupervisorRequest`
- `SupervisorResponse`
- memory 只个性化、不授权
- audit / telemetry 继续最小化

## 必须对齐的 Contract

### 1. 用 `ContextProjection` 替代旧 `snapshot`

合并前必须删除或改写：

- `ActorContext.snapshot`
- 任意 `snapshot` request payload
- 任意依赖 raw auth / raw transcript / raw memory 直传到 supervisor 的代码

合并后必须成立：

- `SupervisorRequest.actor` 与 `SupervisorRequest.context.actor` 一致
- `profile_memory`、`session` 进入 `ContextProjection`
- downstream 不接收 raw JWT、raw cookie、raw transcript、raw long-term memory

### 2. supervisor client 改用 `SupervisorResponse`

合并前必须清理：

- `SpecialistResponse`-only 假设
- app-api 直接按 specialist target/result shape 解析产品响应

合并后必须成立：

- app-api 调 supervisor 时使用 `SupervisorRequest`
- app-api 消费 `SupervisorResponse`
- chat / panel / operator surface 按 `selected_target + status` 做 UI/业务映射

### 3. memory 不得扩大 ACL

允许：

- canonical identity / profile memory / session summary -> `ContextProjection`
- specialist 基于 typed projection 生成 personalization hint

禁止：

- 用 profile memory/session memory 改写 `groups`
- 用 memory 放开 `campus_scope`
- 用 memory 放开未开放 collection
- 用 memory 绕过 `approval_required` 或 `rejected`

## 合并时重点检查的代码面

- app-api request projection builder
- app-api supervisor client / runtime adapter
- chat ingress request mapping
- panel query request mapping
- auth/session 到 actor claims 的 canonical projection
- Worker integration tests 与 contract tests

## 需要补的测试

合并后的 app-api 相关测试至少要覆盖：

- request builder 输出 `ContextProjection`
- `actor` 与 `context.actor` 一致
- profile/session projection 默认不含 raw sensitive data
- app-api 正确消费 `SupervisorResponse`
- `needs_clarification` / `approval_required` / `rejected` / `error` 能被产品层正确投影
- memory 不能改变 ACL groups、campus scope 或 serving surface

## 验证命令

最少验证：

- `env UV_CACHE_DIR=/tmp/uv-cache uv run --no-project python -m unittest tests.contracts.test_models tests.supervisor.test_supervisor_core tests.specialist.test_rag_specialist tests.evals.test_golden_cases`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --no-project python -m unittest discover -s tests -t .`

如果 app-api 自己带有独立测试集，也必须在 merge 前补跑并记录结果。

## 禁止事项

- 不要把 worktree 里的旧 `snapshot` seam 带回 `develop`
- 不要把 unmerged worktree 的实现进度写成 `develop` 已完成 truth
- 不要让 app-api 通过 raw memory / raw auth 直接驱动 supervisor routing
- 不要把 raw identity / raw memory 落到 audit 或 telemetry sink

## Merge 完成定义

只有当以下条件同时满足，worktree 才可视为对齐完成：

- `develop` 侧 `ContextProjection` / `SupervisorResponse` seam 未被回退
- app-api Worker 代码已改到新 seam
- app-api 相关测试通过
- 仓库级 baseline 仍通过
