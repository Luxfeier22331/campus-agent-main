# App API Merge Handoff

## Status

Pending merge on 2026-03-28.

这份 handoff 只服务于后续把 `apps/app-api` 的独立 worktree 实现先回 `develop`、再经 PR 进入 `main`。它不把 worktree 内尚未合入的实现写成当前 merged truth。

截至 2026-03-29，这份 handoff 对应的 ACL/authz 过渡态仍未关闭。原因不是长期方向未定，而是 worktree 内的 `app-api` execution seam 还没有完全对齐 shared `ContextProjection + AuthorizationProjection + SupervisorResponse` contract。

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

## 当前审计结论（2026-03-29）

目前独立 worktree 中至少还有以下未对齐点，因此不能直接宣称可以结束 ACL/authz 过渡态：

- `apps/app-api/src/modules/auth/principal.ts`
  仍以 `ExecutionActorContext` 承载 `groups`、`campusScope` 与 `snapshot`，说明 principal/authz 还没有收口成 canonical projection。
- `apps/app-api/src/modules/integration/supervisor.ts`
  仍向 `apps/supervisor-api` 发送 top-level `actor` payload，并依赖旧 `target` response shape，而不是 `ContextProjection` + `SupervisorResponse`。
- `apps/app-api/src/campus_app_api/projection.py`
  仍只构建 `actor + profile_memory + session`，还没有构建 `authorization`。
- `apps/app-api/src/modules/runtime-command/service.ts`
  仍把 `actorSnapshot` 写入 execution path 相关记录；如需保留，只能降级为 read-model / audit material，不能继续作为 downstream execution seam 的真相。
- `apps/app-api/test/supervisor-adapter.test.ts` 与 `tests/app_api/test_projection.py`
  当前断言仍锁定旧请求/响应形态，因此测试面也没有完成对齐。

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

## 结束过渡态的最小关闭条件

只有当以下条件全部成立，才可以说 worktree 已支持结束 ACL/authz 过渡态：

1. `apps/app-api` principal/auth/session path 不再把 `snapshot` 当成 execution contract，并能稳定产出 canonical `ContextProjection.authorization`。
2. app-api supervisor adapter 统一发送 `SupervisorRequest` 兼容的 `context` payload，而不是 top-level `actor` payload。
3. app-api 统一消费 `SupervisorResponse` 的 `selected_target + status + error/result` 语义，不再按 specialist-only shape 做产品映射。
4. panel/chat/operator surface 都通过 app-api 的 canonical projection path 执行，不再各自保留 legacy actor carrier。
5. memory/session 相关代码与测试明确证明：不能改写 ACL groups、visibility scope、serving surface 或 approval outcome。
6. app-api 自身测试、shared contract tests 与仓库 baseline 同时通过。

## Merge 完成定义

只有当以下条件同时满足，worktree 才可视为对齐完成：

- `develop` 侧 `ContextProjection` / `SupervisorResponse` seam 未被回退
- app-api Worker 代码已改到新 seam
- app-api 相关测试通过
- 仓库级 baseline 仍通过
