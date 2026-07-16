# campus-contracts

`packages/contracts` 拥有 campus-agent 稳定的跨 runtime schema。

负责：

- app-api/execution-control run 与 finalization OpenAPI 合同；
- runtime-neutral tool payload/result schema；
- runtime registry 与 configuration artifact schema；
- 共享 fixture 与生成的 TypeScript/Go consumer。

不负责 runtime framework type、provider client、Temporal workflow 实现、retrieval backend
细节、object-store record 或 browser transport wrapper。

## 正式 Schema

- `docs/contracts/schemas/tool-execution.openapi.yaml`：run create/read、event、step、cancel 与
  finalization wire；
- `schemas/knowledge-tool-contracts.v2.schema.json`：内部 `knowledge_search` payload/result；
  `knowledge_query` 是模型可见 SDK handoff，不是 Go RAG graph；
- `schemas/campus-services-tool-contracts.v1.schema.json` 与
  `schemas/campus-services-tool-result.v1.schema.json`：已准入 campus service tool；当前唯一
  模型可见 service tool 是 `transport_schedule_lookup`；
- `schemas/contract-schema-registry.v1.json`：runtime catalog 与 contract check 使用的 schema
  registry；
- `schemas/runtime-*.schema.json`：运行时工具注册表、function schema、workflow artifact、
  execution config、query-serving target、延迟预算与环境策略。

runtime catalog 的 `payload_schema_ref` 与 `result_schema_ref` 必须解析到已注册 JSON Schema。
schema 存在不代表工具对模型可见；实际 exposure 由 runtime registry 控制。

## 生成产物

`pnpm contracts:generate` 生成 app-api TypeScript 与 execution-control Go wire consumer。生成
type 是本地 parser，不是第二份事实来源。

## 验证

执行：

```bash
pnpm contracts:generate
pnpm contracts:check
pnpm ci:contracts
```

`packages/contracts/fixtures` 包含跨语言 valid/invalid fixture，其行为必须与正式 JSON
Schema/OpenAPI 一致。
