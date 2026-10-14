# campus-contracts

`packages/contracts` 拥有 campus-agent 稳定的跨 runtime schema。

负责：

- app-api/agent-control run 与 finalization OpenAPI 合同；
- runtime-neutral tool payload/result schema；
- runtime registry 与 configuration artifact schema；
- 共享 fixture 与生成的 TypeScript/Go consumer。

不负责 runtime framework type、provider client、Temporal workflow 实现、retrieval backend
细节、object-store record 或 browser transport wrapper。

## 正式 Schema

- `docs/contracts/schemas/tool-execution.openapi.yaml`：run create/read、event、step、cancel 与
  finalization wire；
- `schemas/agent-runtime-control.v1.schema.json`：Runtime-Control 输入、结果、投影、调用 receipt、
  finalization 与 Activity 元数据；生成 Go wire 和 `campus-contracts/agent-runtime-control` TypeScript 类型，
  两种语言使用同一 fixture 验证；
- `schemas/personal-memory-tool-contracts.v1.schema.json`：个人记忆召回的有界 payload/result；
- `src/product-availability.ts`：App API 问答可用性响应与状态页固定双服务快照的 Zod 运行时合同；
  快照 JSON Schema 生成到 `schemas/product-availability-snapshot.v1.schema.json`；
- `src/campus-groups.ts`：同好群有序分组、条目与公开目录的 Zod 运行时合同，供 app-api、
  ops-web 和 campus-web 共同消费；公开目录 JSON Schema 生成到
  `schemas/campus-groups-catalog.v1.schema.json`；
- `src/internal-portal-credential.ts`：Ops Web 与 internal-portal-collection 共享的内部门户凭据解析响应
  合同；
- `src/campus-docs/`：Campus Docs 来源清单、reader、课程图、表格布局、提取质量和分段规则的唯一
  共享实现。`campus-contracts/campus-docs` 只暴露 browser-safe 类型与 reader/质量核心；
  `campus-contracts/campus-docs/node` 暴露 Node-only 的 AJV schema parser、来源清单规范化和路由 slug
  能力；
- `schemas/contract-schema-registry.v1.json`：runtime catalog 与 contract check 使用的 schema
  registry；
- `schemas/runtime-*.schema.json`：运行时工具注册表、function schema、execution config、延迟预算与
  环境策略。

runtime catalog 的 `payload_schema_ref` 与 `result_schema_ref` 必须解析到已注册 JSON Schema。
schema 存在不代表工具对模型可见；实际 exposure 由 runtime registry 控制。

Campus Docs 的 object-store digest、canonical JSON、对象键和 immutable writer 仍由实际 producer
（Campus Web 来源/构建流程或 `campus-docs-index-publisher`）分别拥有；contracts 不提供通用 artifact
工具，也不依赖 Campus Web 私有源码。

`campus-contracts/campus-docs/fixture` 仅供 Campus Docs contract、Campus Web 和 index publisher 的测试
共享确定性输入，不是生产对象存储接口。

## 生成产物

`pnpm --dir packages/contracts generate` 生成 app-api TypeScript、agent-control Go wire consumer 和同好群
公开目录 JSON Schema。生成 type 是本地 parser，生成的 JSON Schema 是跨运行时交换产物，
都不是第二份事实来源，不得手工修改。

## 验证

执行：

```bash
pnpm --dir packages/contracts generate
pnpm --dir packages/contracts contracts:check
pnpm test --filter=campus-contracts
```

`packages/contracts/fixtures` 包含跨语言 valid/invalid fixture，其行为必须与正式 JSON
Schema/OpenAPI 一致。
