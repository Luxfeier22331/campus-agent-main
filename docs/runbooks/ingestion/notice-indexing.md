---
doc_type: runbook
owner_boundary: domains/notices
status: active
---

# 通知 Chunk 与 Embedding 制品

通知 Chunk 数据与 Embedding Set 在自动链路中由 `notice-pipeline` 流水线的
`notice-artifacts-worker` 阶段生成并发布；本文保留两个默认暂停的集群模板，用于单独构建或恢复。
它们不直接写入 Qdrant、不修改通知数据库；手动完成的 Notice Embedding Set 不自动进入 serving，
由统一 Campus RAG publisher 运维命令与 Docs Embedding Set 组装为当前 serving collection。

## 前置条件

从仓库根目录执行，先选择正确的 Kubernetes context，并替换 `<namespace>`、`<job-name>` 和制品 ID。
自动刷新优先使用 Ops `/tasks` 的 `notice-pipeline`；只有需要单独构建或恢复时才使用本文手动入口。
目标环境须已部署两个暂停模板、通知 schema、已发布正文及 derived bucket 写入身份；Embedding 阶段
还须能访问配置完成的 Model Config 与对应 Provider。每个阶段使用不同的 Job 名称。

## 构建 Chunk 数据

```bash
kubectl -n <namespace> create job \
  --from=cronjob/notice-chunk-builder <job-name>

kubectl -n <namespace> wait --for=condition=complete --timeout=65m job/<job-name>
kubectl -n <namespace> logs job/<job-name> --all-containers=true
```

成功结果包含：

```json
{"event":"result","notice_count":2845,"chunk_count":12814,"chunks":"sha256:<id>"}
```

数量取决于 Job 的 PostgreSQL 只读快照；示例数字不是固定门禁。正式制品位于：

```text
notices/rag/chunk-data/sha256/<id>/chunks.ndjson
```

## 构建 Embedding Set

将上一步返回的完整 `chunks` 注入本次 Job：

```bash
kubectl -n <namespace> create job \
  --from=cronjob/notice-embedding-builder <job-name> \
  --dry-run=client -o yaml |
kubectl set env --local -f - NOTICE_CHUNKS=sha256:<id> -o yaml |
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

同一内容寻址对象重复写入会验证已有内容；模板不包含 `NOTICE_CHUNKS` 默认值，不扫描或选择最新制品。

`notice_embedding_set.v2` 直接引用 Chunk 数据对象。Chunk 同时保留通知的 RFC3339 UTC `releasedAt`。
统一 publisher 从 Chunk 的 `retrievalText` 首行生成 title，
并由 `noticeId` 固定生成 `/notices/<noticeId>` citation；review sample 和 validation 仍作为离线诊断产物，
不连接 live Notices DB，也不重新 embedding。

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

notice-publisher 的重新发布只改写 `notices.notices` 正文投影，不构建本 runbook 的任何制品。在线
serving collection 与正文的一致性由 `notice-pipeline` 完整刷新维护：`prepareRefresh` 从已发布正文
重建 Chunk 数据并与当前激活的 Embedding Set 比对；Chunk 数据或模型 target 变化时触发 embed 与
统一发布，两者均未变化时刷新跳过。审查报告和算法标签不参与该判断。因此 republish 后的收敛窗口是下一次成功完成的 `noticePipelineRun`
（Temporal Schedule `notice-pipeline`，默认暂停，可经 Ops `/tasks` 手动触发）。刷新执行失败时收敛
推迟到下一次成功运行，失败在 Temporal 执行历史与 Ops 任务页可见；不提供单通知检索刷新入口。

## 完成与失败处理

Job 的 Complete 状态及结果 JSON 共同确认阶段完成；只跟随日志或看到 Pod 启动不代表成功。
Chunk 失败先检查 Notices 连接、已发布正文和对象存储写入；Embedding 失败检查显式 Chunk 数据、
Model Config、Provider 及 cache 校验错误，修复后用相同输入创建新 Job。已有合法 cache 可复用，
但不能在缺少最终 `embedding_set` 时声称构建完成。

完成后按[统一发布步骤](./campus-docs.md#5-发布统一-campus-rag-index)与 Docs 制品共同发布；
构建本身不改变当前在线索引。ID 和运行日志属于本次操作，不回填为长期文档中的固定环境事实。

## 相关文档

- [通知领域（架构边界）](../../architecture/domains/notices.md)
- [通知数据](../../data/notices.md)
- [采集运行](./ingestion.md)
- [Campus Docs 维护与索引发布](./campus-docs.md)
