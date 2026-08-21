---
doc_type: decision
owner_boundary: ingestion-data-plane
decision_id: ADR-0091
status: accepted
partially_supersedes: ADR-0089
---

# ADR-0091 退役旧文档分块栈

## 背景

仓库曾保留一套独立 Rust 分块 kernel、集合配置，以及
`canonical_document_unit`、`retrieval_chunk` 合同。它们没有运行消费者，也不参与当前 Campus Docs
索引。Campus Docs 已经以当前 reader 为唯一输入，并由所属 Job 生成 Chunk Set、Embedding Set 和
Qdrant collection。继续保留两套分块语义会造成错误的能力认知和重复工具链成本。

## 决策

- 删除 Rust 分块 workspace、根 Cargo 工具链和对应手动验证 profile；
- 删除 collection profile loader 和无消费者的 canonical/retrieval schema；
- 对象键、摘要和不可变写入辅助能力由实际 producer 在所属模块内维护，不保留独立通用 package；
- Campus Docs 分块只消费 `campus-docs/source.json` 及其当前 reader，使用
  `campus_docs_reader_elements.v4` 生成内容寻址 Chunk Set；
- Campus Web 的六个公开 scope 属于当前来源目录，不由已删除的 collection 配置定义；
- 不保留旧命令、schema 或配置文件的兼容入口。

## 结果

文档检索只剩一条当前分块路径，源码任务图不再需要 Rust 工具链。采集来源对象仍可由所属 publisher
独立规范化，但不能借旧 canonical/retrieval 合同绕过 Campus Docs 输入边界。ADR-0089 关于采集控制面
和凭据所有权的结论继续有效，其中保留旧 Rust 分块能力的决定由本 ADR 取代。

## 相关文档

- `../architecture/system/data-plane.md`
- `../architecture/system/retrieval-serving.md`
- `../runbooks/campus-docs.md`
- `../../jobs/campus-docs-index-publisher/README.md`
