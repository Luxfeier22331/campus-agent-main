---
doc_type: runbook
owner_boundary: domains/notices
status: active
---

# 通知 Chunk 与 Embedding 制品

通知 Chunk 与 Embedding 由 `retrieval-build` 一次性 Job 构建，不再属于通知 Temporal 流水线。
使用 `RETRIEVAL_BUILD_SOURCE=notices`；具体创建命令和 Apply 操作见
[统一索引维护](./campus-docs.md#检索索引-job)。本地分块、审阅与评测继续由 Notice builder 提供。

## 前置条件

已发布通知正文、derived bucket 写入身份、Model Config 与 Embedding provider 已配置。
复用旧向量时显式传 `CAMPUS_NOTICE_REUSE_EMBEDDING_SET`，必须属于同一模型目标。

## 构建 Chunk 数据

Build 在 repeatable-read 快照内分页读取正文，逐篇调用既有分块器；Chunk 写入 SQLite 工作区后生成
内容寻址 NDJSON。分块不访问 Qdrant，也不修改通知发布状态。

## 构建 Embedding Set

同一个 Build Job 继续按检索文本去重和生成向量，输出 Notice Embedding Set ID。
未变化文本可从显式旧 Set 复用；新向量串行分批生成，不在进程内保留完整集合。
该 ID 需要与显式 Docs Embedding Set 一起交给 Apply，完成后才进入检索。

## 导入本地 Embedding Cache

当本地 cache 已经由同一份 Chunk 数据 和同一模型 target 完整生成时，可以先完整校验再导入线上：

```bash
pnpm --dir jobs/notice-index-publisher import-embedding-cache-local -- \
  --chunks sha256:<chunks-digest> \
  --model-target-sha256 <model-target-sha256> \
  --cache-directory var/notices/chunking/embedding-cache/<model-target-sha256>/sha256
```

命令会拒绝缺失、额外或内容不符合 `notice_embedding_cache.v1` 的文件；校验失败时不会上传任何 cache，且
不会调用 Provider。导入后照常运行 `build-embeddings`；最终 manifest 使用 `notice_embedding_set.v2`，直接引用 chunks。

## 与 republish 的一致性

republish 只更新已发布正文。运维执行下一次 Build/Apply 后，检索才反映正文和 OCR 变化；不再承诺
下一轮通知 Schedule 自动刷新索引。`document-ocr` 调度完成的识别同样只在下一次 Build/Apply 后进入检索。Apply 失败保持机构知识检索关闭，以同一组制品重建。

## 相关文档

- [通知领域（架构边界）](../../architecture/domains/notices.md)
- [通知数据](../../data/notices.md)
- [采集运行](./ingestion.md)
- [Campus Docs 维护与索引发布](./campus-docs.md)
