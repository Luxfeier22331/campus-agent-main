---
doc_type: index
truth_scope: repository
owner_boundary: docs/contracts
status: active
created: 2026-04-12
updated: 2026-07-12
---
# Contracts

`contracts/` 保存稳定的 HTTP 与 runtime seam。 它回答“边界上的输入输出长什么样”“状态如何流转”“哪些字段不能从下游倒推”。
跨 contract 的稳定链路图见 `../architecture/flows.md`；本目录仍只拥有 seam
shape 与字段语义。

## Browser And App API Contracts

- `app-api/README.md`
  - browser-facing app-api HTTP contract families and split-doc routing
- `app-api/campus-services-ops.md`
- `app-api/observability.md`
- `app-api/eval-benchmark.md`
- `document-reader-publish.md`
- `ops-web.md`
  - self-hosted Ops Web HTTP responses, access checks and PostgreSQL read boundary

## Runtime And Diagnostic Contracts

- `tool-execution.md`
- `tool-read-model.md`
- `tool-trajectory.md`
- `durable-runtime.md`
- `operator-runtime.md`
- `langfuse-runtime.md`
- `stage-timing.md`

## Domain Contracts

- `file-release-export.md`

Human transport capability truth lives in `../domains/transport.md`.
Machine-readable transport tool/status schemas live in
`../../packages/contracts/schemas/`.

## Machine-readable schemas

- `schemas/tool-execution.openapi.yaml` 是 app-api -> execution-control
  private wire contract。
- `../packages/contracts/schemas/contract-schema-registry.v1.json` 是当前
  JSON Schema / OpenAPI registry，登记 active schema、runtime JSON artifact、
  language-local helper 与 legacy helper 的边界身份。
- `../packages/contracts/schemas/campus-services-tool-result.v1.schema.json`
  是 `campus_services` function tool result envelope 的 canonical schema。
- `../packages/contracts/schemas/campus-services-tool-contracts.v1.schema.json`
  是 `campus_services` function tool payload / result packet 的 canonical schema。
- `../packages/contracts/schemas/runtime-*.schema.json` 校验 execution runtime
  实际读取的 runtime JSON artifacts。
- `tool-execution.openapi.yaml` 覆盖 app-api -> execution-control durable
  run create / read / events / steps / cancel 与 finalization wire shape。

## 使用规则

- contract 只写稳定 seam，不写执行历史
- request/response shape 的 current truth 以这里为准，不以 panel UI 或 sink payload 为准
- `tool-trajectory.md` 是 tool-use 观测 / eval 的 sanitized trajectory
  contract；Langfuse score payload、Operator Console 展示和本地 eval runner
  都只能消费它或它的更窄投影，不反向定义工具轨迹字段
- 跨语言或跨 runtime 的 contract 默认使用 JSON Schema / OpenAPI 作为 canonical
  source；Python dataclass、Go struct、TS interface / Zod parser 是消费侧 helper、
  runtime parser 或生成物，不单独成为跨语言真相源
- function tool payload / result 的 machine-readable schema 应登记在
  `packages/contracts/schemas/contract-schema-registry.v1.json`，并配套正反
  fixture；不要只把 Python dataclass、Go struct 或 provider function schema 当作
  完整 contract
- 新增或修改 machine-readable contract 后必须运行 `pnpm contracts:check`
- contract 可以说明“当前已冻结的接口子集”或“当前已落地的字段语义”，但不承担 `.planning` 中的 active lane /
  pending work / closeout 状态说明
- 当 supporting architecture 已冻结 forward design，但 current wire shape
  尚未切换时，contract 必须显式区分 `current truth` 与 `forward evolution`，不得把 candidate routing
  shape 写成现状
