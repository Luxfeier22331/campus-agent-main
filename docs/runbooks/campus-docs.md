---
doc_type: runbook
owner_boundary: retrieval-serving
status: active
---

# Campus Docs 维护与索引发布

## 边界

本文说明如何把整理后的 Campus Web 文档更新到对象存储，刷新静态文档候选，并手动发布 Campus Docs
检索索引。它不负责来源采集、正文清洗方法、普通运行时发布或环境 Secret 创建。

共享输入只有对象存储中的 `campus-docs/source.json` 及其引用对象。Campus Web 静态构建和 Campus Docs
索引发布是两个独立消费者，各自产生不可变产物并独立失败；二者之间没有跨系统事务或第二个文档版本
指针。

## 维护规则

`campus_docs_source.v3` 是完整当前期望集合，不是增量补丁：

- 新增文档时，先上传内容寻址 reader 和补充对象，再在候选清单中登记文档与版本；
- 正式内容修订使用新的 `versionId`、`versionSlug` 和 reader，对应文档只选择一个当前版本；
- 只修复提取、表格或分段错误且来源版本未改变时，保留文档和版本身份，上传新的内容寻址 reader 并
  替换该版本的 reader 引用；
- 修改公开 slug 时，在 `redirects[]` 增加旧正文路径到新固定链接的 `308`；
- 删除文档时，从完整清单中删除文档及其版本；不使用撤回标记或空 reader 表达删除；
- `versions[].reader`、补充对象和补充图片的全部引用共同构成对象存储存活集合。bucket 中未被当前清单
  引用的对象不会进入 Campus Web 或 RAG。

RAG 只索引每份文档的当前 reader。历史 reader 仍由 Campus Web 用于历史版本阅读，因此只要还被清单
引用就不能清理。

## 更新来源

1. 从当前 `campus-docs/source.json` 制作完整候选清单，不从 bucket 列表、修改时间或文件名推断内容。
2. 上传候选清单引用的新 reader、补充数据和图片，记录每个对象的精确 `key`、`byteSize` 和
   `sha256`。
3. 在本地保存候选清单为 `<candidate-source.json>`，检查文档身份、版本选择、公开路径和重定向。
4. 使用写入身份执行完整编译和固定键更新：

```bash
pnpm --dir apps/campus-web docs:source:update -- \
  --source-file <candidate-source.json>
```

命令会规范化清单、读取并核对全部引用、完整编译所有版本，最后才覆盖固定来源键并回读验证。任一步
失败都先修复候选清单或引用对象，不手工覆盖 `source.json`。

## 刷新 Campus Web

来源更新成功后，手动运行 `staging-candidate-publish`，选择
`candidate_scope=campus-web-docs`。该入口重新读取当前固定来源键，构建真实静态文档并上传不可变 Campus
Web Worker version；环境是否选择该 version 仍由环境仓决定。

每个当前版本同时生成普通文档 URL 和 `/v/<versionSlug>` 固定链接。运行 RAG publisher 前，先确认目标
环境选择了包含这些版本链接的 Campus Web version；publisher 不通过 HTTP 探测或跨系统状态替代该
人工顺序。静态构建和 RAG 构建仍是独立消费者，失败时分别修复和重跑，不回滚已经写入的来源清单。

## 发布 RAG 索引

环境中的 `CronJob/campus-docs-index-publisher` 必须保持 `suspend: true`，只作为手动 Job 模板使用。它
需要 publisher PostgreSQL 角色、embedding provider、Qdrant 写入凭据、对象存储只读身份，以及由
rendered ConfigMap 提供的 `CAMPUS_DOCS_EMBEDDING_SPACE_ID`。该值必须标识实际模型权重和修订，不使用
endpoint 或 Secret 充当身份。不要解除 CronJob 的暂停状态。

创建一次发布任务：

```bash
namespace=campus-agent-staging
job="campus-docs-index-$(date -u +%Y%m%d%H%M%S)"

kubectl -n "$namespace" create job \
  --from=cronjob/campus-docs-index-publisher \
  "$job"
kubectl -n "$namespace" wait \
  --for=condition=complete \
  --timeout=65m \
  "job/$job"
kubectl -n "$namespace" logs "job/$job" --all-containers=true
```

publisher 在读取来源前取得 PostgreSQL advisory lock。同一时刻已有 publisher 时，新任务立即失败；
删除失败 Job 后等待正在运行的任务结束，不并行重试。

一次实际构建会：

1. 读取并核对当前 reader，按索引定义生成全部 section 和 chunk；
2. 以 `retrieval_text_sha256` 合并重复检索文本；当前索引的 `embedding_space_id`、provider、model 和
   dimensions 全部兼容时，从旧 collection 读取并复用未变化检索文本的 dense vector；
3. 只为未命中的唯一检索文本调用 embedding provider，并为全部 chunk 重新生成 payload 和 sparse
   vector；
4. 写入完整的新不可变 Qdrant collection，校验后重新读取来源清单；
5. 原子替换 PostgreSQL `campus_docs_serving.current_index`。

publisher 不原地修改旧 collection，也不把 chunk 或 embedding 另存到对象存储。尚未激活的目标
collection 已由前一次中断任务完整写入时，重跑会验证后直接激活；确定性内容不匹配时删除并重建；
Qdrant 网络或 HTTP 错误不会触发删除。目标已经是当前绑定时仍执行完整校验：物理 collection 缺失时
按同一名称重建，已存在但内容不匹配时停止，绝不删除当前 collection。

## 核对结果

成功日志是单个 JSON 对象，始终包含：

- `collection`：本次输入和索引定义对应的物理 collection；
- `no_op`：本次运行是否只验证了已经完整且绑定一致的当前 collection；缺失后重建即使数据库指针未变
  也为 `false`；
- `source_digest`：本次读取的 `source.json` 精确字节摘要；
- `document_count`：当前文档数。

本次进程实际创建 collection 时还包含：

- `point_count`；
- `unique_embedding_input_count`；
- `reused_embedding_input_count`；
- `generated_embedding_input_count`。

必须满足：

```text
reused_embedding_input_count + generated_embedding_input_count
= unique_embedding_input_count
```

首次发布或 `embedding_space_id` 变化后，在 Ops Web 重新保存并验证查询 Embedding 设置。保存请求会
显式携带当前索引要求的 space ID；provider、model、dimensions 或 space ID 任一不一致时，在线检索
拒绝准入。

首次发布或 embedding 身份变化时，`reused_embedding_input_count` 为 `0`。普通文档更新时，标题路径和
正文都未变化的 chunk 应产生复用命中，但复用数量不是发布成功条件。

需要确认当前绑定后，再从同一 CronJob 创建第二个 Job。来源未变化时应返回相同 `collection` 和
`no_op: true`，且不输出实际构建计数。完成日志核对后删除手动 Job：

```bash
kubectl -n "$namespace" delete job "$job"
```

## 失败处理

- reader、摘要或清单关系无效：修复来源对象或候选清单，再重新运行来源更新；
- embedding 失败：保留当前索引绑定，修复 provider 后重跑同一来源；
- 新 collection 写入或校验失败：publisher 删除本次已确认创建的无效 collection，当前绑定不变；
- 来源在构建期间变化：publisher 不激活结果；若 collection 是本次新建则删除，随后按新来源重跑；
- 数据库激活返回不确定错误：保留已验证 collection，直接重跑；publisher 会读取实际当前绑定并
  no-op 或完成激活；
- 已有目标 collection 的 Qdrant 请求失败：先修复 Qdrant，不手工删除同名 collection。

## Reader 清理

对象存储清理是人工治理操作，不由 publisher 执行，也不在仓库保存通用清理程序。

1. 紧接清理前重新读取并校验当前 `source.json`。
2. 从所有 reader、补充对象和补充图片引用计算完整存活 key 集合。
3. 枚举目标前缀的全部对象版本和 delete marker；只把不在存活集合中的 key 放入待删除集合。
4. 人工核对待删除对象的格式、前缀、数量和来源批次。集合与预期不完全一致时停止。
5. bucket 开启版本控制，因此使用管理员身份删除待删除 key 的所有具体 `VersionId` 和 delete marker；
   只写普通 delete marker 不会回收存储。
6. 清理后重新读取当前清单，并按 `byteSize` 和 `sha256` 核对全部存活对象。

清理期间来源摘要发生变化时，丢弃待删除集合并从第一步重新计算。不得删除仍被历史版本引用的 reader。

## Qdrant 清理

旧 collection 不在激活时自动删除，因为切换前已准入的运行冻结了旧 collection。人工删除前必须：

1. 从 `campus_docs_serving.current_index` 读取当前 collection，永不删除当前值；
2. 确认没有非终态运行的 `runtime.agent_workflow_starts.workflow_input_json` 引用候选 collection；
3. 使用 Qdrant 管理凭据删除明确列出的旧 collection，并再次确认当前 collection 可读取。

非终态引用可按以下 JSON 路径核对：

```sql
\set collection 'campus_docs_<sha256>'

select runs.run_id, runs.status
from runtime.agent_runs as runs
join runtime.agent_workflow_starts as starts using (run_id)
where runs.status in ('created', 'queued', 'admitted', 'running', 'streaming')
  and starts.workflow_input_json #>>
      '{admission_snapshot,campus_docs_retrieval,index,collection}' = :'collection';
```

仓库不维护 collection 历史表、保留状态机或自动回收任务。每次清理只处理本次明确核对的集合。

## 相关文档

- [检索服务](../architecture/system/retrieval-serving.md)
- [文档站架构](../architecture/system/document-site.md)
- [文档来源与静态交付合同](../contracts/document-reader-delivery.md)
- [文档阅读器数据模型](../data/document-reader.md)
