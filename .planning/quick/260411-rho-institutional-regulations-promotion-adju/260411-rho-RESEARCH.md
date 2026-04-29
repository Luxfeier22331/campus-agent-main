# Quick Task 260411-rho Research

**Task:** 结合 repo 当前 truth 与官方资料，修正 `institutional_regulations` promotion adjudication 的粗粒度判据，并重评 Cohort A manual-review 样本。
**Gathered:** 2026-04-11
**Status:** complete

## Repo Boundary

- `campus_notices/internal_notice` 是 source-channel triage collection，不是长期规章 owner。
- `regulations/institutional_regulations` 只收 canonical regulation text。
- 当前 repo-local 目标不是写 Postgres/Qdrant，也不是发 release，而是把 promotion taxonomy 和 manual-review 理由修正到可执行 truth。

## Official Inputs

### Azure AI Search

- 文档结构化切分应优先按标题、章节、段落等结构，而不是只依赖固定窗口：
  - https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-chunk-documents
- freshness 是 scoring profile 的一类打分函数；日期/时效更适合作为显式 metadata + ranking/filter signal，而不是 validity truth 本身：
  - https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles
- filterable fields 需要作为显式 schema 字段建模：
  - https://learn.microsoft.com/en-us/azure/search/search-how-to-create-search-index

### Google Cloud Document AI

- classification / logical split / downstream processing 应分阶段执行，而不是一次性混判：
  - https://cloud.google.com/document-ai/docs/custom-splitter

## Corrected Conclusions

### 1. 年龄不是排除条件

- 校内制度文本不因发布时间老旧自动降权或排除。
- 是否进入 `institutional_regulations`，要看 document nature、正文语义、wrapper 边界、以及是否存在显式 temporary/sunset semantics。

### 2. `暂行/试行` 不是自动 manual-review signal

- `暂行/试行` 只能说明 `force_status` 可能是 `provisional_in_force`，不能直接等价于 draft、expired 或不应收录。
- 真正应排除的是正文内出现的显式临时/过渡语义，例如：
  - `正式运营前`
  - `正式运营后取消`
  - `临时医疗点`

### 3. 当前 10 条 manual-review 应拆成两类

- `annual_cycle_rule`
  - 年度/项目制招生、推免、硕博连读、英才计划实施细则
- `time_bound_operational_rule`
  - 假期期间规则
  - 显式过渡运营规则

### 4. `191705` 的正确判断不是“因为暂行所以排除”

- `191705 / 重要通知--中央民族大学丰台校区就医管理办法（暂行）` 继续不进 `institutional_regulations`，但原因应改成：
  - 正文含 `临时医疗点`
  - 正文含 `校医院正式运营前`
  - 正文含 `正式运营后取消`
- 也就是说，它是被正文里的 transition/sunset semantics 排除，而不是被 `暂行` 这个标题词单独排除。

## Repo-Local Implementation Direction

- 代码层：
  - 移除把 `暂行/试行` 直接当成 negative signal 的粗规则
  - 把 admissions/program-cycle 与 explicit temporary operations 拆成独立 signal
- 文档/配置层：
  - 明确 `document age` 不是 standalone exclusion signal
  - 明确 `provisional title != draft/expired`
  - 把 `document_nature`、`force_status`、`default_query_policy` 落到 config scaffold 和 adjudication artifact
