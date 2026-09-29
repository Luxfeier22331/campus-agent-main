# Agent Note: 退役旧文档分块栈

Status: implemented

## 背景

仓库曾保留一套独立 Rust 分块 kernel、集合配置，以及
`canonical_document_unit`、`retrieval_chunk` 合同。它们没有运行消费者，也不参与当前 Campus Docs
索引。Campus Docs 已经以当前 reader 为唯一输入，并由所属 Job 生成 Chunk Set、Embedding Set 和
Qdrant collection。继续保留两套分块语义会造成错误的能力认知和重复工具链成本。

## 决策

- 删除 Rust 分块 workspace、根 Cargo 工具链和对应手动验证 profile；
- 删除 collection profile loader 和无消费者的 canonical/retrieval schema；
- 对象键、摘要和不可变写入辅助能力由实际 producer 在所属模块内维护，不保留独立通用 package；
- Campus Docs 分块只消费 `campus-docs/source.json` 及其当前 reader，按
  [所属分块定义](../../../../docs/architecture/system/retrieval-serving.md#分块定义)生成内容寻址 Chunk Set；
- Campus Web 的六个公开 scope 属于当前来源目录，不由已删除的 collection 配置定义；
- 不保留旧命令、schema 或配置文件的兼容入口。

## 未采用方案

[简化采集控制面与内部门户凭据所有权](./2026-08-19-internal-portal-credential-resolution.md) 当时保留独立 Rust kernel 和 canonical/retrieval 合同，便于在不依赖采集控制面的前提下
复用分块能力；但实际 Campus Docs 消费者已经使用 reader 分块，继续保留独立栈只增加工具链与两套
语义。保留空兼容入口同样会让调用方误认为旧合同仍受支持，因此选择删除；对象存储辅助能力
仍由实际 producer 维护，不把通用工具的退役解释为禁止必要的对象写入。

本次放弃独立通用 kernel 和旧 schema 的复用入口。只有出现当前 reader 路径无法满足的明确消费者，
并能说明输入、输出、所有权和验证需求时才重新评估独立分块能力；历史配置存在不构成恢复理由。

[规范化通知存储](../architecture/2026-08-14-normalized-notice-storage.md) 拥有的通知规范化与数据库读取不依赖旧文档分块栈；通知状态的后续变化由 [通知维护状态收敛](../architecture/2026-08-25-notice-maintenance-state.md) 维护。

## 后果

文档检索只剩一条当前分块路径，源码任务图不再需要 Rust 工具链。采集来源对象仍可由所属 publisher
独立规范化，但不能借旧 canonical/retrieval 合同绕过 Campus Docs 输入边界。
[简化采集控制面与内部门户凭据所有权](./2026-08-19-internal-portal-credential-resolution.md)关于采集控制面、凭据所有权
和 CLI／Job 入口的结论继续有效。本篇取代其 Rust 分块栈和 canonical/retrieval 合同保留决定，
并将对象存储辅助能力明确归属实际 producer，不保留独立通用 package；两篇保持活动并各自维护有效范围。

## 相关文档

- [采集数据面](../../../../docs/architecture/system/data-plane.md)
- [检索服务](../../../../docs/architecture/system/retrieval-serving.md)
- [Campus Docs 与 Notices 维护及统一 RAG 发布](../../../../docs/runbooks/ingestion/campus-docs.md)
- [Campus Docs Chunk 与 Embedding 任务](../../../../jobs/campus-docs-index-publisher/README.md)
- 部分取代 [简化采集控制面与内部门户凭据所有权](./2026-08-19-internal-portal-credential-resolution.md)；通知状态见 [通知维护状态收敛](../architecture/2026-08-25-notice-maintenance-state.md)。
