# ingest-core

采集运行时共享的 TypeScript 基础能力。

## 职责

- 对象引用、URI、摘要和规范 JSON/JSONL 写入；
- 与运行时无关的对象存储接口；
- 集合配置和内核输出解析；
- 来源对象键与内容版本的确定性构造；
- Rust 任务注册表查询和执行器清单校验。

本 package 不连接工作流、数据库、向量存储或具体供应商，也不加载部署环境。
可部署代码留在 `apps/*` 和 `jobs/*`；跨语言字段定义留在 `packages/ingestion-contracts`。

## 验证

```bash
pnpm --filter ingest-core typecheck
pnpm --filter ingest-core test
```

## 相关文档

- `docs/architecture/system/data-plane.md`
- `packages/ingestion-contracts/README.md`
