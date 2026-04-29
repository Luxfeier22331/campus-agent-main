---
doc_type: roadmap
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Roadmap: Public Chat Answer Feedback And Quality Signals

当前 Phase 5 已完成 acceptance / docs / rollout closeout；这条 workstream 已收口。

## Phase 0: Scope And Contract Freeze

**Status:** completed on 2026-04-29.

**Goal:** 冻结 answer feedback 的产品语义、route contract、schema denominator 与
operator metric 口径。

**Scope:**

- 确认 feedback 是 answer quality signal，不是 donor vote / ranking。
- 冻结 route candidate 与 request/response shape。
- 冻结 vote enum、reason code enum、comment length、idempotency 与 delete/change 语义。
- 明确 feedback 与 `chat.messages.request_id`、`runtime.request_execution`、
  `operator.request_projection` 的 join 关系。
- 明确 docs / route exposure inventory / schema docs 需要同步更新的文件。

## Phase 1: App API Feedback Truth

**Status:** completed on 2026-04-29.

**Goal:** 在 `apps/app-api` 内建立 durable feedback truth 与 command service。

**Scope:**

- 新增 `chat.message_feedback` 或等价 schema，包含 latest feedback upsert truth。
- Drizzle schema、migration、bootstrap/test lane coverage。
- command service 校验 conversation ownership、assistant role、message/request correlation。
- 幂等 upsert：同一 owner principal + assistant message 只保留 latest feedback。
- `PUT` / `DELETE` feedback route exposure inventory 标记为 `browser-surface` +
  `session principal required`。
- conversation detail 返回当前 owner 的 assistant message feedback state。

## Phase 2: Browser Surface And Public Chat UI

**Status:** completed on 2026-04-29.

**Goal:** public-chat-web 恢复用户可见 answer feedback action，并只调用 app-api surface。

**Scope:**

- typed public-chat-web API helper。
- Worker same-site proxy / forwarding tests。
- message action 中展示 helpful / unhelpful，保留 copy。
- unhelpful reason popover / dialog 的第一版交互；v1 不开放自由文本 comment。
- loading、submitted、error、retry 与 selected-state 展示。
- regressions：不得重新调用 `/api/vote` 或 donor DB helper。

## Phase 3: Quality Read Model And Metrics

**Status:** completed on 2026-04-29.

**Goal:** 把 feedback 投影到 operator quality 读模型与聚合指标。

**Scope:**

- feedback count、helpful rate、unhelpful rate、feedback coverage。
- negative answer rate。
- 按 time window、surface、intent/capability summary、answer kind、source/citation posture
  聚合。
- no-answer + unhelpful overlap、wrong-intent reason 与 route mismatch suspected case。
- operator quality summary / timeseries contract 与 tests。

## Phase 4: Drift Export And Eval Loop

**Status:** completed on 2026-04-29.

**Goal:** 将 negative feedback 变成可复核、可采样、可回归的 case set 输入。

**Scope:**

- negative feedback export / candidate feed。
- badcase sampling metadata：requestId、messageId、reasonCodes、intent summary、
  capability family、answer kind、citation posture。
- eval case drafting workflow，避免 raw transcript / sensitive payload 超范围扩散。
- false positive / false negative / wrong intent 标注字段。

## Phase 5: Acceptance, Docs And Rollout

**Status:** completed on 2026-04-29.

**Goal:** 完成端到端验收、文档更新与 rollout posture。

**Scope:**

- app-api route/service/store tests。
- public-chat-web component / worker tests。
- operator query tests。
- browser smoke：提交一条回答反馈并在 operator quality / export 中可见。
- 更新 `docs/contracts/app-api-http.md`、`docs/data/app-api-schema.md`、
  operator observability docs 如有新增指标口径。
- 明确 rollout / rollback：关闭 UI 不删除 feedback truth；route 继续 fail closed。
