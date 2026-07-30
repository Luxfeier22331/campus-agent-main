---
doc_type: policy
owner_boundary: domains/regulations
status: active
---

# `student_rules` 分块规则

## 边界

本文记录 `regulations/student_rules` 当前可执行的校验与检索分块规则。实际行为以任务注册表、
`packages/ingestion-contracts` schema、Rust 内核和测试为准。

## 执行链

任务注册表开放两个 Rust 内核任务：

- `regulations.student_rules.document_units_validate`：保留的内部通知链 v1 文档单元校验；
- `regulations.student_rules.chunk_prepare`：调用 `build-retrieval-chunks-v2`，把逐行
  `canonical_document_unit.v2` 生成 `retrieval_chunk_set.v2`。

`apps/ingestion-control` 从 collection profile 读取预算，调用 Rust runner，并把成功结果写入派生
对象存储。输入、输出或内核错误必须使任务失败，不得返回部分成功。

## Tokenizer 与预算

ingestion-control 使用源码固定的镜像内路径
`/opt/campus-agent/models/qwen3-embedding-4b/tokenizer.json` 加载 tokenizer，并据此计算精确 token 数。
文件缺失或无效时失败关闭，不在运行时下载模型，也不通过部署变量覆盖该路径。

精确预算只在
[`chunk-profile.json`](../../configs/ingestion/regulations/student_rules/chunk-profile.json) 维护。分块
tokenizer 只负责 token 预算，不发起向量请求；向量模型与维度由
[`serving-config.json`](../../configs/ingestion/regulations/student_rules/serving-config.json) 维护。

## 当前分块行为

Rust 内核执行：

1. 逐行校验 `canonical_document_unit.v2`；
2. 重新计算并核对 `content_sha256`；
3. 按 scope、document、version、section ordinal 和 section id 确定性排序；
4. 拒绝重复的 document/version/section 身份；
5. 在单个 section 的 `content` 内按本地 tokenizer 预算切分并保留 overlap；
6. 只在同一 section 内尝试合并低于 `min_chunk_size` 的尾块，合并后不得超过上限；
7. 根据 section 身份、ordinal 和正文 hash 生成稳定 `chunk_id`；
8. 逐项校验 `retrieval_chunk.v2`，形成 `retrieval_chunk_set.v2`。

分块不得跨 section。输入顺序变化不能改变输出顺序、chunk ID、正文 hash 或 token 数。

## 校验门槛

- 每个非空输入行必须是合法 JSON 并通过 v2 schema；
- `content_sha256` 必须与正文一致；
- `chunk_size`、`max_chunk_size` 和 `min_chunk_size` 必须为正整数；
- `chunk_size <= max_chunk_size`，`min_chunk_size <= max_chunk_size`；
- `chunk_overlap < chunk_size`；
- tokenizer 文件必须存在且可加载；
- 每个 chunk 的 `token_count` 必须精确且不超过上限；
- 内核输出的 `error_count` 必须为零。

检索开放由范围注册表、知识 release 发布和运行准入共同决定，不能从分块配置单独推断。

## 可执行来源

- [chunk-profile.json](../../configs/ingestion/regulations/student_rules/chunk-profile.json)
- [task-registry.v3.json](../../configs/ingestion/regulations/student_rules/task-registry.v3.json)
- [rust-kernel-runner.ts](../../apps/ingestion-control/src/rust-kernel-runner.ts)
- [lib.rs](../../packages/ingestion-kernels-rs/src/lib.rs)
- [canonical-document-units.v2.schema.json](../../packages/ingestion-contracts/schemas/canonical-document-units.v2.schema.json)
- [retrieval-chunk-set.v2.schema.json](../../packages/ingestion-contracts/schemas/retrieval-chunk-set.v2.schema.json)
