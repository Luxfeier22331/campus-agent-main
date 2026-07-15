# campus-contracts

`packages/contracts` owns stable cross-runtime schemas for campus-agent.

It owns:

- the app-api/execution-control run and finalization OpenAPI contract;
- runtime-neutral tool payload/result schemas;
- runtime registry and configuration artifact schemas;
- shared fixtures and generated TypeScript/Go consumers.

It does not own runtime framework types, provider clients, Temporal workflow
implementation, retrieval backend details, object-store records or browser
transport wrappers.

## Canonical Schemas

- `docs/contracts/schemas/tool-execution.openapi.yaml` defines run create,
  read, event, step, cancel and finalization wire shapes.
- `schemas/knowledge-tool-contracts.v2.schema.json` defines the internal
  `knowledge_search` payload/result contract. `knowledge_query` is the
  model-visible OpenAI Agents SDK handoff target, not a Go RAG graph.
- `schemas/campus-services-tool-contracts.v1.schema.json` and
  `schemas/campus-services-tool-result.v1.schema.json` define the currently
  admitted campus service tool seam. The only model-visible service tool is
  `transport_schedule_lookup`.
- `schemas/contract-schema-registry.v1.json` registers machine-readable
  schemas consumed by runtime catalogs and contract checks.
- `schemas/runtime-*.schema.json` covers runtime tool registries, function
  schemas, workflow artifacts, execution configuration, query-serving targets,
  latency budgets and environment policy.

Runtime catalog `payload_schema_ref` and `result_schema_ref` values must
resolve to registered JSON Schema definitions. Schema existence does not make a
tool model-visible; runtime exposure is controlled by the runtime registries.

## Generated Consumers

`pnpm contracts:generate` generates the app-api TypeScript and
execution-control Go wire consumers. Generated types are local parsers, not a
second source of truth.

## Verification

Use:

```bash
pnpm contracts:generate
pnpm contracts:check
pnpm ci:contracts
```

`packages/contracts/fixtures` contains cross-language valid and invalid
fixtures. Keep fixture behavior aligned with the canonical JSON Schema/OpenAPI
sources.
