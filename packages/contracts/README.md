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
- `schemas/grounding-context.v2.schema.json`：模型调用前形成的本轮可选文档依据合同；
- `schemas/personal-memory-tool-contracts.v1.schema.json`：个人记忆召回的有界 payload/result；
- `schemas/knowledge-serving-release.v1.schema.json`：知识发布与运行准入共享的不可变 release 身份；
- `src/campus-groups.ts`：同好群有序分组、条目与公开目录的 Zod 运行时合同，供 app-api、
  ops-web 和 campus-web 共同消费；公开目录 JSON Schema 生成到
  `schemas/campus-groups-catalog.v1.schema.json`；
- `schemas/contract-schema-registry.v1.json`：runtime catalog 与 contract check 使用的 schema
  registry；
- `schemas/runtime-*.schema.json`：运行时工具注册表、function schema、
  execution config、query-serving document scope、延迟预算与环境策略。

runtime catalog 的 `payload_schema_ref` 与 `result_schema_ref` 必须解析到已注册 JSON Schema。
schema 存在不代表工具对模型可见；实际 exposure 由 runtime registry 控制。

## 生成产物

`pnpm contracts:generate` 生成 app-api TypeScript、execution-control Go wire consumer 和同好群
公开目录 JSON Schema。生成 type 是本地 parser，生成的 JSON Schema 是跨运行时交换产物，
都不是第二份事实来源，不得手工修改。

## 验证

执行：

```bash
pnpm contracts:generate
pnpm contracts:check
pnpm ci:contracts
```

`packages/contracts/fixtures` 包含跨语言 valid/invalid fixture，其行为必须与正式 JSON
Schema/OpenAPI 一致。
