---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# Dining 内容运营接口

Dining 接口只操作服务端固定的数据存储和领域命令，不接受数据库连接、任意 SQL、来源系统
凭据或发布目标。

- overview、source-runs 和 observations 提供来源、草稿、发布和评价摘要；带 `limit` 的读取只
  接受 1 至 200 的整数。
- draft 和 validation 分别返回当前草稿及其完整校验结果。
- rebase 从当前有效来源观测重建草稿，并重放仍有效的人工修正。
- catalog commands 只允许重命名档口、设置参考价格、分配档口和移除分配。
- publish 要求非空操作说明和通过校验的当前草稿，并创建不可变 release。
- rollback 要求非空操作说明，验证目标 release 与当前地图兼容，并创建新的 release。
- review commands 只允许隐藏、恢复、重新绑定或请求复检。

命令违反 revision、领域完整性、地图兼容或评价公开条件时返回
`409 OPS_DINING_CONFLICT`，不能部分写入或改写为成功。精确命令联合类型和响应结构由
`apps/ops-web/src/shared/dining-contract.ts` 与服务端 Zod schema 维护。

通用鉴权、错误和禁止行为见 [README.md](./README.md)。领域和数据语义见
`../../architecture/domains/dining.md` 与 `../../data/dining.md`。
