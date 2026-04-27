---
doc_type: state
status: completed
created: 2026-04-27
updated: 2026-04-28
---

# State: Campus Services Runtime Tool Gap Closeout

## Current Status

- status: `completed`
- current phase: `Phase 5 completed`
- current slice: none
- owner: none
- active implementation: no

## Closeout Summary (2026-04-28)

- Phase 1-5 status 与验证证据已完整记录在本文件的 latest verification
  sections。
- 最新 closeout artifact：
  `.tmp/evals/campus-services-product-path-opening-gate-accept-20260428T034731/`
- `campus-services-product-path` gate schema 已升级为
  `campus_services_product_path_opening_gate.v2`，并通过 `8/8` checks。
- 当前 product-path opened tools：
  `service_status_lookup`、`transport_schedule_lookup`、
  `service_guide_lookup`、`contact_directory_lookup`。
- `service_process_lookup` 保持 `keep_closed`，不进入当前 product path。
- 后续真实 public/chat 入口、staging smoke 与用户路径 drift 验证交给
  `public-chat-campus-services-e2e-acceptance`；本 workstream 只在 tool
  denominator、admission profile、opening verdict 或 runtime gate contract
  被显式改写时恢复。

## Phase 6 Handoff (2026-04-27)

来自 `public-chat-campus-services-e2e-acceptance` Phase 6 的回写项：

- `service_status_lookup` / `transport_schedule_lookup` /
  `service_guide_lookup` / `contact_directory_lookup` 已通过 local
  deterministic opening gate，后续只在本 backlog 继续收口 staging evidence
  与长尾 denominator 扩展。
- `service_process_lookup` 保持 `keep_closed`，未进入当前产品路径 admission。
- 任何 source-truth/projection 缺口继续由对应 ingestion/data-plane workstream 处理；
  本 backlog 只接 runtime tool denominator 与 opening 判定相关任务。

## Captured Tool Gaps (Post Phase 6 Handoff)

Phase 6 已完成 `campus-services-product-path` opening verdict。当前四个首发 tool 已是
`open` 判定，以下缺口转入长期质量与覆盖收口，不再阻塞本轮 opening：

### `service_status_lookup`

- subject alias 覆盖继续扩展：自然说法需要稳定映射到 canonical service / subject
  - 2026-04-27 slice 已补：`卡务中心今天开不开`、`校医院今天停诊了吗`、
    `食堂现在关门了吗`、`丰台校区通勤班车在哪里上车`
- status precedence regression 继续补强：临时调整、常规状态、历史记录、source conflict
  优先级
  - 2026-04-28 slice 已补：runtime 先按 current effective window 过滤，再优先选择更晚
    `effective_from` / 更窄 effective window 的临时 override；同一 subject 同一窗口冲突时
    fail-close 为 `source_conflict`
- `status_note` 的回答表达继续压测，确保只暴露用户可执行事实，不泄露内部字段
  - 2026-04-27 slice 已补：Python agent 与 app-api browser-facing answer 不再暴露
    `open` / `limited_service` 等内部枚举
- source trace / observability summary
  - 2026-04-28 slice 已补：execution finalizer 从 `related_notice_refs` /
    `override_source_refs` 推导 `notice_source_family_summary`，使 service status 的
    resolved / fail-close 路径都能给 operator summary 提供安全来源族，不把 raw notice id
    写入低基数字段

### `transport_schedule_lookup`

- route / direction / stop alias 长尾覆盖继续扩展
  - 2026-04-28 slice 已补：当 `origin_stop_query` 与 `destination_stop_query`
    同时出现时，runtime 按 route stop 顺序消歧；正向 route 命中后不再因反向 route 也包含同两个站而
    要求 clarification
- 长期线路、临时线路、临时站点调整、schedule exception precedence 继续做 regression
  - 2026-04-28 slice 已补：同一路线 / snapshot / service date 出现互相矛盾的
    `transport_service_exceptions` 时 fail-close 为 `source_conflict`，不再按读取顺序选择
- date/time 语义继续收口：节假日、周末、寒暑假、下一班、projection window 边界
  - 2026-04-28 slice 已补：`next_departure` 当天已过最后一班时返回 `not_found`
    并保留 `schedule_snapshot` provenance；超出 route/snapshot 推导服务日覆盖窗口时
    fail-close 为 `current_state_unverifiable`
  - 2026-04-28 slice 已补：显式 `service_date_ranges` 覆盖内但无班次的服务日返回
    `not_found`，与 projection 覆盖不足区分开
  - 2026-04-28 slice 已补：相同状态/说明的重复 service exception 合并来源 refs；
    不同状态或说明仍 fail-close 为 `source_conflict`
- operational notices answer shaping
  - 2026-04-28 slice 已补：Python agent 与 app-api browser-facing answer
    都会把 transport operational notices 渲染成去重后的用户可执行“运营提示”，
    并通过 safe source category/trace card 暴露来源，不把 raw notice ref 或 release
    locator 写入正文
- schedule how-to 路由边界
  - 2026-04-28 slice 已补：`地铁接驳车怎么预约`、`通勤班车乘车规则是什么`
    等 how-to / 规则 / 预约说明类问题路由到 `service_guide_lookup`；
    班次、首末班、下一班、时刻表与运营窗口仍归 `transport_schedule_lookup`
- deterministic eval denominator
  - 2026-04-28 slice 已补：planner golden cases、agent answer shaping case、
    app-api browser-facing structured answer case 与 release-gate intent cases
    覆盖 transport how-to 分流和 operational notice 表达
- OCR/table extraction 噪音仍按 data-plane 问题处理；runtime 维持 fail-close

### `service_guide_lookup`

- 2026-04-28 Phase 3 已补：service guide legacy `manual_review_required`
  fail-close 下线；旧 manual-review read model 命中统一按 `source_truth_unavailable`
  fail-close，新 release 不再接受 `needs_manual_review` / manual-review source truth
  状态。
- 2026-04-28 Phase 3 已补：Python agent 与 app-api browser-facing answer 会组合
  guide sections、materials、entry refs、office hours、contact refs 与 eligibility
  notes；`full_guide` 不再只显示第一个字段组。
- 2026-04-28 Phase 3 已补：service guide release gate 纳入 app-api structured answer
  test lane，deterministic denominator 覆盖 contract、Go runtime、Python agent 与
  app-api answer shaping。

### `contact_directory_lookup`

- 2026-04-28 Phase 4 已补：runtime 匹配文本扩展到 `contact_points`
  的 label / contact type / area served，以及 `office_hours` 的 label / day pattern /
  time range / note；夜间值班电话、值班时间等稳定联系方式说法不再只依赖
  department / alias 命中。
- 2026-04-28 Phase 4 已补：Python agent 与 app-api browser-facing answer 会组合
  phone / email / location / office hours；`all_contacts` 不再只展示第一个非空 fact
  group。
- 2026-04-28 Phase 4 已补：`帮我打电话`、`帮我发邮件` 这类联系方式执行动作进入
  transaction guardrail，planner 不会生成 `contact_directory_lookup` handoff。
- 2026-04-28 Phase 4 已补：`contact-directory-lookup` release gate 纳入 app-api
  structured answer test lane，deterministic denominator 覆盖 projection、intent、
  Go runtime、Python agent 与 app-api answer shaping。
- ambiguous alias clarification、conflict / non-ready / restricted source fail-close
  继续作为 regression denominator 保持。

### `service_process_lookup` (keep closed)

- 当前仍是 later-wave；已在 `campus-services-product-path` opening gate v2 中显式
  标记为 `keep_closed`
- 若后续要开放，必须新增独立 deterministic denominator 与 product-path E2E 验收

## Phase 5 Results (2026-04-28)

- `campus-services-product-path` gate 升级为
  `campus_services_product_path_opening_gate.v2`。
- tool admission profile 固定为 `open_candidate` / `keep_closed`：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `service_guide_lookup`
  - `contact_directory_lookup`
  - `service_process_lookup` 保持 `keep_closed`
- `opened_tools` / `blocked_tools` 只统计 `open_candidate` tools。
- `closed_tools` 单独记录未 admission 的 later-wave tools。
- 未来新增 runtime tool 时必须先进入 profile registry；未准备开放时默认写
  `keep_closed`，不能静默进入 product path。

## Continuity Notes

- 不得通过 generic RAG 或 notice text search 顶替 structured tools。
- 不得让 runtime 在 query time 回扫 raw notice / handbook / portal HTML。
- 恢复时先补 deterministic tool denominator，再接 public/chat E2E。

## Latest Verification (2026-04-27)

- `go test ./internal/structuredplanning ./internal/runtimepolicy`：pass
- 结构化 runtime/API targeted Go tests：pass
  - `go test ./internal/structuredquery ./internal/structuredplanning`
  - `./internal/runtimepolicy ./internal/httpapi`
  - `-run 'ServiceGuide|ContactDirectory|TransportSchedule|ServiceStatus|`
  - `StructuredPlan|AllowedTools|StructuredAnswerText|Readyz'`
- Campus services Python agent/eval unittest lane：pass
  - `uv run --all-packages python -m unittest`
  - `tests.agent.test_campus_services_agent`
  - `tests.evals.intent_synthetic_suite`
- App API chat command targeted Vitest lane：pass
  - `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts`
  - `test/chat-command.service.test.ts`
  - `test/chat-command.service.core.suite.ts`
- `uv run --all-packages python -m scripts.eval_gate accept --profile
  campus-services-product-path --json`：pass；artifact
  `.tmp/evals/campus-services-product-path-opening-gate-accept-20260427T235353/campus-services-product-path-opening-gate.json`
- `pnpm docs:lint`：pass
- `git diff --check`：pass
- `pnpm web:lint`：仍因当前 worktree 中非本 slice 文件的既有 Biome
  diagnostics 失败；本 slice touched TS/JSON targeted Biome check 已 pass

## Latest Verification (2026-04-28)

- `go test ./internal/structuredquery -run 'TestLookupServiceStatus'`：pass
- `go test ./internal/structuredquery -count=1`：pass
- `go test ./internal/httpapi -run 'TestBuildStructuredSupervisorObservabilitySummarizesServiceStatus|TestFinalizeAgentBridgeResponseBuildsSupervisorEnvelope'`：pass
- `go test ./internal/structuredquery ./internal/structuredplanning`
  `./internal/runtimepolicy ./internal/httpapi`
  `-run 'ServiceGuide|ContactDirectory|TransportSchedule|ServiceStatus|`
  `StructuredPlan|AllowedTools|StructuredAnswerText|Readyz' -count=1`：pass
- `uv run --all-packages python -m unittest`
  `tests.agent.test_campus_services_agent tests.evals.intent_synthetic_suite`：
  pass
- `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts`
  `test/chat-command.service.test.ts test/chat-command.service.core.suite.ts`：pass
- `uv run --all-packages python -m scripts.eval_gate accept --profile
  campus-services-product-path --json`：pass；artifact
  `.tmp/evals/campus-services-product-path-opening-gate-accept-20260428T013617/campus-services-product-path-opening-gate.json`
  - gate `passed=true`
  - `service_status_lookup` / `transport_schedule_lookup` /
    `service_guide_lookup` / `contact_directory_lookup` verdicts all remain
    `open`
- `pnpm exec biome check apps/app-api/src/modules/runtime-command/service/normalize.ts`
  `apps/app-api/test/chat-command.service.core.structured.suite.ts`：pass
- `uv run --all-packages ruff check`
  `packages/campus-services-agent/src/campus_services_agent/tool_adapter.py`
  `packages/evals/src/campus_evals/intent_scenarios.py`
  `tests/agent/test_campus_services_agent.py`：pass
- `pnpm exec markdownlint-cli2` targeted to this workstream and transport
  schedule contract：pass
- `pnpm docs:lint`：blocked by unrelated dirty ingestion docs line-length
  diagnostics:
  - `apps/ingestion-worker/README.md:67`
  - `docs/runbooks/ingestion-worker-on-demand-batch-runbook.md:130`
  - `docs/runbooks/ingestion-worker-on-demand-batch-runbook.md:151`
  - `docs/runbooks/ingestion-worker-on-demand-batch-runbook.md:254`
- `pnpm web:lint`：blocked by unrelated dirty WeChat/docs/app-api formatting and
  lint diagnostics outside this Phase 2 slice; touched TS files pass targeted Biome
- `git diff --check`：pass

## Latest Verification (2026-04-28 Phase 3)

- `go test ./internal/structuredquery ./internal/structuredplanning`
  `./internal/runtimepolicy ./internal/httpapi`
  `-run 'ServiceGuide|StructuredPlan|AllowedTools|StructuredAnswerText|Readyz'`
  `-count=1`：pass
- `uv run --all-packages python -m unittest`
  `tests.contracts.contract_models_runtime_and_tools_suite`
  `tests.agent.test_campus_services_agent`
  `tests.ingestion.test_service_guide_projection`
  `tests.ingestion.test_build_service_guide_projection_worker`
  `tests.evals.service_guide_projection_eval_suite`
  `tests.evals.service_guide_lookup_release_gate_suite`：pass
- `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts`
  `test/chat-command.service.test.ts`：pass
- `uv run --all-packages python -m scripts.eval_gate accept --profile`
  `service-guide-lookup --json`：pass；artifact
  `.tmp/evals/service-guide-lookup-release-gate-accept-20260428T021533/`
- `uv run --all-packages python -m scripts.eval_gate accept --profile`
  `campus-services-product-path --json`：pass；artifact
  `.tmp/evals/campus-services-product-path-opening-gate-accept-20260428T021617/`
  - gate `passed=true`
  - `service_status_lookup` / `transport_schedule_lookup` /
    `service_guide_lookup` / `contact_directory_lookup` verdicts all remain
    `open`
- `uv run --all-packages ruff check` targeted to touched Python files：pass
- `pnpm exec biome check` targeted to touched app-api TS/test files：pass
- `pnpm exec markdownlint-cli2` targeted to service guide docs and workstream docs：pass
- `git diff --check`：pass

## Latest Verification (2026-04-28 Phase 4)

- `go test ./internal/structuredquery ./internal/structuredplanning`
  `./internal/runtimepolicy ./internal/httpapi`
  `-run 'ContactDirectory|StructuredPlan|AllowedTools|StructuredAnswerText|Readyz'`
  `-count=1`：pass
- `uv run --all-packages python -m unittest`
  `tests.agent.test_campus_services_agent`
  `tests.evals.contact_directory_lookup_release_gate_suite`
  `tests.evals.contact_directory_lookup_eval_gate_profile_suite`：pass
- `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts`
  `test/chat-command.service.test.ts`：pass
- `uv run --all-packages python -m scripts.eval_gate accept --profile`
  `contact-directory-lookup --json`：pass；artifact
  `.tmp/evals/contact-directory-lookup-release-gate-accept-20260428T025551/`
  - gate `passed=true`
  - checks `5/5` passed, including
    `app_api_contact_directory_structured_answer_tests`
- `uv run --all-packages python -m scripts.eval_gate accept --profile`
  `campus-services-product-path --json`：pass；artifact
  `.tmp/evals/campus-services-product-path-opening-gate-accept-20260428T025551/`
  - gate `passed=true`
  - checks `8/8` passed
  - `service_status_lookup` / `transport_schedule_lookup` /
    `service_guide_lookup` / `contact_directory_lookup` verdicts all remain
    `open`

## Latest Verification (2026-04-28 Phase 5)

- `uv run --all-packages python -m unittest`
  `tests.evals.campus_services_product_path_opening_gate_suite`：pass
- `uv run --all-packages python -m scripts.eval_gate accept --profile`
  `campus-services-product-path --json`：pass；artifact
  `.tmp/evals/campus-services-product-path-opening-gate-accept-20260428T034731/`
  - schema `campus_services_product_path_opening_gate.v2`
  - gate `passed=true`
  - checks `8/8` passed
  - opened tools：`service_status_lookup`、`transport_schedule_lookup`、
    `service_guide_lookup`、`contact_directory_lookup`
  - closed tools：`service_process_lookup`
