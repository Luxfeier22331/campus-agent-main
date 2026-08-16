---
doc_type: runbook
owner_boundary: retrieval-serving
status: active
---

# Campus Docs 维护与索引发布

## 边界

本文说明如何把整理后的 Campus Web 文档更新到对象存储、刷新静态文档候选，并按三个独立阶段手动
构建 Campus Docs 检索索引。它不负责来源采集、正文清洗方法、普通运行时发布或环境 Secret 创建。

共享输入只有对象存储中的 `campus-docs/source.json` 及其引用对象。Campus Web 静态构建和 Campus Docs
RAG 制品是两个独立消费者，各自产生不可变产物并独立失败；二者之间没有跨系统事务或第二个文档
版本指针。

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

每个当前版本同时生成普通文档 URL 和 `/v/<versionSlug>` 固定链接。运行 RAG 分块前，先确认目标环境
选择了包含这些版本链接的 Campus Web version。静态构建和 RAG 构建仍是独立消费者，失败时分别修复
和重跑，不回滚已经写入的来源清单。

## RAG 制品

三个阶段写入同一 derived bucket，所有对象都按内容寻址：

| 制品 | 对象键 |
| --- | --- |
| Chunk 数据 | `campus-docs/rag/chunk-data/sha256/<digest>/chunks.ndjson` |
| Chunk set | `campus-docs/rag/chunk-sets/sha256/<id>/manifest.json` |
| Embedding 数据 | `campus-docs/rag/embedding-data/sha256/<digest>/embeddings.ndjson` |
| Embedding set | `campus-docs/rag/embedding-sets/sha256/<id>/manifest.json` |
| Index manifest | `campus-docs/rag/indexes/sha256/<id>/manifest.json` |

NDJSON 和 manifest 都使用规范序列化并以换行结尾。写入使用 `If-None-Match: *`；同键同内容是幂等
重跑，不同内容是错误。系统不维护 `latest` 制品指针，下一阶段必须显式接收上一阶段输出的
`sha256:<id>`。

三个 Job 使用现有 derived bucket 写入身份。Chunk 和 Embedding Job 写入各自的数据与 manifest；Publisher
只额外写入本次不可变 index manifest，随后读取显式制品并发布 Qdrant/当前指针，不创建单独的对象存储
Secret 或只读/写入两套 Campus Docs 凭据。

## 手动执行

`CronJob/campus-docs-chunk-builder`、`CronJob/campus-docs-embedding-builder` 和
`CronJob/campus-docs-index-publisher` 必须保持 `suspend: true`。仓库命令每次只从一个模板创建一个
Job，不等待、不读取日志，也不触发下一阶段。命令使用当前 `kubectl` context 和 namespace。

### 1. 构建 Chunk Set

```bash
pnpm campus-docs:index-job -- --stage chunks
```

等待并读取该 Job 日志。成功 JSON 包含 `chunk_set`、`chunk_count`、`document_count` 和
`source_digest`。记录 `chunk_set`，抽样核对对应 `chunks.ndjson` 后再进入下一阶段。

该 Job 只访问来源、reader 和 derived bucket，不访问 execution-control、PostgreSQL、Qdrant 或
embedding provider。

### 2. 构建 Embedding Set

```bash
pnpm campus-docs:index-job -- \
  --stage embeddings \
  --chunk-set sha256:<chunk-set-id>
```

需要显式复用既有向量时才增加：

```bash
--reuse-embedding-set sha256:<embedding-set-id>
```

Embedding Job 启动后从 `execution-control-provider-snapshot:8002` 读取一次当前 Embedding 连接，然后
直接调用 provider。该连接由 Ops Web 管理并保存在 `execution_control.model_settings`；Job 不接收
provider Base URL、model 或 API key 环境变量，也没有独立 provider Secret。

复用只按 `embedding_space_id + retrievalTextSha256` 从显式 embedding set 读取，不扫描 bucket，也不
从 Qdrant 读取向量。成功 JSON 包含 `embedding_set`、`embedding_count`、
`reused_embedding_input_count` 和 `generated_embedding_input_count`。抽样核对后记录
`embedding_set`。

### 3. 发布 Index

```bash
pnpm campus-docs:index-job -- \
  --stage publish \
  --chunk-set sha256:<chunk-set-id> \
  --embedding-set sha256:<embedding-set-id>
```

Publisher 只读取并核对两个显式制品，不读取 reader，也不调用 embedding provider。它生成 index
manifest；manifest 摘要同时成为 Qdrant collection 后缀：

```text
campus_docs_<index-manifest-hex>
```

Publisher 写入并完整校验 Qdrant points 后，重新读取 `source.json`，只比较会影响当前索引的文档投影。
投影未变化时才原子替换 PostgreSQL `campus_docs_serving.current_index`。成功 JSON 包含 `index`、
`collection`、`point_count` 和 `no_op`。

PostgreSQL advisory lock 只保护发布阶段的当前绑定替换。同一时刻已有 Publisher 时，新 Publisher Job
立即失败；Chunk 和 Embedding 阶段不使用该锁。

查看任一阶段结果时，由操作者对刚创建的 Job 执行：

```bash
kubectl wait --for=condition=complete --timeout=65m job/<job-name>
kubectl logs job/<job-name> --all-containers=true
```

## 验证与失败处理

- reader、摘要或清单关系无效：修复来源对象或候选清单，重新运行 Chunk Job；
- chunk 抽样不合格：修复 reader 或分块实现，生成新的 chunk set，不继续 Embedding；
- provider 快照或 embedding 调用失败：当前索引不变；修复 Ops Web 中的连接并重新运行 Embedding Job；
- embedding 抽样不合格：不要发布，修复模型连接或索引定义后生成新的 embedding set；
- chunk set 与 embedding set 不匹配：Publisher 在写 Qdrant 前失败，使用正确的显式 ID 重跑；
- 新 collection 写入、校验或来源末次核对失败：Publisher 删除本次新建 collection，当前绑定不变；
- 当前 collection 已存在但内容不匹配：Publisher 停止且不删除当前 collection；
- 未激活候选 collection 内容完整：重跑会验证后激活；确定性内容冲突时删除并重建；
- 数据库激活返回不确定错误：保留已验证 collection，直接重跑同一组 ID 读取实际当前绑定。

Embedding 设置可以在首次索引发布前保存和验证。配置验证调用 `/embeddings` 时不指定索引维度，只
记录 provider 返回的观测维度；在线查询再使用已准入当前索引的维度请求向量，并校验实际长度。

## Reader 清理

对象存储清理是人工治理操作，不由制品 Job 执行，也不在仓库保存通用清理程序。

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
