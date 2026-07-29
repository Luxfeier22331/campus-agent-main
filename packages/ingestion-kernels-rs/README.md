# ingestion-kernels-rs

采集数据面的确定性 Rust 文件处理内核。

## 职责

runner 当前提供：

- `validate-document-units`：保留的 v1 文档单元校验；
- `build-retrieval-chunks-v2`：从 `canonical_document_unit.v2` JSONL 生成
  `retrieval_chunk_set.v2`；
- release manifest 校验库能力。

v2 分块器使用本地 `tokenizer.json` 精确计算 token 数，校验 `content_sha256`，按文档和章节身份
确定性排序，并保证 chunk 不跨 section。短尾块只在同一 section 内合并；每个输出项都通过
`retrieval_chunk.v2` schema。

内核从 stdin 或明确文件读取已经物化的内容，通过 stdout 返回确定性结果。它不连接网络、
PostgreSQL、Qdrant 或对象存储，也不承担 Temporal 编排和来源业务逻辑。

`apps/ingestion-control` 负责对象存储桥接、任务预算和 Activity 生命周期；字段定义来自
`packages/ingestion-contracts`。runner 不下载模型或 tokenizer。

## 验证

```bash
cargo test -p ingestion-kernels-rs
cargo clippy -p ingestion-kernels-rs --all-targets --all-features -- -D warnings
```

## 相关文档

- `docs/architecture/system/data-plane.md`
- `docs/policies/student-rules-chunking.md`
- `packages/ingestion-contracts/README.md`
