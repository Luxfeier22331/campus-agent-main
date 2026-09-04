---
doc_type: runbook
owner_boundary: domains/notices
status: active
---

# 通知 Chunk 与 Embedding 制品

本文运行两个默认暂停的集群模板，生成通知 Chunk Run 和 Embedding Set。它们不写入 Qdrant，不修改通知
数据库，也不自动触发下一阶段。

## 构建 Chunk Run

```bash
kubectl -n <namespace> create job \
  --from=cronjob/notice-chunk-builder <job-name>

kubectl -n <namespace> logs job/<job-name> --follow
```

成功结果包含：

```json
{"event":"result","notice_count":2845,"chunk_count":12814,"chunk_run":"sha256:<id>"}
```

数量取决于 Job 的 PostgreSQL 只读快照；示例数字不是固定门禁。正式制品位于：

```text
notices/rag/chunk-runs/sha256/<id>/
```

## 构建 Embedding Set

将上一步返回的完整 `chunk_run` 注入本次 Job：

```bash
kubectl -n <namespace> create job \
  --from=cronjob/notice-embedding-builder <job-name> \
  --dry-run=client -o yaml |
kubectl set env --local -f - NOTICE_CHUNK_RUN=sha256:<id> -o yaml |
kubectl -n <namespace> create -f -

kubectl -n <namespace> logs job/<job-name> --follow
```

Job 从 Model Config 的 `campus_docs_embedding` 槽位读取一次完整连接，按 `retrievalTextSha256` 去重后调用
Provider。成功结果包含：

```json
{"event":"result","embedding_count":12528,"embedding_set":"sha256:<id>"}
```

Embedding 数据和 manifest 位于：

```text
notices/rag/embedding-data/sha256/<digest>/embeddings.ndjson
notices/rag/embedding-sets/sha256/<id>/manifest.json
```

同一内容寻址对象重复写入会验证已有内容；模板不包含 `NOTICE_CHUNK_RUN` 默认值，不扫描或选择最新制品。
