# ingestion-kernels-rs

采集数据面的确定性 Rust 文件处理内核。

## 职责

当前 runner 提供规范文档单元校验、按 tokenizer 预算分块和 release manifest 校验。内核从
stdin 或明确文件读取已经物化的内容，通过 stdout 返回确定性结果。

内核不连接网络、PostgreSQL、Qdrant 或对象存储，也不承担 Temporal 编排和来源业务逻辑。
`apps/ingestion-control` 负责对象存储桥接和 activity 生命周期，字段定义来自
`packages/ingestion-contracts`。

分块使用本地 `tokenizer.json`；runner 不下载模型或 tokenizer。可用命令和参数以 CLI
`--help` 及测试为准。

## 验证

```bash
cargo test -p ingestion-kernels-rs
cargo clippy -p ingestion-kernels-rs --all-targets --all-features -- -D warnings
```

## 相关文档

- `docs/architecture/system/data-plane.md`
- `packages/ingestion-contracts/README.md`
