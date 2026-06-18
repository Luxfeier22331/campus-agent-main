---
doc_type: index
truth_scope: repository
owner_boundary: docs/contracts
status: active
created: 2026-04-12
updated: 2026-06-13
---
# Contracts

`contracts/` 保存稳定的 HTTP 与 runtime seam。 它回答“边界上的输入输出长什么样”“状态如何流转”“哪些字段不能从下游倒推”。

## App API 核心 contract

- `app-api-http.md`
  - `app-api-http/system-auth-profile-memory.md`
  - `app-api-http/chat.md`
  - `app-api-http/operator.md`
- `app-api-chat-conversation-http.md`
- `campus-web-chatkit-adapter.md`
- `app-api-eval-benchmark-http.md`
- `app-api-document-reader-http.md`
- `document-reader-publish-contract.md`
- `app-api-error-model.md`
- `app-api-request-lifecycle.md`
- `capability-execution.md`
- `app-api-identity-platform-http.md`
- `app-api-federation-http.md`
- `app-api-operator-ops-http.md`
- `app-api-dining-http.md`
- `app-api-dining-ops-http.md`
- `structured-query-internal-runtime.md`
- `durable-agent-runtime-contract.md`
- `operator-runtime-observability-contract.md`
- `langfuse-runtime-observability-contract.md`

## Operator / Official Web contract

- `app-api-campus-services-ops-http.md`
- `app-api-authenticated-notice-processing-http.md`
- `app-api-operator-observability-http.md`
  - `app-api-operator-observability-http/eval-and-overview.md`
  - `app-api-operator-observability-http/requests-and-quality.md`
  - `app-api-operator-observability-http/request-detail.md`
  - `app-api-operator-observability-http/quality.md`
  - `app-api-operator-observability-http/governance-safety-cost-audit.md`
  - `app-api-operator-observability-http/internal-ingest.md`
- `app-api-official-web-http.md`
  - `app-api-official-web-http/collector-command-endpoints.md`
  - `app-api-official-web-http/operator-query-endpoints.md`
  - `app-api-official-web-http/internal-projection-ingest.md`
- `app-api-official-web-run-lifecycle.md`

## Navigation contract

- `navigation-place-finding-contract.md`

## Campus services contract

- `service-status-lookup-contract.md`
- `service-guide-lookup-contract.md`
- `transport-schedule-lookup-contract.md`
  - `transport-schedule-lookup-contract/examples.md`
- `contact-directory-lookup-contract.md`

## Notice runtime contract

- `campus-notice-runtime-contract.md`

## Retrieval internal contract

- `knowledge-retrieval-plan-contract.md`

## 使用规则

- contract 只写稳定 seam，不写执行历史
- request/response shape 的 current truth 以这里为准，不以 panel UI 或 sink payload 为准
- contract 可以说明“当前已冻结的接口子集”或“当前已落地的字段语义”，但不承担 `.planning` 中的 active lane /
  pending work / closeout 状态说明
- 当 supporting architecture 已冻结 forward design，但 current wire shape
  尚未切换时，contract 必须显式区分 `current truth` 与 `forward evolution`，不得把 future routing
  shape 写成现状
