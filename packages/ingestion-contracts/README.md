# ingestion-contracts

采集任务与正式 document unit 的共享 JSON Schema，以及采集所有者使用的 TypeScript/Ajv
validator。

本 package 是 TypeScript 控制面与 Rust kernel 调度所用跨 runtime ingestion task 结构的事实
来源。runtime package 必须通过 TypeScript Ajv validator 或正式 JSON Schema 校验 task
envelope、task registry 和 canonical document unit，不得复制 DTO 规则。

本 package 不是 ingestion runtime core，不得导入 Temporal、Crawlee、object-store client、
database client 或 provider transport。`apps/*` 和 `jobs/*` 中的 runtime code 可以消费这些
合同；可复用 ingest helper 必须保持 runtime-neutral。

当前合同：

- `CanonicalDocumentUnit`
- `IngestionReleaseManifest`
- `IngestionTaskEnvelope`
- `IngestionTaskRegistry`
- `IngestionTaskResult`

当前 task 合同为 `ingestion_task_envelope.v3`、`ingestion_task_registry.v3` 和
`ingestion_task_result.v1`。task envelope 只包含 task/run 标识、registry task id 和由 digest
固定的 object-store input ref。source/target identity、executor kind 与 input/output contract
由 ingestion-control 从 registry 冻结。activity 返回一个 result-manifest ref 和有界 summary。

当前 release manifest 为 `ingestion_release_manifest.v2`。task envelope、task result 与
release manifest 中的每个 artifact ref 都必须同时包含 `sha256:` digest 和 `byte_size`；只有
URI 或只有 digest 的 ref 无效。

canonical document unit 使用面向 reader 的 `doc_id`、`version_id`、`chunk_id`、
`root_unit_id`、`text`、`clean_text`、`metadata` 与 `anchor`。`canonical_document_units.v1`
不接受旧 `document_id` / `unit_id` 输入。

`assertions/` 中的 JSON 由 TypeScript contract test 消费；`schemas/` 中的文件是本 package
唯一拥有的 schema 副本。
