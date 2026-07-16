---
doc_type: policy
owner_boundary: domains/regulations
status: active
---
# `student_rules` 分块规则

## 边界

本文记录 `regulations/student_rules` 当前可执行的校验与分块规则。配置名称或备注不证明
结构化语义已经实现；实际行为以任务注册表、Rust 内核和测试为准。

## 执行链

任务注册表开放两个 Rust 内核任务：

- `regulations.student_rules.document_units_validate`：按
  `canonical-document-units.v1.schema.json` 校验逐行 JSON；
- `regulations.student_rules.chunk_prepare`：把同一合同的 `clean_text` 分块，输出
  `ingestion_chunk_set.v1`。

`apps/ingestion-control` 从 collection profile 读取预算，调用
`packages/ingestion-kernels-rs`，并把成功结果写入派生对象存储。输入、输出或内核错误必须
使任务失败，不得返回部分成功。

## Tokenizer 与预算

内核必须从 `INGESTION_KERNEL_TOKENIZER_JSON_PATH` 读取本地 `tokenizer.json`。文件缺失或
无效时失败关闭，不在运行时下载模型。

`student_rules_semantic_v3` 当前预算：

| 配置 | 值 |
| --- | ---: |
| `chunk_size` | 384 |
| `max_chunk_size` | 512 |
| `chunk_overlap` | 64 |
| `min_chunk_size` | 96 |

服务配置将向量模型声明为 `Qwen3-Embedding-4B`、`2560` 维。分块 tokenizer 与向量请求是
两个边界：本地 tokenizer 只负责 token 预算，不发起向量请求；Qdrant sparse tokenizer 也
不替代该预算来源。

## 当前分块行为

Rust 内核对每条有效 document unit 执行以下步骤：

1. 读取 `doc_id`、`chunk_id` 和 `clean_text`；
2. 使用 `text-splitter` 和本地 tokenizer 按预算切分文本；
3. 拒绝超过 `max_chunk_size` 的结果；
4. 当前一输出属于同一 `doc_id` 且小于 `min_chunk_size` 时，尝试合并；合并后不得超过
   `max_chunk_size`；
5. 按文档生成稳定序号形式的 `chunk_id`，并保留参与合并的 `unit_ids`。

当前 `ingestion_chunk_set.v1` 只包含 `chunk_id`、`doc_id`、`unit_ids` 和 `text`。内核尚未
输出章节上下文、结构专用切分结果、`answer_role`、类别概览或
`answer_ready_evidence.v3` 元数据，因此文档不得把这些能力描述成已实现门槛。

## 校验门槛

- 每个非空输入行必须是合法 JSON 并通过 canonical document unit schema；
- `chunk_size`、`max_chunk_size` 和 `min_chunk_size` 必须为正整数；
- `chunk_size <= max_chunk_size`，`min_chunk_size <= max_chunk_size`；
- `chunk_overlap < chunk_size`；
- tokenizer 文件必须存在且可加载；
- 内核输出的 `error_count` 必须为零；
- 合并不得跨 `doc_id`。

检索开放由 `configs/runtime/query-serving-targets.v1.json`、索引发布和运行时准入共同决定，
不能从本分块配置单独推断。

## 变更要求

调整预算时必须同时更新 profile、collection profile 测试和 Rust 内核覆盖。若要增加结构化
切分、上下文标题或答案角色，必须先扩展机器合同和内核实现，再更新本文；不得只修改备注
或策略文档宣称完成。

## 可执行来源

- [chunk-profile.json](../../configs/ingestion/regulations/student_rules/chunk-profile.json)
- [serving-config.json](../../configs/ingestion/regulations/student_rules/serving-config.json)
- [task-registry.v3.json](../../configs/ingestion/regulations/student_rules/task-registry.v3.json)
- [rust-kernel-runner.ts](../../apps/ingestion-control/src/rust-kernel-runner.ts)
- [lib.rs](../../packages/ingestion-kernels-rs/src/lib.rs)
- [canonical-document-units.v1.schema.json](../../packages/ingestion-contracts/schemas/canonical-document-units.v1.schema.json)
