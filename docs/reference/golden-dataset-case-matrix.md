---
doc_type: reference
status: active
created: 2026-03-29
updated: 2026-04-03
---

# Golden Dataset Case Matrix

## 目的

本文负责把 `student_handbook` 与 `curriculum_plan` 当前 golden dataset 覆盖面整理成可查阅矩阵，明确哪些 lane 已覆盖，哪些仍是部分覆盖，哪些尚未进入 canonical case 集。

边界：

- 本文记录的是当前 repo-tracked case coverage，不直接替代 qrels fixture、workflow case 定义或 live gate artifact
- retrieval 数值快照仍分别以 `docs/reference/student-handbook-eval-metrics.md` 与 `docs/reference/curriculum-plan-eval-metrics.md` 为准
- live 重跑步骤仍以各自 runbook 为准

状态标记：

- `covered`：当前 repo 中已有明确、可追踪的 canonical case 覆盖
- `partial`：已有样本，但覆盖深度、禁止样本、版本语义或 split 编组仍不足
- `missing`：当前 repo 内尚无明确 canonical case 覆盖

## 共同覆盖轴

当前两个 corpus 的 matrix 统一按以下 lane 观察：

- retrieval
  - title / article exact-match
  - sparse fixed phrase
  - dense semantic paraphrase
  - short fact
  - table / structured evidence
  - no-hit fail-close
  - forbidden-source disambiguation
  - version-sensitive retrieval
- workflow
  - completed
  - needs_clarification
  - no_answer
  - error
- answer / trace
  - required facts
  - forbidden claims
  - citation completeness
  - retrieval called / not called
  - fail-closed

## Student Handbook

### Retrieval Matrix

| Lane | Status | Current evidence | Notes |
| --- | --- | --- | --- |
| article-number exact-match | covered | qrels: `article-number-degree-procedure`, `article-number-student-status` | 条款号命中已进入 handbook canonical qrels。 |
| policy-title exact-match | covered | qrels: scholarship / loan / medical title cases | 标题命中是 handbook 当前最稳定 lane。 |
| sparse fixed phrase | covered | qrels: dormitory-lighting / electrical-appliance / medical-reimbursement | 已明确承担 sparse 检索稳定性回归。 |
| dense semantic paraphrase | covered | qrels: degree-application / scholarship-eligibility / student-card-reissue | 已覆盖多种自然问法，但仍偏少。 |
| short fact | covered | `short-fact-attendance-discipline-threshold` | handbook 已有稳定的制度短事实 qrels。 |
| table / structured evidence | partial | `structured-disciplinary-relief-materials` | 已进入 list-like structured evidence，但仍缺表格级 canonical case。 |
| no-hit fail-close | covered | qrels: impossible-query / nonexistent-visa | handbook no-hit lane 已形成 deterministic 基线。 |
| forbidden-source disambiguation | covered | qrels: `policy-title-national-encouragement-scholarship`, `semantic-disciplinary-relief`, `structured-disciplinary-relief-materials`；release-gate `student-card` / `medical-title` | handbook 已有多条 canonical forbidden-source 样本。 |
| version-sensitive retrieval | covered | `policy-title-medical`, `semantic-student-card-reissue` | 已有选定高风险 case 锁到 `doc_id + version_id`。 |

### Workflow / Answer Matrix

| Lane | Status | Current evidence | Notes |
| --- | --- | --- | --- |
| completed | covered | `handbook_release_gate_cases()` 4 条 completed | 已有稳定 fixed cases。 |
| needs_clarification | covered | `release-gate-needs-clarification` | 该 lane 已要求 `retrieval_called=false`。 |
| no_answer | covered | `release-gate-no-answer` | 已绑定 fail-close expectation。 |
| error | covered | `handbook_error_gate_cases()` 3 条 | 通过 deterministic 故障注入覆盖。 |
| required facts | covered | release-gate completed cases | 已用于 deterministic answer gate。 |
| forbidden claims | covered | release-gate completed cases | 当前 denominator 仍小，但语义已固定。 |
| citation completeness | covered | handbook live release-gate summary | 当前 handbook gate 已显式计入 citation completeness。 |
| explicit smoke workflow set | covered | `handbook_smoke_cases()` 4 条稳定 fixed cases | 已显式覆盖 `completed`、`no_answer`、`needs_clarification`。 |
| explicit regression_locked workflow set | covered | `handbook_regression_locked_cases()` 5 条高风险 fixed cases | 已形成 handbook 常设高风险 workflow 集。 |

## Curriculum Plan

### Retrieval Matrix

| Lane | Status | Current evidence | Notes |
| --- | --- | --- | --- |
| title exact-match | covered | ethnology / digital-economy / general-english / innovation / minority-strong-base / hanyu-international title qrels | curriculum 标题命中已形成主基线，并扩到国际学生版本和中国少数民族语言文学强基版本。 |
| same-major / path disambiguation | covered | `history-strong-base-title`, `minority-language-strong-base-title`, `hanyu-international-students-title`, `law-ethnic-experimental-total-credits` | 已覆盖相邻专业、培养路径与普通版/国际学生版区分。 |
| sparse fixed phrase | covered | qrels/hybrid: `minority-language-strong-base-fixed-phrase` | canonical baseline 现在已有唯一 grounding 的 sparse fixed-phrase 样本；`民族实验班` 仍按 clarification 治理。 |
| dense semantic paraphrase | covered | `digital-economy-plan-paraphrase`, `semantic-philosophy-strong-base-paraphrase`, `semantic-minority-language-strong-base-paraphrase` | 已补足更自然的跨表述问法，并扩到中国少数民族语言文学强基路径。 |
| short fact | covered | ethnology-second-degree-academic-years / ethnology-total-credits / minority-language-total-credits / education-second-degree-academic-years / hanyu-international-students-total-credits | 已进入 qrels，并扩到国际学生版本与教育学第二学士学位。 |
| table / structured evidence | covered | economics-course-settings-table / fiscal-course-settings-table | curriculum table retrieval 已不再依赖课程地图 topology case，而是聚焦仍在业务范围内的课程设置表格样本。 |
| no-hit fail-close | covered | impossible-query / nonexistent-program | 已具备 deterministic 基线。 |
| forbidden-source disambiguation | covered | `history-strong-base-title`, `minority-language-strong-base-title`, `semantic-minority-language-strong-base-paraphrase`, `hanyu-international-students-title`, `hanyu-international-students-total-credits`, `philosophy-strong-base-title`, `digital-economy-plan-paraphrase`, `general-english-total-credits`, `semantic-philosophy-strong-base-paraphrase` | curriculum 已形成更完整的 canonical forbidden-source 样本集。 |
| version-sensitive retrieval | covered | `minority-language-strong-base-title`, `digital-economy-plan-paraphrase`, `general-english-total-credits`, `hanyu-international-students-total-credits`, `education-second-degree-academic-years`, `fiscal-course-settings-table` | 已有 6 条选定高风险 case 锁到 `doc_id + version_id`。 |

### Workflow / Answer Matrix

| Lane | Status | Current evidence | Notes |
| --- | --- | --- | --- |
| completed | covered | `curriculum_release_gate_cases()` 11 条 completed | 已覆盖标题、学制、总学分、课程设置/修读建议、course-family 与 program-family completed，并包含 course-family alias 变体、单课 schedule、`强基计划` full alias 与显式 `名称里带实验班` name-pattern 问句。 |
| needs_clarification | covered | `curriculum-release-gate-needs-clarification`, `curriculum-regression-needs-clarification-ethnic-experimental-class` | 现已同时覆盖跨语料模糊问法与 retrieval-informed title ambiguity。 |
| no_answer | covered | `curriculum-release-gate-no-answer`, `curriculum-release-gate-course-map-unsupported` | 已绑定 fail-close expectation，并显式覆盖课程地图 topology query 不可答边界。 |
| error | covered | `curriculum_error_gate_cases()` 3 条 | 通过 deterministic 故障注入覆盖。 |
| required facts | covered | 学制、学分、课程设置等 fixed cases | curriculum answer truth 已比 handbook 更接近结构化事实校验。 |
| forbidden claims | covered | release-gate completed cases | 当前已防止误答成 handbook 内容。 |
| citation completeness | covered | `curriculum-workflow-status-summary.json` 已给出 `citation_completeness = 4/4 pass`，repo-tracked deterministic gate 也已存在 | 当前剩余问题不是有没有 citation gate，而是要不要继续把更多 family-aware completed answer 扩进 denominator。 |
| explicit smoke workflow set | covered | `curriculum_smoke_cases()` 10 条稳定 fixed cases | 已显式覆盖 `completed`、`no_answer`、`needs_clarification`，并把 program-family membership 扩到 `民族班`、`民族实验班`、`创新班`、`强基` 与 `第二学士学位` full alias。 |
| explicit regression_locked workflow set | covered | `curriculum_regression_locked_cases()` 35 条高风险 fixed cases | 已形成 curriculum 常设高风险 workflow 集，并把 course-family、course-family schedule、course schedule partial-answer、program-family、program-family full alias、显式 name-pattern query 与 deictic clarification lane 一起纳入。 |

## Current Cross-Corpus Gaps

当前两个 corpus 共同存在的高优先级缺口：

- handbook 的 structured evidence 仍只有 list-like 样本，尚未进入表格级 canonical case
- curriculum 的 citation completeness 已有 live artifact，但 family-aware completed 与更长尾 curriculum answer truth 仍可继续扩样
- synthetic placeholder 与 canonical fixed cases 的分层还需要进一步收口

补充说明：

- `民族实验班` 相关问题现在不再被解释成“继续优化 retrieval 排序”；canonical truth 已改为 fast-fail qrels governance + clarification workflow

## Immediate Priority

按当前价值排序，下一步应优先补：

1. handbook 的表格级 structured evidence case
2. curriculum answer truth / citation completeness 的继续扩样
3. curriculum 长尾 alias 与 additional sparse fixed-phrase retrieval case 的继续扩样
