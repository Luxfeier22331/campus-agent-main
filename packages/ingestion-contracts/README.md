# ingestion-contracts

采集来源对象和同步边界的共享 JSON Schema 与 TypeScript 校验器。

## 职责

- 在 `schemas/` 维护采集来源与同步边界的跨运行时结构；
- 为 TypeScript 调用方提供 Ajv 校验器和类型；
- 以 `assertions/` 验证有效与无效样例；
- 约束对象引用摘要、字节数和内部门户来源对象。

具体字段和版本只由 schema、导出类型与合同测试维护，README 不复制字段清单。本 package 不导入
Temporal、数据库、对象存储客户端或供应商实现。

## 验证

```bash
pnpm --filter ingestion-contracts typecheck
pnpm --filter ingestion-contracts test
pnpm --dir packages/contracts check
```

## 相关文档

- `docs/architecture/system/data-plane.md`
