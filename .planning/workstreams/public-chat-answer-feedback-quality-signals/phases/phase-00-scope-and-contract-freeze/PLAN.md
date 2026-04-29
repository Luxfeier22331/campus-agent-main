---
doc_type: phase_plan
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Plan: Scope And Contract Freeze

Status: completed on 2026-04-29. Frozen decisions are recorded in `SUMMARY.md`,
`../../REQUIREMENTS.md`, `../../ROADMAP.md`, and `../../STATE.md`.

## Goal

冻结 answer feedback 的语义、route、schema denominator、metric 口径与文档更新范围，避免后续实现又退回 donor vote。

## Inputs

- `.planning/workstreams/public-chat-answer-feedback-quality-signals/REQUIREMENTS.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/contracts/app-api-http.md`
- `docs/data/app-api-schema.md`
- `apps/app-api/src/app/route-exposure.ts`

## Tasks

1. 确认 feedback target 只允许 assistant message。
2. 冻结 route shape，默认候选为
   `PUT /api/chat/conversations/:conversationId/messages/:messageId/feedback`。
3. 冻结 request body：
   - `vote: helpful | unhelpful`
   - `reasonCodes?: string[]`
   - `comment?: string`
4. 冻结 idempotency：同一 owner principal + assistant message upsert latest feedback。
5. 冻结 delete/change 语义：第一版允许 `PUT` 覆盖；是否开放 explicit delete 在本 phase 决定。
6. 冻结 reason code enum 与 comment length。
7. 明确 feedback 不参与 authorization、routing、memory、serving surface 或 online answer policy。
8. 列出必须同步更新的 docs、tests 与 route exposure entry。

## Exit Criteria

- ROADMAP / REQUIREMENTS 如需调整已经同步。
- route、body、enum、idempotency、metric denominator 有单一结论。
- 明确哪些内容不进入第一版，避免实现阶段扩大范围。

## Verification

- planning-only phase；验证方式是文档 diff review 与 `pnpm docs:lint`。
