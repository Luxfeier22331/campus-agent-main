# ingestion-kernels-rs

采集数据面的确定性高性能 kernel。

本 package 是 CPU 密集、确定性采集任务的 Rust 执行层，不是可独立部署的服务，也不负责
runtime orchestration。

当前 kernel：

- `validate-document-units`：校验 canonical document-unit JSONL；
- `chunk-document-units`：按 token budget 将 canonical document-unit JSONL 切分为 chunk；
- `validate-release-manifest`：校验 release manifest 结构、digest 与重复 artifact 一致性。

CLI runner：

```bash
cargo run -p ingestion-kernels-rs --bin ingestion-kernel-runner -- \
  validate-document-units < document-units.jsonl
cargo run -p ingestion-kernels-rs --bin ingestion-kernel-runner -- \
  chunk-document-units \
  --tokenizer-json /models/qwen3/tokenizer.json \
  --chunk-size 384 \
  --max-tokens 512 \
  --min-tokens 96 \
  --overlap 64 < document-units.jsonl
cargo run -p ingestion-kernels-rs --bin ingestion-kernel-runner -- \
  validate-release-manifest < release-manifest.json
```

## 实现规则

- JSON / JSONL 使用 `jsonschema` 校验，不手写字段检查；
- canonical document unit 使用 `packages/ingestion-contracts` 的
  `canonical_document_units.v1`：输入标识是 `doc_id` + `chunk_id`，chunk 输出使用 `doc_id`，
  不使用旧 `document_id`；
- release manifest 使用共享 `ingestion_release_manifest.v2` schema；Rust 只增加确定性 digest
  与重复 artifact 一致性检查；
- chunk budget 通过 `tokenizers` / `text-splitter` 使用本地 Hugging Face `tokenizer.json`；
  kernel 不得下载 tokenizer asset；
- `--max-chars` 已退役，不得用于 chunk budget；
- runtime collection profile 留在 TypeScript 解析，Rust kernel 只接收已解析的 CLI 参数。

## 边界

- 不连接 Postgres；
- 不连接 Qdrant；
- 不包含 object-store client；
- 不调用 provider；
- 不包含 source-channel 业务语义。

kernel 接收已经物化的文件内容，通过 stdout 返回确定性报告。`apps/ingestion-control` 负责
object-store bridge、task closeout 和 fail-closed runtime dispatch。
