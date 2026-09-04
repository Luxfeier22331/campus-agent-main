# Notice Chunk、Embedding 与本地评测

该包负责已发布且有正文通知的 Chunk Run、Embedding Set，以及本地结构验证、广泛抽样、问题生成和
Embedding dense-retrieval 评测。集群任务把正式制品写入 derived bucket；当前不发布 Qdrant
collection，也不提供在线 RAG 消费入口。

## 主链路

```text
已发布 notice 的 content_text
  -> Chunk Run
  -> 问题生成（直接消费 Chunk Run）
  -> Embedding 抽样或 Recall 评测
  -> 两个 Chunk Run 的离线对比
```

Chunk Run 是问题生成和 Embedding 评测的唯一正文输入。

## 集群制品链路

集群使用两个默认暂停的 Job 模板，阶段之间只传递显式内容寻址 ID：

```text
notice-chunk-builder
  -> notices/rag/chunk-runs/sha256/<run-id>/
  -> NOTICE_CHUNK_RUN=sha256:<run-id>
  -> notice-embedding-builder
  -> notices/rag/embedding-sets/sha256/<set-id>/manifest.json
```

`build-chunks` 在只读 repeatable-read 快照中读取 PostgreSQL，使用与本地相同的 v8 实现并写入 Chunk
Run。`build-embeddings` 只读取显式 Chunk Run，从 Model Config 的 `campus_docs_embedding` 槽位读取完整
连接，按 `retrievalText` 摘要去重并写入 `notice_embedding_set.v1`。两个阶段不自动串联，不维护
`latest` 指针，不写入 Qdrant 或通知数据库。

完整运行步骤见 `docs/runbooks/notice-indexing.md`。

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

当前选定的稳定定义为 `notice_text_structure.v8`：Unicode 字符数目标 800、硬上限 1200、无 overlap。
结构和字段关系优先于长度：

- 正式一级/二级标题形成边界；带值、完整叙述或指令语义的括号序号行不作为二级标题；
- 直接位于章节正文中的括号事实列表按同级项拆分，流程/办理步骤列表及条件父项下的嵌套列表保持为一个语义单元；
- 独立事实列表仍保留同级项的语义边界；同一章节内连续且每项少于 120 个 Unicode 字符的简单短项，
  在不含二级嵌套列表、且不超过目标长度和硬上限时允许合并；较长或结构复杂的列表项仍单独成块；
- 列表项吸收其后属于该项的字段值、时间、地点、联系方式、URL 和说明，直到下一个同级项或明确结构边界；
- 条件说明父项只吸收自己的嵌套条件项，不吞并后续同级项；标签型父项与其嵌套值保持在同一语义单元；
  字段标签下的经历、说明列表保持字段组整体，不按编号层级拆分；
- 连续字段的标签、值和 URL 保持归属；长扫码、报送说明不会仅因 `（一）` 开头而被误判为章节标题；
- `姓名：` 包括暂时没有姓名值的形式都可开启人物记录；
- 序号名单表、分值/标准表、主队/客队赛制表、节次时间表按逻辑行构造；表头上下文只加入
  `retrievalText`，不写入 `content` 或对外 `headingPath`；
- `retrievalText` 不向每个列表 Chunk 重复注入通知导语；拆开的嵌套列表值只补充其直接父项上下文，表格行
  只补充表头上下文，这些检索上下文均不写入 `content` 或对外 `headingPath`；
- 图片占位符和图片 `alt` 不进入 Chunk 或 Embedding，正文中的简短图片/二维码说明附着相邻语义单元，
  不单独形成低信息量 Chunk；
- 供稿、审核等编辑署名以及尾部组织、日期附着正文尾部；表格后的 footer 使用普通 footer part，不标记为
  表格行；超长单行仍按句末、分句标点和硬上限拆分。

本地 Chunk Run 写入：

```text
var/notices/chunking/sha256/<run-digest>/
├── chunks.ndjson
├── manifest.json
├── review-samples.ndjson
└── validation.json
```

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

当前扩大问题集为
`sha256:c583208dc9053525b910f0b2e94eda96f86ea0e092a081a0ade64bb10bb10f76`：覆盖 broad review 的
350 条通知和 2569 个 Chunk，每条通知恰好两题，共 700 题；每题恰好选择一个完整 Chunk evidence，
invalid 和 unanchored evidence 均为 0。700 题覆盖 610 个唯一目标 Chunk，90 条通知的两题选择了同一
Chunk；另有 2 组完全相同的问题，均来自重复或相邻阶段通知，属于后续问题生成质量观察。

## Embedding 抽样与 Recall 评测

Embedding 使用 Chunk 的 `retrievalText`，问题使用固定 notice query instruction。Embedding 输入按文本
SHA-256 和模型 target 缓存：

```text
var/notices/chunking/embedding-cache/<model-target-sha256>/sha256/<text-sha256>.json
```

抽样验证：

```bash
pnpm --dir jobs/notice-index-publisher sample-embeddings-local -- \
  --chunk-run sha256:<chunk-run-id>
```

当前扩大抽样产物为
`sha256:971c087f9672cde7099165d0977f230eb952ccf1ee7e7e81dbae487c72aa2fb9`：从 3924 个 Chunk 中按长度、
标题层级、导语、边界对和随机对照等分层选择 400 个 Chunk；400 个 Embedding 缓存全部存在，向量维度均为
2560，模型为 `Qwen3-Embedding-4B`。

完整 dense retrieval 评测：

```bash
pnpm --dir jobs/notice-index-publisher evaluate-embeddings-local -- \
  --chunk-run sha256:<chunk-run-id> \
  --questions var/notices/chunking/question-sets/sha256/<question-set-run>/questions.ndjson
```

评测产物写入 `var/notices/chunking/embedding-evaluations/sha256/<run-digest>/`，包括 metrics、Top 10
ranking 和输入问题。Recall/MRR 只说明当前 Chunk 与共享 Embedding provider 的离线效果，不代表 Qdrant、
collection 组装、reranker 或在线 RAG 回答效果。

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

此前 v8 与 v6 基线使用同一份 350 道问题的问题集和同一真实 `Qwen3-Embedding-4B` provider 完成对照；
全部问题都能在两个版本中定位到单 Chunk evidence，missing evidence 为 0：

| 版本 | Chunk 数 | 极短 Chunk（<120） | Recall@1 | Recall@3 | Recall@5 | Recall@10 | MRR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v6 | 3865 | 1925 | 0.811429 | 0.954286 | 0.977143 | 0.991429 | 0.886816 |
| v8 | 3924 | 1882 | 0.814286 | 0.962857 | 0.982857 | 0.991429 | 0.892078 |

v6→v8 的 Recall@1/@3/@5/@10 分别变化 +0.002857/+0.008571/+0.005714/+0.000000，MRR 变化
+0.005262。v8 的 754 条通知全量 Chunk Run 另抽样审阅了 178 条通知；未发现表格行拆分、表头上下文
缺失、章节越界、非正式 `headingPath` 或 hard cut。相对 v7，列表续行拆分诊断从 75 降到 66，已确认
条件父项边界、标签父项归属和重复通知导语问题得到修复。当前选定 v8 作为 notice 的稳定本地 Chunk
策略，不再继续此前的局部规则实验。

对应产物：Chunk Run `sha256:87b98fabaf78009e119be7ef8ea84980dfb25bc6f48824cc297dd43a0111cef5`，
Embedding Evaluation `sha256:6eda19d5e6096f0bc25c78d503e2a05c2135c330019f62a0960fd42747c5424c`，
v6→v8 Comparison `sha256:9cc8c946629eb2921fc7e6980e4edcf1c1d02c1768ab1e4a0a2bd4565a5e8b9f`。

## 扩大问题集的 Recall 结果

当前 v8 使用上述 700 道新问题对全部 3924 个 Chunk 完成真实 Embedding 检索，评测产物为
`sha256:546c9dd2b8780d43098383243bc9b2875d3c473e7e6d64cc6cf50794b0abc849`：

| 问题数 | Chunk 数 | Recall@1 | Recall@3 | Recall@5 | Recall@10 | MRR | Notice Recall@1 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 700 | 3924 | 0.810000 | 0.955714 | 0.978571 | 0.991429 | 0.883738 | 0.925714 |

567 题的目标 Chunk 排名为 1，102 题排名为 2–3，16 题排名为 4–5，9 题排名为 6–10，6 题在 Top 10
之外。31 个 Recall@3 未命中中，16 个是同一通知的兄弟 Chunk 排在目标 Chunk 前，15 个是跨通知竞争。
当前接受的限制是：

- 7–21 字的时间、地点等极短独立字段块容易被同通知中信息更完整的导语或兄弟块压过；
- 600–899 字且包含多个主题的 Chunk 容易稀释局部事实，该长度区间 44 题的 Recall@3 为 0.863636；
- 重复通知和同一事项的不同阶段通知会竞争，例如首次/二次公告、报名通知/结果公示、开课通知/后续提醒；
- 少数问题的目标 Chunk 并不唯一，或问题措辞与正文字段不完全一致，属于问题集质量而不是 Chunk 排名退化。

这些极短事实块、多主题长块和重复通知竞争已经过逐题抽样确认；继续增加局部合并或聚焦规则的整体收益
不足以抵消结构退化，因此不再触发本轮 Chunk 策略扩展。

这份 700 题问题集由新的 `selected-chunk-content` 合同生成，不能与上面的旧 350 题指标当作严格同题集
前后对比；旧结果只用于 v6→v8 的受控策略对照，新结果作为当前扩大验证基线。两组结果都只证明本地
Chunk、真实 Embedding 和离线 dense retrieval 效果；尚未验证 Qdrant collection、在线 RAG 或生产运行。

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
