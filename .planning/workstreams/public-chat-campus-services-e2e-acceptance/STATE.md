---
doc_type: state
status: active
created: 2026-04-27
updated: 2026-04-27
---

# State: Public Chat Campus Services E2E Acceptance

## Current Status

- status: `active`
- current phase: `Phase 4`
- current slice: fail-close, clarification, and no-action guardrails
- owner: current Codex session
- active implementation: Phase 3 complete; deterministic Worker harness now covers positive
  routing/handoff matrix plus browser-safe answer rendering and source-trace-safe text for the four
  campus-services tools

## Current Context

2026-04-27 当前代码状态：

- `service_status_lookup`、`transport_schedule_lookup`、`service_guide_lookup` 已有 PG-backed
  structured runtime path 与 focused tests。
- `contact_directory_lookup` 已补齐 contract model、Go structured query runtime、Python thin
  adapter、planner/policy wiring 与 deterministic release gate profile。
- `service-guide-lookup` 与 `contact-directory-lookup` 都有 deterministic eval gate。
- `app-api` 会解析 supervisor `/readyz` 中的 `capability_gates` 与
  `structured_query_runtime`，生成 `preflight.campusServicesProductPath`。
- `public-chat-web` `/readyz` 会透传 app-api 的 campus-services preflight，用于 product-path
  opening gate 诊断 capability / projection / read-model blocker。
- Phase 2 已完成：public/chat deterministic Worker test 逐个 prompt 验证 app-api
  handoff input、`campus-services-agent` selected target、allowed tool / payload kind 与
  structured result shape。
- Phase 3 已完成：`app-api` completed answer path 对 `campus-services-agent` 改为优先消费
  `tool_result` 生成产品化回答，并把 source refs 归并为安全来源类别展示，避免暴露 release id、
  projection internals、raw parser/debug fields、或原始 source ref id。
- 当前缺口转入 Phase 4：覆盖 ambiguity clarification、fail-close、与 no-action guardrails。

## Phase 0 Completion

Phase 0 completed on 2026-04-27.

- Planning truth is active and complete for `README / REQUIREMENTS / ROADMAP / STATE`.
- Worktree hygiene classification is captured in
  `./phases/phase-0-planning-truth-and-worktree-hygiene/SUMMARY.md`.
- Focused campus-services baseline gates passed.
- Phase 1 may start from local deterministic public/chat E2E harness and preflight.

## Phase 1 Completion

Phase 1 completed on 2026-04-27.

- Local E2E posture is repo-owned deterministic Worker test harness first; staging smoke remains
  later evidence, not the Phase 1 default.
- `app-api` supervisor readiness transport now parses campus-services capability and structured
  runtime fields into a typed product-path preflight result.
- `app-api` `/readyz` publishes `preflight.campusServicesProductPath` on ready responses and keeps
  it available in dependency failure details when present.
- `public-chat-web` `/readyz` forwards app-api campus-services preflight, so opening checks can see
  blockers without calling app-api directly.
- The existing public-chat smoke continues to use an authenticated deterministic test principal;
  anonymous chat remains out of scope.

## Phase 2 Completion

Phase 2 completed on 2026-04-27.

- `apps/public-chat-web/test/worker.test.ts` now includes a deterministic product-path matrix that
  runs `public-chat-web -> app-api /api/chat/requests -> buildChatCommandService -> supervisor`.
- Covered positive handoff cases:
  - `service_status_lookup`: 丰台校区通勤班车乘车点 / 当前状态
  - `transport_schedule_lookup`: 丰台回海淀首班 / 班次时间
  - `service_guide_lookup`: 地铁接驳车预约入口
  - `contact_directory_lookup`: 研究生院办公室电话
- Assertions cover:
  - app-api supervisor input carries `surface=public_chat_web` and the original prompt
  - public chat does not force an explicit browser `requestedCapability`
  - selected target is `campus-services-agent`
  - result carries allowed tool, payload kind, structured tool result, and resolved-current outcome
  - finalized request projection records selected target, completed status, and diagnostics summary
- Phase 2 intentionally does not expose raw supervisor response on the browser-facing chat response.
  The public HTTP contract still returns the browser-safe `answer` envelope only.

## Phase 3 Completion

Phase 3 completed on 2026-04-27.

- `apps/app-api/src/modules/runtime-command/service/normalize.ts` 新增
  campus-services answer synthesis，`completed + campus-services-agent` 会从
  `tool_result` 渲染用户回答，覆盖：
  - `status_note` / `operational_notices`
  - guide sections / entry refs
  - contact points / location refs
  - transport departure fact
- source refs / notice refs / contact source refs 不再原样外露，统一降维到来源类别
  （如“校内通知”“学校官网”“服务目录”）。
- `apps/app-api/src/modules/runtime-command/service/writes.ts` 在 `completed` 分支优先使用
  campus-services synthesis 文本，再执行 browser-safe sanitizer。
- `apps/app-api/test/chat-command.service.core.structured.suite.ts` 新增 Phase 3 用例：
  给出带 `release_id`/`projection_internal_state`/原始 ref id 的上游 `answerText`，断言
  最终用户文案由 structured facts 渲染且不泄漏内部字段。
- `apps/public-chat-web/test/worker.test.ts` 强化产品路径 E2E：
  上游返回污染 `answerText` 时，`public-chat-web -> app-api -> chat response`
  仍输出结构化安全文案。

## Captured Acceptance Prompts

- “丰台校区通勤班车在哪里上车”
- “通勤班车丰台校区乘车点现在在哪里”
- “2月24日丰台回海淀最早的班车是几点”
- “地铁接驳车怎么预约”
- “校园卡丢了怎么办”
- “研究生院办公室电话是多少”
- “招生办联系方式”
- “帮我给招生办发邮件”

## Expected Tool Routing

- 乘车点、开放状态、临时关闭、当前运营调整 -> `service_status_lookup`
- 班车时刻、下一班、首班、末班、时刻表版本 -> `transport_schedule_lookup`
- 预约说明、办理流程、材料、入口、办公时间、怎么办 -> `service_guide_lookup`
- 稳定部门电话、邮箱、办公地点、联系人、办公时间 -> `contact_directory_lookup`

## Blockers / Preconditions

- 需要确认 test path 是否依赖真实 shared PG current release；若依赖，必须把 readiness
  preflight 写成可诊断 blocker。
- Phase 2 需要把首批 prompts 从 generic chat smoke 推进到 selected target / selected tool /
  payload kind / answer trace 断言。

## Verification Plan

Phase 0 baseline passed:

- `cd apps/supervisor-api && go test ./internal/structuredquery ./internal/httpapi ./internal/runtimepolicy ./internal/structuredplanning`
- `uv run --all-packages python -m unittest tests.agent.test_campus_services_agent`
- `uv run --all-packages python -m scripts.eval_gate accept --profile service-guide-lookup --json`
- `uv run --all-packages python -m scripts.eval_gate accept --profile contact-directory-lookup --json`

Phase 1 focused gates passed:

- `pnpm --dir apps/app-api test:node -- --runInBand test/supervisor-adapter.test.ts test/worker.test.ts`
- `pnpm --dir apps/public-chat-web test:worker -- --runInBand test/worker.test.ts`
- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm exec biome check apps/app-api/src/app/types.ts apps/app-api/src/modules/integration/index.ts apps/app-api/src/modules/integration/supervisor.ts apps/app-api/src/modules/integration/supervisor-transport.ts apps/public-chat-web/src/index.ts apps/app-api/test/supervisor-adapter.access.suite.ts apps/app-api/test/worker.test.ts apps/public-chat-web/test/worker.test.ts`
- `pnpm docs:lint`
- `git diff --check`

Phase 1 verification note:

- Repo-wide `pnpm web:lint` is still blocked by unrelated existing dirty files outside this
  phase. The Phase 1 touched TS files pass targeted Biome check.

Later phases add:

- `campus-services-product-path` unified gate profile
- optional staging smoke once local deterministic gate is stable
- fail-close / clarification / no-action guardrail acceptance

## Continuity Notes

- 不要把这条线变成 ingestion 或 projection rebuild 工作。
- 不要用 generic retrieval fallback 让 E2E 通过。
- 失败判断必须区分 planner routing、agent handoff、structured query、projection readiness、
  final answer rendering 与 source trace rendering。
- Product opening verdict 必须按 tool 粒度给出，不应把整个 `campus-services-agent` 一次性默认开放。
