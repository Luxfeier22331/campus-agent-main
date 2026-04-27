---
doc_type: state
status: active
created: 2026-04-27
updated: 2026-04-28
---

# State: Campus Services Runtime Tool Gap Closeout

## Current Status

- status: `active`
- current phase: `Phase 1`
- current slice: `service_status_lookup` source trace / observability summary follow-up
- owner: current Codex session
- active implementation: yes

## Phase 6 Handoff (2026-04-27)

来自 `public-chat-campus-services-e2e-acceptance` Phase 6 的回写项：

- `service_status_lookup` / `transport_schedule_lookup` / `service_guide_lookup` /
  `contact_directory_lookup` 已通过 local deterministic opening gate，后续只在本 backlog 继续收口
  staging evidence 与长尾 denominator 扩展。
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
- 长期线路、临时线路、临时站点调整、schedule exception precedence 继续做 regression
- date/time 语义继续收口：节假日、周末、寒暑假、下一班、projection window 边界
- OCR/table extraction 噪音仍按 data-plane 问题处理；runtime 维持 fail-close

### `service_guide_lookup`

- service guide catalog / alias 覆盖继续扩展
- materials/entry/office_hours/audience/contact refs 等 section normalization 继续增强
- 高频 guide 场景的澄清与 fail-close 文案持续做 denominator 扩展

### `contact_directory_lookup`

- alias 覆盖继续扩展：学院办公室、招生咨询、国际交流科等自然说法
- ambiguous alias clarification 稳定性继续压测
- conflict / non-ready / restricted source 命中持续保持 fail-close

### `service_process_lookup` (keep closed)

- 当前仍是 later-wave；未进入 `campus-services-product-path` opening gate
- 若后续要开放，必须新增独立 deterministic denominator 与 product-path E2E 验收

## Continuity Notes

- 不得通过 generic RAG 或 notice text search 顶替 structured tools。
- 不得让 runtime 在 query time 回扫 raw notice / handbook / portal HTML。
- 恢复时先补 deterministic tool denominator，再接 public/chat E2E。

## Latest Verification (2026-04-27)

- `go test ./internal/structuredplanning ./internal/runtimepolicy`：pass
- `go test ./internal/structuredquery ./internal/structuredplanning ./internal/runtimepolicy ./internal/httpapi -run 'ServiceGuide|ContactDirectory|TransportSchedule|ServiceStatus|StructuredPlan|AllowedTools|StructuredAnswerText|Readyz'`：pass
- `uv run --all-packages python -m unittest tests.agent.test_campus_services_agent tests.evals.intent_synthetic_suite`：pass
- `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/chat-command.service.test.ts test/chat-command.service.core.suite.ts`：pass
- `uv run --all-packages python -m scripts.eval_gate accept --profile campus-services-product-path --json`：pass；artifact
  `.tmp/evals/campus-services-product-path-opening-gate-accept-20260427T235353/campus-services-product-path-opening-gate.json`
- `pnpm docs:lint`：pass
- `git diff --check`：pass
- `pnpm web:lint`：仍因当前 worktree 中非本 slice 文件的既有 Biome diagnostics 失败；本 slice touched TS/JSON targeted Biome check 已 pass

## Latest Verification (2026-04-28)

- `go test ./internal/structuredquery -run 'TestLookupServiceStatus'`：pass
- `go test ./internal/httpapi -run 'TestBuildStructuredSupervisorObservabilitySummarizesServiceStatus|TestFinalizeAgentBridgeResponseBuildsSupervisorEnvelope'`：pass
- `uv run --all-packages python -m scripts.eval_gate accept --profile campus-services-product-path --json`：pass；artifact
  `.tmp/evals/campus-services-product-path-opening-gate-accept-20260428T003002/campus-services-product-path-opening-gate.json`
  - gate `passed=true`
  - `service_status_lookup` / `transport_schedule_lookup` / `service_guide_lookup` /
    `contact_directory_lookup` verdicts all remain `open`
- `pnpm docs:lint`：pass
- `git diff --check`：pass
