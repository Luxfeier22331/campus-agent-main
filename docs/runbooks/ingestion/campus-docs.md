---
doc_type: runbook
owner_boundary: retrieval-serving
status: active
---

# Campus Docs 与 Notices 维护及统一 RAG 发布

## 边界

本文说明如何把整理后的 Campus Web 文档更新到对象存储、刷新静态文档候选，分别构建 Docs/Notice
Chunk 与 Embedding 制品，并由一个统一 serving publisher 发布 Campus RAG 索引。它不负责来源采集、
正文清洗方法、普通运行时发布或环境 Secret 创建。

Docs 的共享输入是对象存储中的 `campus-docs/source.json` 及其引用对象；Notice 的输入是
`notice-publisher` 已发布正文。静态站、Docs builder、Notice builder 和统一 publisher 是独立消费者，
各自产生或消费不可变制品并独立失败；二者之间没有跨系统事务或第二个索引指针。在线 Agent 只通过
`campus_search` 读取已发布的当前 collection。

## 维护规则

`campus_docs_source.v4` 是完整当前期望集合，不是增量补丁。清单、reader、版本和补充对象的字段及
关系以[文档来源与静态交付合同](../../contracts/document-reader-delivery.md)为准；本手册只说明操作顺序。
新增或修订对象先上传，再提交 Git 声明，由发布器自动生成固定键；删除通过移除声明表达。RAG 只索引当前 reader，
历史 reader 只要仍被清单引用就不能清理。RAG publisher 当前只把来源清单选出的 current Docs 版本写入 serving collection；在线通过 payload 中的版本字段过滤和诊断。历史版本只有在未来被单独纳入 serving 制品后才可被历史查询消费。

生命周期 owner 也按阶段区分：来源 owner 管理门户原始对象和来源清单，Campus Web/Campus Docs 数据面
管理仍被清单引用的 normalized reader 与补充资产，Notice 数据面管理已发布正文，Campus RAG serving
管理两类 chunk/embedding 制品、当前 Qdrant collection 和旧 collection。统一 publisher 是
`campus_docs_serving.current_index` 的唯一写入者。对象是否存在于 bucket 不等于仍可删除；本手册中的
清理都是人工核对的明确集合。

## 前置条件

所有命令从仓库根目录执行，先替换示例中的路径、ID、namespace 和 Job 名称。
本地任务按各小节生成环境文件；涉及 Provider 的任务需要真实连接。集群操作前确认当前 context、
目标 namespace、暂停的阶段模板、所属数据库 schema、对象存储身份及 Model Config 配置已就绪。
统一发布还需要 Qdrant 写入权限及 serving 数据库连接。具体环境值由环境仓提供。

## 更新来源

1. 来源 owner 先把新 reader、补充数据和图片上传至 RustFS 的新对象键；使用条件创建，已有内容不得覆盖。
2. 修改 `apps/campus-web/docs-source/` 中对应 YAML，填写业务字段与对象 key。字段及布局见
   [声明目录说明](../../../apps/campus-web/docs-source/README.md)；不维护 `sha256` 或 `byteSize`。
3. 执行离线检查，提交 PR；Campus Web 的 Node 测试同样检查这份真实声明，不需要对象存储凭据：

   ```bash
   pnpm --dir apps/campus-web docs:source:check
   ```

4. 合并后候选流水线自动运行 `docs:source:publish`，计算引用摘要和大小、完整编译并执行 reader 提取与
   分段质量门禁、写不可变副本，再
   条件更新固定 `campus-docs/source.json`。成功输出 `documentCount`、`versionCount`、`sourceDigest`、`releaseKey`。
   手动调试也使用该命令，连接沿用 `env/commands/campus-docs-source.env` 和进程环境，选择目标后再运行。

编译或对象读取失败时固定键不变；条件冲突表示其他发布者已更新来源，检查新来源后重新发布，不手工覆盖。
静态构建失败可直接重跑候选流程，已有相同 digest 的副本会核对内容并复用。

回滚优先 revert 对应声明并重新发布；紧急恢复可用保留的 release 副本，但必须同步恢复 Git 声明，避免下一次
候选流水线再次发布新声明。固定键与保留的 release 引用对象均不得提前删除。

## 刷新 Campus Web

声明变更合并到 main 会选择 Campus Web 候选；手动重跑 `staging-candidate-publish` 时选择
`candidate_scope=campus-web-docs`。两种入口都先发布生成的来源，再用只读凭据构建真实静态文档并上传
不可变 Campus Web Worker version；环境是否选择该 version 仍由环境仓决定，不在此处触发 RAG。

每个当前版本同时生成普通文档 URL 和 `/v/<versionSlug>` 固定链接。静态构建和 RAG 构建是同一来源的
独立消费者，可以分别运行；任一消费者失败时只修复并重跑所属构建，不回滚已经写入的来源清单。

## 本地 Docs Chunk 与 Embedding 构建

首次在当前 worktree 使用本地任务时，先生成 Campus Docs publisher 自己的环境文件：

```bash
pnpm dev:init -- --target campus-docs-index-publisher
```

该初始化只生成本包 `.env.local`，不执行 migration、bootstrap 或 seed。需要在本地检查正式分块实现时，
使用该文件中的对象存储只读身份生成 Chunk Set：

```bash
pnpm --dir jobs/campus-docs-index-publisher build-chunks
```

命令读取固定来源和当前 reader，执行与线上 Chunk Job 相同的分块及结构合同校验，并把制品写入当前
worktree 的 `var/campus-docs/rag/`。Chunk identity、reader 元素覆盖、section 边界、root unit 顺序、
`retrievalText` 来源、字符上限或表格单元格覆盖不满足时，命令失败且不写 Chunk Set。该阶段不访问
embedding provider、PostgreSQL 或 Qdrant。

使用输出的 Chunk Set 和当前 worktree 根 `.env` 中的 Provider 连接生成本地 Docs Embedding Set：

```bash
pnpm --dir jobs/campus-docs-index-publisher build-embeddings -- \
  --chunk-set sha256:<chunk-set-id>
```

该命令从当前 worktree 根 `.env` 读取 `EMBEDDING_BASE_URL` 和 `EMBEDDING_API_KEY`，固定使用
`Qwen3-Embedding-4B`，并根据规范化 endpoint 和固定模型合同计算 Model Target hash。它只读写当前
worktree 的 `var/campus-docs/rag/`，不访问 Model Config、agent-control、Ops Web、PostgreSQL、
Qdrant 或集群对象存储。它与线上 Embedding Job 共用制品生成实现；差别只有本地连接和文件 Store。

## 本地 Notice Chunk 与 Embedding 构建

Notice 的 Chunk/Embedding builder 保留在 `notice-index-publisher`，不由 Docs package 重新处理。首次使用
时生成其本地环境文件，并从本地 Notices 数据库生成显式 Chunk Run：

```bash
pnpm dev:init -- --target notice-index-publisher
pnpm --dir jobs/notice-index-publisher build-chunks-local
```

成功输出提供本地 `run` 和输出目录。后续本地 Embedding 抽样或 dense 评测使用
[Notice builder 的本地命令](../../../jobs/notice-index-publisher/README.md#embedding-抽样与-recall-评测)，
需要 worktree 根 `.env` 中的 Embedding 连接；这些评测不会生成正式 Notice Embedding Set。

`build-embeddings` 是对象存储制品入口：读取 derived bucket 中的显式 Chunk Run，从 Model Config
取得连接并写回 derived bucket。它不能直接消费上述本地 `var/` Chunk Run。正式构建按
[通知制品手册](./notice-indexing.md)执行；其结果再与 Docs Embedding Set 交给统一 publisher。

## Chunk 策略治理验证

需要重新验证 Campus Docs 分块策略时，在不改变生产 campus_docs_reader_elements.v5 的前提下，对候选
Chunk Set 运行治理 review：

```bash
pnpm --dir jobs/campus-docs-index-publisher review-chunks-local -- \
  --chunk-set sha256:<chunk-set-id> \
  --embedding-evaluation sha256:<embedding-evaluation-id>
```

`--embedding-evaluation` 可省略；提供时只读取既有评测并把全部 evidence Chunk 及其 question/rank
加入审阅项，不重新调用 provider。该步骤读取候选 Chunk Set 及其来源投影，生成全量 census、150 份
文档的确定性覆盖样本、候选信号和 450 个 Chunk 级 `review-items.ndjson`。450 项包含独立元数据与
near-max Chunk、全部 embedding evidence、按配额抽取的表格上下文/短章节/同章节尾块/短表格/
many-root 或 split-reader、100 个无信号对照项和覆盖补齐项。普通分层每份文档最多 4 项，必须全量
纳入的元数据、near-max 和 embedding evidence 不受该上限约束。

逐项检查正文、heading 路径、reader root units 和前后边界，并用以下最小 NDJSON 合同记录判断：

```json
{"chunkId":"chunk_...","verdict":"keep"}
{"action":"upstream-reader","chunkId":"chunk_...","reason":"heading boundary is wrong","verdict":"change"}
```

`change` 的 action 只能是 `drop`、`attach`、`merge`、`split` 或 `upstream-reader`；`keep` 不带 action。
`drop` 表示不把独立内容作为 evidence，`attach` 保留信息并附着正文或表格上下文，`merge`／`split`
调整 Chunk 边界，`upstream-reader` 表示先修复 reader 元素或 heading。
标签可以分批汇总：

```bash
pnpm --dir jobs/campus-docs-index-publisher summarize-chunk-review-labels-local -- \
  --review-run sha256:<review-run-id> \
  --labels ../../var/campus-docs/chunk-governance/labels/<name>.ndjson
```

命令会拒绝重复或不属于该 Review Run 的 Chunk ID，并按 primary stratum、candidate signal、verdict 和
action 输出已标注数、未标注数及 change rate。审阅项保留正文、heading、root units 与前后边界；
对照组用于估计候选信号之外的问题率。候选信号只是人工审阅索引，不是自动改 Chunk 的规则。

有真实 embedding 连接时，再对固定问题文件执行 dense 检索评测：

```bash
pnpm --dir jobs/campus-docs-index-publisher evaluate-chunks-local -- \
  --chunk-set sha256:<chunk-set-id> \
  --questions var/campus-docs/chunk-governance/questions/<name>.ndjson
```

评测从当前 worktree 根 `.env` 读取 `EMBEDDING_BASE_URL` 与 `EMBEDDING_API_KEY`，固定使用
retrievalText、Qwen3-Embedding-4B、2560 维 cosine dense 相似度和 Recall@1/3/5/10；
同时输出 target Chunk、全部 evidence、文档和 single-chunk answer 指标，并按问题 stratum 输出结果。
它使用 retrievalTextSha256 做本地逐文本缓存；相同输入复跑应显示全部缓存复用并保持相同 Run ID。

比较 baseline 与 candidate 时，必须成对提供对应的 Chunk Set 和 Evaluation Run：

```bash
pnpm --dir jobs/campus-docs-index-publisher compare-chunks-local -- \
  --baseline-chunk-set sha256:<baseline-id> \
  --candidate-chunk-set sha256:<candidate-id> \
  --questions var/campus-docs/chunk-governance/questions/<name>.ndjson \
  --baseline-evaluation sha256:<baseline-evaluation-id> \
  --candidate-evaluation sha256:<candidate-evaluation-id>
```

`--questions` 由命令按仓库根解析；标签汇总的 `--labels` 则按包工作目录解析，所以示例保留 `../../../var/`。

比较前会校验两次评测分别引用对应 Chunk Set，并使用同一模型 target、问题文件摘要、embedding 定义、
问题数量和顺序。报告给出结构 delta、evidence placement 状态、整体/分层 embedding delta 以及共同
问题的 first evidence、all evidence、answer evidence、first document 排名改善、回归与不变计数。
来源投影不同的两次 Chunk Set 仍可比较结构，但不比较 evidence placement；评测合同不同则失败。

治理产物仅写入当前 worktree 的 `var/campus-docs/chunk-governance/`。review 成功输出 `run`、
`output_directory`、`sample_count` 和 `review_item_count`，应结合实际 Chunk Set 核对生成的审阅文件。
真实问题文件、文档正文和 embedding 向量不提交 Git。review 和 dense 评测用于人工/研究验证，不是 PR 阻断门，也不代表线上 hybrid + reranker
结果；不以短 Chunk 数量单独判断策略优劣。只有候选策略经过结构、广泛抽样和真实 embedding 证据综合
判断后，才另行决定是否生成新的生产 Chunk Set；本次治理不自动切换生产分块定义。

## 本地统一 RAG 发布验证

统一 Publisher 的本地命令使用与生产相同的版本化 collection 写入和 `current_index` 切换逻辑。验证前从集群
derived object store 导入两个 Embedding Set 的 serving 引用闭包到当前 worktree 的隔离本地 bucket。它只验证
发布阶段，不运行 Chunk、Embedding、provider 或在线查询。

直接初始化当前 worktree 的 publisher 环境及其本地基础设施、统一 schema。
publisher 环境从当前 profile 读取私有 writer key 和端口，基础设施操作再验证连接：

```bash
pnpm dev:init -- --target retrieval-index
```

从集群导入本次两个 Embedding Set：

```bash
pnpm --dir jobs/retrieval-index import-artifacts-local -- \
  --namespace campus-agent-staging \
  --context <kubectl-context> \
  --docs-embedding-set sha256:<docs-embedding-set-id> \
  --notice-embedding-set sha256:<notice-embedding-set-id>
```

导入器只复制两个 Embedding Set 实际引用的 serving immutable 对象，保持生产 object key，不复制整个 bucket，
也不写入集群 bucket。

运行验证：

```bash
pnpm --dir jobs/retrieval-index publish-index-local -- \
  --docs-embedding-set sha256:<docs-embedding-set-id> \
  --notice-embedding-set sha256:<notice-embedding-set-id>
```

命令检查制品后写入该 revision 的 collection，校验后切换 current_index，并删除本地上一个 collection。
成功输出 collection 与 point_count；相同输入重跑不写入。失败时 current_index 保持不变，修复后以同一组制品重跑。

本地 publisher 的 `.env.local` 使用当前 worktree 的隔离本地 S3 bucket 和 writer 凭据；`publish-index-local`
只读取该 bucket，不回退到 filesystem。没有两套已完成且格式符合合同的 Embedding Set 时，停止发布
验证，不在该命令中重新生成 embedding。

## RAG 制品

本地 Docs Chunk/Embedding 和 Notice Chunk/评测产物写入当前 worktree 的 `var/`，不自动晋升为
线上候选。正式 Chunk/Embedding Job 把制品写入 derived bucket。Notice 本地 Embedding cache 可以按
[显式导入步骤](./notice-indexing.md#导入本地-embedding-cache)完整校验后复用，正式 Set 仍由 Embedding Job
生成；导入 cache 不等于发布索引。

NDJSON 和 manifest 都使用规范序列化并以换行结尾。写入使用 `If-None-Match: *`；同键同内容是幂等
重跑，不同内容是错误。系统不维护 `latest` 制品指针，下一阶段必须显式接收上一阶段输出的
`sha256:<id>`。

retrieval-index build 与 apply 使用现有 derived bucket 身份；Build 写入 Docs/Notice 制品，Apply 只读取显式 Embedding Set 并写入版本化 collection、切换 current_index，不创建额外 serving artifact Secret。

## 检索索引 Job

目标环境部署 `retrieval-build`、`retrieval-apply`、`retrieval-cleanup` 三个暂停的 CronJob 模板。
这些模板不自动调度；运维按 Build → Apply → 可选 Cleanup 串行创建唯一命名的 Job。
Build 与 Apply 都在检索开放时执行，不需要维护窗口。Notice 采集/分类/发布不依赖这些 Job。

先生成 Job 文件并设置输入，再创建；不要先创建一个缺少参数的 Apply Job。
以下命令在已选择的 Kubernetes context 中运行，替换 namespace、Job 名和制品 ID：

```bash
kubectl -n <namespace> create job <build-job> --from=cronjob/retrieval-build \
  --dry-run=client -o yaml > /tmp/retrieval-build.yaml
kubectl set env --local -f /tmp/retrieval-build.yaml \
  RETRIEVAL_BUILD_SOURCE=both -o yaml | kubectl -n <namespace> create -f -
kubectl -n <namespace> logs -f job/<build-job>
```

只刷新 Notices 时使用 `RETRIEVAL_BUILD_SOURCE=notices`。可通过
`CAMPUS_DOCS_REUSE_EMBEDDING_SET`、`CAMPUS_NOTICE_REUSE_EMBEDDING_SET` 复用同模型旧向量。
保留 Build 输出的两个 Embedding Set ID；只构建一个来源时，另一个 ID 显式使用 current_index 中的引用。

```bash
kubectl -n <namespace> create job <apply-job> --from=cronjob/retrieval-apply \
  --dry-run=client -o yaml > /tmp/retrieval-apply.yaml
kubectl set env --local -f /tmp/retrieval-apply.yaml \
  CAMPUS_DOCS_EMBEDDING_SET=sha256:<docs-id> \
  CAMPUS_NOTICE_EMBEDDING_SET=sha256:<notice-id> -o yaml | kubectl -n <namespace> create -f -
kubectl -n <namespace> logs -f job/<apply-job>
```

Apply 在制品准备完成后写入 `campus_docs_<revision>` 并校验，再切换 current_index；切换后等待 90 秒，
让已开始的检索完成，然后删除上一个 collection。成功后 current_index 指向新 collection 并包含两份真实制品引用。
切换前失败时旧 collection 继续服务，以同一组制品重新创建 Apply Job 即可；相同输入不写入。

清理使用同样的 dry-run/set-env/create 顺序，以 `retrieval-cleanup` 为模板，显式设置
`RETRIEVAL_CLEANUP_DOCS_SETS` 和/或 `RETRIEVAL_CLEANUP_NOTICE_SETS`，值为逗号分隔的退休 ID。
清理不接受当前 ID，并保护其他保留 manifest 引用的共享数据。三个 Job 不并发运行。

## 首次切换

retrieval-index 镜像和模板随普通 Kargo 发布上线；schema 只新增制品引用列，旧 Worker 在新版本同步前
仍可正常写入。旧 Worker 由 Source 退休清单在同一次发布中移除。发布成功后执行一次 Build 和 Apply：
首次 Apply 写入版本化 collection、切换 current_index，并删除旧 Worker 最后指向的 collection。
在首次 Apply 前，Cleanup 会因 current_index 缺少 retrieval-index 写入的引用而拒绝执行。

旧 publisher 遗留的其他 `campus_docs_<摘要>` collection 不被 Apply 删除；按下文 Qdrant 清理一次性处理。

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

每个 revision 对应一个 `campus_docs_<摘要>` collection。Apply 只删除本数据库 current_index 上一次指向的
collection，不扫描删除其他 collection；本地开发实例共享 Qdrant，同名前缀的其他 collection 可能属于其他
worktree。staging 中旧 publisher 遗留的退休 collection 由运维核对 current_index 后显式删除。

## 相关文档

- [检索服务](../../architecture/system/retrieval-serving.md)
- [文档站架构](../../architecture/system/document-site.md)
- [文档来源与静态交付合同](../../contracts/document-reader-delivery.md)
- [文档阅读器数据模型](../../data/document-reader.md)
