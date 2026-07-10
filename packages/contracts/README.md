# campus-contracts

`packages/contracts` 定义 `campus-agent` 的共享 schema 边界。

它负责：

- Execution Agent Layer-facing request DTOs
- Execution Agent Layer tool handoff DTO `ToolRequest` / `ToolResponse`
- retrieval-oriented `EvidenceBundle`
- navigation / typed tool handoff 所需的共享 payload / result 分支
- trace、actor、error、scope 等共享 dataclass 与枚举

它不负责：

- runtime / framework / transport 类型
- retrieval backend、Qdrant、MinIO、registry 或其他基础设施类型
- tool / explicit agent-as-tool 内部实现细节
- historical bridge wrappers、`runtime_decisions` 或 app-api / execution-control execution
  transport wrapper

当前它已经不是 rag-only contract 面；共享 handoff 现在覆盖 `knowledge_query`、
`place_lookup` 与已 admission 的 tool read model target。`ToolRequest` /
`ToolResponse` 是 Execution Agent Layer -> tool handoff DTO；`tool_response`
是现有 wire 字段名，不是 active product routing 概念。

## Machine-Readable Schemas

- `packages/contracts/schemas/contract-schema-registry.v1.json` 是当前
  machine-readable schema registry。新增 OpenAPI / JSON Schema contract 或
  runtime JSON artifact schema 必须先登记，再进入 `pnpm contracts:check`
- `packages/contracts/schemas/tool-handoff.v1.schema.json` 是
  package-owned tool handoff JSON Schema，覆盖 `ToolRequest` / `ToolResponse`
- `packages/contracts/schemas/campus-services-tool-result.v1.schema.json` 是
  `campus_services` typed tool result envelope 的 canonical JSON Schema；Python /
  Go / TS 侧模型只能作为 consumer helper 或 runtime projection，不替代该 schema
- `packages/contracts/schemas/campus-services-tool-contracts.v1.schema.json`
  是 `campus_services` typed tool payload / result packet 的 canonical JSON
  Schema；当前只覆盖已开放的 `transport_schedule_lookup`。未开放的 guide、
  contact directory、academic calendar 或 generic service status 不在这个
  active schema 里预注册；它们只有重新完成 owner、source truth 与 opening gate
  设计后才可以加入
- `packages/contracts/schemas/knowledge-tool-contracts.v1.schema.json` 是
  `knowledge_query` workflow signal 的 canonical JSON Schema；`knowledge_query`
  只表示进入 Go-owned Temporal RAG graph，不把内部 retrieval 注册或暴露成独立 tool
- `packages/contracts/schemas/notice-tool-contracts.v1.schema.json` 是 `notice`
  typed tool payload / result packet 的 canonical JSON Schema；它冻结 notice
  discovery、period summary、selected notice get 与 change-set lookup 的边界 shape、
  fail-close 语义与 public display policy guardrail
- `docs/contracts/schemas/tool-execution.openapi.yaml` 是 app-api /
  execution-control execution wire 的 canonical OpenAPI schema；它同时覆盖
  durable run create / read / events / steps / cancel 与 private tool execution
  wire shape
- `packages/contracts/schemas/runtime-*.schema.json` 覆盖当前 execution
  runtime 实际读取的 tool registry、tool function schemas、runtime config
  与 workflow artifact registry JSON artifact
- `packages/contracts/schemas/runtime-tools.v4.schema.json`、
  `execution-control-runtime-config.v1.schema.json`、
  `query-serving-scopes.v2.schema.json`、`intent-policy.v1.schema.json`、
  `intent-drift-thresholds.v1.schema.json`、`provider-pricing.v1.schema.json`、
  `runtime-latency-budgets.v1.schema.json` 与 `env-surface-policy.v1.schema.json`
  覆盖当前 execution runtime、ops summary、learning-loop 与 repo static checks
  实际读取的 non-code JSON artifacts
- cross-language generated artifacts 由 `pnpm contracts:generate` 生成，并由
  `pnpm contracts:check` 和 `tool-runtime-contract` gate 防漂移

新增共享字段时，先判断它属于稳定 tool handoff、execution wrapper 还是
runtime JSON artifact。工具 payload/result 的跨语言边界先落到
`*-tool-contracts.v1.schema.json`；runtime tool catalog 的
`payload_schema_ref` / `result_schema_ref` 只能指向已登记 JSON Schema `$id`
下的 `$defs`。最终化消费的 `campus_services` envelope 继续由
`campus-services-tool-result.v1.schema.json` 约束。跨语言 canonical contract
使用 JSON Schema / OpenAPI；Zod、Python dataclass 与 Go struct 只承担本地边界
解析、helper model 或生成物职责，不能作为 runtime catalog 的 active schema
truth。
契约漂移检查统一走 `pnpm contracts:check`。

## Test Ownership

`packages/contracts` 的 contract truth 由 JSON Schema / OpenAPI registry、
`pnpm --filter campus-contracts test` 和 `pnpm contracts:check` 证明。
Python `campus_contracts.*` dataclass 只作为语言本地 adapter/helper；对应
`tests/` 目录只保留 `test_python_adapter.py` 烟测，不再维护 Python 聚合 suite
或 `load_tests` discovery。
