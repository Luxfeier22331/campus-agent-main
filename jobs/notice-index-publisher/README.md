# Notice Chunk、Embedding 与本地评测

该包负责已发布且有正文通知的 Chunk Run、Embedding Set，以及本地结构验证、广泛抽样、问题生成和
Embedding dense-retrieval 评测。集群任务把正式制品写入 derived bucket；本包不直接发布 Qdrant
collection 或维护在线绑定，生产 serving 由 `jobs/campus-rag-index-publisher` 统一完成。

## 主链路

```text
已发布 notice 的 content_text
  -> Chunk Run
  ├-> Notice Embedding Set -> Campus RAG unified publisher
  └-> 本地问题生成、Embedding 抽样或 Recall 评测、两次结果对比
```

Chunk Run 是问题生成和 Embedding 评测的唯一正文输入；本地评测不是制品发布的前置步骤。

## 集群制品链路

集群使用两个默认暂停的 Job 模板，阶段之间只传递显式内容寻址 ID；完成后由统一 serving publisher
与 Docs Embedding Set 组装当前 collection：

```text
notice-chunk-builder
  -> notices/rag/chunk-runs/sha256/<run-id>/
  -> NOTICE_CHUNK_RUN=sha256:<run-id>
  -> notice-embedding-builder
  -> notices/rag/embedding-cache/<model-target-sha256>/sha256/<text-sha256>.json
  -> notices/rag/embedding-sets/sha256/<set-id>/manifest.json
  -> CAMPUS_NOTICE_EMBEDDING_SET
  -> campus-rag-index-publisher
```

`build-chunks` 在只读 repeatable-read 快照中读取 PostgreSQL，使用与本地相同的 v8 实现并写入 Chunk
Run。`build-embeddings` 只读取显式 Chunk Run，从 Model Config 的 `campus_docs_embedding` 槽位读取完整
连接，按 `retrievalText` 摘要去重。已有且通过校验的线上 cache 会复用，缺失输入才调用 Provider；每个
成功 batch 立即写入 cache，最终仍写入 `notice_embedding_set.v1`。两个阶段不自动串联，不维护 `latest`
指针，不写入 Qdrant 或通知数据库。统一 publisher 只读取该 Embedding Set 和其 Chunk Run，不连接 live
Notices DB，也不重新 embedding。

完整运行步骤见 [通知 Chunk 与 Embedding 制品](../../docs/runbooks/notice-indexing.md)。

## 构建 Chunk

任务在只读 repeatable-read 快照中选择：

```sql
SELECT notice_id::text, title, content_text
FROM notices.notices
WHERE is_published
  AND content_text IS NOT NULL
ORDER BY notice_id
```

`content_text` 已由 notice-publisher 从清洗后的 DOM 生成；Chunk 阶段不重新清洗正文，不读取
`content_html`、图片或附件。图片型、外链和 `content_text` 为空的通知不会产生 Chunk。

```bash
pnpm dev:init -- --target notice-index-publisher
pnpm --dir jobs/notice-index-publisher build-chunks-local
```

当前使用 `notice_text_structure.v8`；[通知数据](../../docs/data/notices.md#检索分块与制品)维护分块、
字段归属与正文边界，不在模块入口复制规则清单。

本地 Chunk Run 写入：

```text
var/notices/chunking/sha256/<run-digest>/
├── chunks.ndjson
├── manifest.json
├── review-samples.ndjson
└── validation.json
```

Chunk Run 使用 `notice_chunk_run.v1`。builder 在同一次 repeatable-read 快照中生成 Chunk、review sample
和 validation 诊断；统一 publisher 只消费 Chunk 数据，使用 `retrievalText` 首行生成 Notice title，并由
`noticeId` 生成 `/notices/<noticeId>` citation，不读取 live Notices DB。

## Chunk 抽样与验证

```bash
pnpm --dir jobs/notice-index-publisher review-chunks-local -- \
  --chunk-run sha256:<chunk-run-id>
```

广泛抽样覆盖短块、长块、近上限块、层级结构、列表、同章节边界、时间/联系方式密集和随机对照，产物位于
`var/notices/chunking/reviews/sha256/<chunk-run-id>/broad-sample-v2/`。自动候选信号只用于人工抽样定位，不是
单独的 Chunk 变更流程。

`notice_chunk_validation.v3` 在原有正文覆盖和章节边界检查之外，统计字段和值拆分、列表续行拆分、URL
归属拆分、表格表头上下文缺失和超长表格行拆分。它们是当前 Chunk Run 的诊断数据，不是发布门禁。

## 问题生成

Broad review sample 中的通知由模型各生成两道单事实问题。每道问题都应由一个 Chunk 独立回答；标题和正文
均来自 broad review 中与目标 Chunk Run 一致的 Chunk 数据。`notice_question_generation.v8` 让模型只返回
`question`、`answer` 和一个 `chunk_ref`，本地代码直接把所选 Chunk 的完整 `content` 作为唯一 evidence，
不再让模型生成正文行号或 evidence 范围。问题集合同的 `evidenceMode` 为 `selected-chunk-content`。

```bash
pnpm --dir jobs/notice-index-publisher generate-notice-questions-local -- \
  --chunk-run sha256:<chunk-run-id>
```

问题集产物写入：

```text
var/notices/chunking/question-sets/sha256/<question-set-run>/
├── manifest.json
├── questions.ndjson
├── targeted-questions.ndjson
└── validation.json
```

当前问题生成暂不处理名单、公示人选、候选人、录取、获奖或入选结果中的具体人员/条目问题；名单通知仍可
生成与通知主题、流程、要求或安排相关的问题。问题集是评测输入，不是人工 gold truth。

## Embedding 抽样与 Recall 评测

Embedding 使用 Chunk 的 `retrievalText`，问题使用固定 notice query instruction。Embedding 输入按文本
SHA-256 和模型 target 缓存：

```text
var/notices/chunking/embedding-cache/<model-target-sha256>/sha256/<text-sha256>.json
```

线上 Job 使用同样的内容寻址结构，但根路径为：

```text
notices/rag/embedding-cache/<model-target-sha256>/sha256/<text-sha256>.json
```

重跑 Embedding Job 会先校验并复用已完成的 cache；中途失败时已经写入的 batch 保留，下一次只处理缺失
输入。完成日志包含生成与复用数量：

```json
{"event":"result","embedding_count":12528,"generated_embedding_input_count":0,"reused_embedding_input_count":12528,"embedding_set":"sha256:<id>"}
```

如需把完整验证过的本地 cache 导入线上 derived bucket：

```bash
pnpm --dir jobs/notice-index-publisher import-embedding-cache-local -- \
  --chunk-run sha256:<chunk-run-id> \
  --model-target-sha256 <model-target-sha256> \
  --cache-directory var/notices/chunking/embedding-cache/<model-target-sha256>/sha256
```

该命令会先拒绝缺失、额外或无效文件，再上传 cache，不调用 Embedding Provider。

抽样验证：

```bash
pnpm --dir jobs/notice-index-publisher sample-embeddings-local -- \
  --chunk-run sha256:<chunk-run-id>
```

完整 dense retrieval 评测：

```bash
pnpm --dir jobs/notice-index-publisher evaluate-embeddings-local -- \
  --chunk-run sha256:<chunk-run-id> \
  --questions var/notices/chunking/question-sets/sha256/<question-set-run>/questions.ndjson
```

评测产物写入 `var/notices/chunking/embedding-evaluations/sha256/<run-digest>/`，包括 metrics、Top 10
ranking 和输入问题。Recall/MRR 只说明当前 Chunk 与共享 Embedding provider 的离线效果，不代表 Qdrant、
collection 组装、reranker 或在线 RAG 回答效果。

已有发布向量时可追加 `--embedding-set sha256:<id>`，复用完整向量而只生成问题 Embedding。
先把该 set 的 manifest 和它引用的 embeddings 对象按原对象键导出到 worktree `var/`，把对应
完整 Chunk Run（manifest、chunks、validation、review-samples）放到上述本地 chunking 目录。
命令要求 set 的 chunkRun 和 modelTargetSha256 与评测输入一致；缺失或错配直接报错，不静默
重算整库。评测 manifest 记录显式 set，生成/复用数反映实际调用。
使用固定问题、noticeId 和正文 evidence 分别看 Notice Recall、目标 Chunk Recall、答案证据
Recall 和 MRR；缺少标签或正文锚点是无效样本，不计为零召回。分层指标同时查看 questionCount，
singleChunkAnswerQuestionCount 为零时单块 Recall/MRR 及对比 delta 返回 null，表示不适用，不伪造 0 分。
真实来源问题和产物只保留在
忽略的 var，不提交受限通知正文。线上单次候选数和 rerank score 不可当作 Recall。

## 对比两次 Chunk 与 Embedding 结果

先使用同一份 `questions.ndjson` 分别评测 baseline 和 candidate，再运行：

```bash
pnpm --dir jobs/notice-index-publisher compare-chunks-local -- \
  --baseline-chunk-run sha256:<baseline-chunk-run> \
  --candidate-chunk-run sha256:<candidate-chunk-run> \
  --baseline-evaluation sha256:<baseline-evaluation-run> \
  --candidate-evaluation sha256:<candidate-evaluation-run> \
  --questions var/notices/chunking/question-sets/sha256/<question-set-run>/questions.ndjson
```

结果写入：

```text
var/notices/chunking/comparisons/sha256/<comparison-run>/comparison.json
```

对比文件包含 Chunk 数量、长度分布和 validation 诊断差异，文本证据 Recall/MRR 差异，以及每道问题的
证据落块和 rank 变化。证据落块只按 `noticeId + evidence.text` 在两次 Chunk 产物中定位，不复用旧
`chunkId`。该命令只产出离线对比数据，不设置阈值或阻断任何流程。

策略选择、v6→v8 同题集对照、扩大问题集结果及已接受限制见
[通知结构分块决策](../../.agents/notes/implemented/architecture/2026-08-31-notice-chunk-strategy.md)。
这些历史记录不表示当前数据集、线上索引或生产效果。

## 配置与验证命令

Chunk 构建使用本包 `.env.local` 的通知数据库配置。问题生成只需要当前 worktree 根 `.env` 中的
`LLM_BASE_URL`、`LLM_API_KEY` 和 `LLM_MODEL`；Embedding 评测只需要 `EMBEDDING_BASE_URL` 和
`EMBEDDING_API_KEY`。集群 Chunk Job 使用现有通知数据库连接与 derived bucket 写入身份；集群
Embedding Job 使用 derived bucket 写入身份和 `MODEL_CONFIG_URL`。

```bash
pnpm --dir jobs/notice-index-publisher typecheck
pnpm --dir jobs/notice-index-publisher test
pnpm --dir jobs/notice-index-publisher build
```
