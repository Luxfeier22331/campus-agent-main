---
doc_type: runbook
owner_boundary: domains/notices
status: active
---

# 通知 Chunk 与 Embedding 制品

本文运行两个默认暂停的集群模板，生成通知 Chunk Run 和 Embedding Set。它们不直接写入 Qdrant、不修改
通知数据库，也不自动触发下一阶段；完成的 Notice Embedding Set 由统一 Campus RAG publisher 与 Docs
Embedding Set 组装为当前 serving collection。

## 前置条件

从仓库根目录执行，先选择正确的 Kubernetes context，并替换 `<namespace>`、`<job-name>` 和制品 ID。
目标环境须已部署两个暂停模板、通知 schema、已发布正文及 derived bucket 写入身份；Embedding 阶段
还须能访问配置完成的 Model Config 与对应 Provider。每个阶段使用不同的 Job 名称。

## 构建 Chunk Run

```bash
kubectl -n <namespace> create job \
  --from=cronjob/notice-chunk-builder <job-name>

kubectl -n <namespace> wait --for=condition=complete --timeout=65m job/<job-name>
kubectl -n <namespace> logs job/<job-name> --all-containers=true
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

kubectl -n <namespace> wait --for=condition=complete --timeout=65m job/<job-name>
kubectl -n <namespace> logs job/<job-name> --all-containers=true
```

Job 从 Model Config 的 `campus_docs_embedding` 槽位读取一次完整连接，按 `retrievalTextSha256` 去重。每个
模型 target 和文本摘要对应一个线上不可变 cache：

```text
notices/rag/embedding-cache/<model-target-sha256>/sha256/<text-sha256>.json
```

Job 会先校验已有 cache，只把缺失输入提交给 Provider；每个成功 batch 会立即写入 cache。因此失败后重跑
会复用已完成的输入，日志中的 `generated` 和 `reused` 数量可以确认本次工作范围。成功结果包含：

```json
{"event":"result","embedding_count":12528,"generated_embedding_input_count":0,"reused_embedding_input_count":12528,"embedding_set":"sha256:<id>"}
```

Embedding 数据和 manifest 位于：

```text
notices/rag/embedding-data/sha256/<digest>/embeddings.ndjson
notices/rag/embedding-sets/sha256/<id>/manifest.json
```

同一内容寻址对象重复写入会验证已有内容；模板不包含 `NOTICE_CHUNK_RUN` 默认值，不扫描或选择最新制品。

Chunk Run 使用 `notice_chunk_run.v1`。统一 publisher 只读取 Chunk 数据，从 `retrievalText` 首行生成 title，
并由 `noticeId` 固定生成 `/notices/<noticeId>` citation；review sample 和 validation 仍作为离线诊断产物，
不连接 live Notices DB，也不重新 embedding。

## 导入本地 Embedding Cache

当本地 cache 已经由同一份 Chunk Run 和同一模型 target 完整生成时，可以先完整校验再导入线上：

```bash
pnpm --dir jobs/notice-index-publisher import-embedding-cache-local -- \
  --chunk-run sha256:<chunk-run-id> \
  --model-target-sha256 <model-target-sha256> \
  --cache-directory var/notices/chunking/embedding-cache/<model-target-sha256>/sha256
```

命令会拒绝缺失、额外或内容不符合 `notice_embedding_cache.v1` 的文件；校验失败时不会上传任何 cache，且
不会调用 Provider。导入后照常运行 `build-embeddings`；最终数据对象和 manifest 仍使用原有的
`notice_embedding_set.v1` 合同。

## 完成与失败处理

Job 的 Complete 状态及结果 JSON 共同确认阶段完成；只跟随日志或看到 Pod 启动不代表成功。
Chunk 失败先检查 Notices 连接、已发布正文和对象存储写入；Embedding 失败检查显式 Chunk Run、
Model Config、Provider 及 cache 校验错误，修复后用相同输入创建新 Job。已有合法 cache 可复用，
但不能在缺少最终 `embedding_set` 时声称构建完成。

完成后按[统一发布步骤](./campus-docs.md#5-发布统一-campus-rag-index)与 Docs 制品共同发布；
构建本身不改变当前在线索引。ID 和运行日志属于本次操作，不回填为长期文档中的固定环境事实。
