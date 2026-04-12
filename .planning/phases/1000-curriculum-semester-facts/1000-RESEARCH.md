# Phase 1000: Curriculum 结构化证据契约与 Semester Facts 修复 - Research

**Researched:** 2026-04-12
**Domain:** curriculum structured retrieval, evidence contracts, semester-table materialization, eval and observability boundaries
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Retrieval / source contract

- `program_semester_facts` 保持为 `curriculum_plan` 选中 scope 下的 internal specialist retrieval surface，不回退为直接使用原始大文档作为 semester follow-up 的唯一 support source。
- eval、citation、observability 需要区分：
  - 真实命中的物理 source / projection unit
  - 面向产品与 operator 的 canonical curriculum source identity
- raw retrieval candidate truth 与 final supporting evidence truth 必须分开上报；不能继续把最终 answer evidence 伪装成完整 retrieval trace。

#### Structured curriculum query path

- `课程地图`、`课程设置`、`修读建议` 归入结构化 curriculum lookup，而不是 generic `procedure`。
- `课程地图怎么安排` 的正确完成态依赖同一培养方案内多个互补 chunk；不能允许首 source 命中后提前截断导致关键信息缺失。
- 修复应落在 specialist planning / answer shaping 与 retrieval evidence coverage policy，不应把 alias / intent 语义下沉到 retrieval backend 黑盒字符串替换。

#### Semester facts materialization

- `program_semester_facts` projection 必须改成 position-preserving table extraction。
- HTML / OCR table parsing 需要优先复用 repo 现有的 table cell / matrix utilities，而不是继续在该 projection 内维护一套弱化版表格解析。
- merged cells、blank leading cells、continued rows 不能通过“过滤空 cell”绕过；空 cell 在 projection 层具有列占位语义。

#### Verification / release gate

- 本 phase 完成时，release-gate 需要明确区分：
  - source-contract drift
  - materialization data loss
  - answer-shaping coverage loss
- deterministic eval 应以 canonical source identity + required claim coverage 为主，而不是把某个 internal projection doc id 与某个旧 source doc id 强行当作同一层 truth。

### Claude's Discretion

None. `1000-CONTEXT.md` does not define a `Claude's Discretion` section.

### Deferred Ideas (OUT OF SCOPE)

- 不在本 phase 内扩大 curriculum serving surface
- 不在本 phase 内引入新的课程数据源，例如 offering unit / 开课学院
- 不在本 phase 内执行全量 rerun / 全量重建所有 curriculum collection；只在修复完成后按需要重物化受影响的 `program_semester_facts`
</user_constraints>

## Summary

这个 phase 需要修 4 个已经在当前 merged truth 内暴露出来、但边界混在一起的问题：`program_semester_facts` 物理命中与 canonical curriculum source identity 的 contract drift、semester facts projection 对 merged/sparse table 的数据丢失、`课程地图/课程设置/修读建议` 这类结构化 curriculum query 被错误落到 generic `procedure` 并在 answer shaping 时丢失互补 chunk、以及 live eval / app-api observability 把 raw retrieval 和 final support 合并成单一 truth。当前 repo 文档已经冻结了两个关键边界：`program_semester_facts` 继续只是 `curriculum_plan` 下的 internal surface，alias / intent owner 继续在 `rag-specialist`，不能回退到 backend 黑盒替换，也不能借机重开 serving surface 讨论。

官方资料给出的当前实践和 repo 需要的修法高度一致。LlamaIndex 的 response synthesizer 与 citation engine 将 “多 retrieved chunks 的 answer synthesis” 和 “citation chunk granularity” 建模成独立 concern；Ragas 的样本 schema 直接把 `retrieved_contexts`、`reference_contexts`、`response` 分开；OpenInference 和 OpenTelemetry 把 retriever、reranker、evaluator、LLM 调用区分成不同 span kind / operation；Google Document AI 与 Azure 的 table model 都把 table 真相定义为带 row/column/span 语义的 cell/grid，而不是字符串行数组。也就是说，当前 repo 不是缺一个更“聪明”的 reranker，而是缺把这些边界按对的层次落回现有 contract。

本 phase 的最佳路线不是换栈，也不是加公开 surface，而是在现有边界上补齐三层 truth：物理 retrieval unit、canonical curriculum source identity、final answer-supporting citations；同时把 semester facts projection 改成 span-aware、position-preserving materialization；再把 eval 和 operator observability 改成能够独立指出“retriever 没拿到”“support selection 丢了”“answer composer 提前截断”“projection 本身缺课”。这样 planner 可以把实现拆成 contract、specialist shaping、materialization、observability 四块，而不是继续用 golden patch 掩盖真实 drift。

**Primary recommendation:** 保持 `program_semester_facts` 作为 internal physical retrieval truth，在 evidence / diagnostics / observability 中新增 canonical curriculum source identity 并拆分 raw retrieval candidates 与 final supporting evidence，把 `课程地图/课程设置/修读建议` 升级为 structured curriculum path，同时用 `source_truth_common` 的 span-aware table utilities 重做 semester facts materialization。

## Standard Stack

### Core

| Library / Spec | Version | Purpose | Why Standard |
|---|---|---|---|
| `llama-index-core` | repo `>=0.14.18`; PyPI current `0.14.20` (2026-04-03) | response synthesis and citation shaping for multi-node answers | repo 已在用；官方文档明确支持 `refine` / `compact` 这类多 chunk synthesis，而不是 top-1 摘录 |
| `llama-index-vector-stores-qdrant` | repo `>=0.10.0`; PyPI current `0.10.0` (2026-03-12) | Qdrant integration boundary for current retrieval stack | 当前 backend 已稳定存在，不需要为这个 phase 更换 vector stack |
| `qdrant-client` | repo `>=1.17.1` | filtered retrieval over physical projection units | 当前 backend 已有 preferred / target document bias；phase 需要修 contract，不需要替换 store |
| `ragas` | repo `>=0.4.3` | evaluation schema and retrieval-vs-answer metric boundary | 当前 eval package 已在用，且官方 schema 正好要求分开 `retrieved_contexts`、`reference_contexts`、`response` |

### Supporting

| Library / Spec | Version | Purpose | When to Use |
|---|---|---|---|
| OpenInference semantic conventions | spec checked 2026-04-12 | retriever / reranker / evaluator / llm span taxonomy and document attrs | 设计 runtime / eval trace schema、为 app-api observability 定义语义字段时使用 |
| OpenTelemetry GenAI semantic conventions | semconv `1.40.0`, checked 2026-04-12 | LLM inference, retrieval, token, cost, conversation attributes | 设计 supervisor / app-api 的 model-call 和 retrieval-call span 边界时使用 |
| `campus_ingestion_core.source_truth_common` | repo local | position-preserving HTML/OCR table cell extraction and grid reconstruction | 所有 `program_semester_facts` table materialization 都应直接复用，不再自写弱化版 parser |
| `vitest` | app-api repo baseline `^4.1.0` | worker-side request observability and persistence tests | 验证 app-api trace / store schema 变更时使用 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| 单一 `EvidenceBundle.sources` 同时承担 retrieval trace 与 answer support | raw retrieval list + support subset + canonical citation fields | schema 传播面更大，但这是唯一能把 contract drift 与 answer-shaping drift 分开的做法 |
| `program_semester_facts_projection.py` 内 ad hoc `<td>` / `|` 解析 | `source_truth_common` 的 span-aware cell/grid helpers | 改动更结构化，但能一次性修 merged/sparse/continued-row 问题 |
| generic `procedure` mode 兜底所有“怎么/如何”问句 | structured curriculum intent with coverage-aware support policy | 需要补路由规则和 answer composer，但能避免多 chunk 课程地图问答退化成单 chunk 摘录 |

**Installation:**

```bash
uv sync --all-packages --dev
pnpm install
```

No new mandatory dependency is required to complete this phase. If you add tracing exporters later, keep them at the app boundary; do not couple contract repair to a stack swap.

**Version verification:** Checked official package pages on 2026-04-12. Verified current release numbers for `llama-index-core` (`0.14.20`) and `llama-index-vector-stores-qdrant` (`0.10.0`). `qdrant-client` and `ragas` are already pinned at repo baselines that satisfy this phase; no phase-specific upgrade is required unless implementation hits a reproducible library bug.

## Architecture Patterns

### Recommended Project Structure

```text
packages/contracts/          # EvidenceSource / diagnostics / observability schema changes
packages/rag-specialist/     # structured curriculum intent, answer shaping, canonical source mapping
packages/retrieval-core/     # raw ranking vs support selection policy, no alias ownership move
packages/ingestion-core/     # semester facts table materialization over span-aware grids
packages/evals/              # deterministic eval, observed trace, live benchmark expectations
apps/app-api/                # operator-facing observability persistence and request trace projection
tests/                       # regression coverage for curriculum, ingestion, eval, observability
```

### Pattern 1: Two-Tier Evidence Truth

**What:** Keep raw retrieval candidates immutable, then derive a final answer-supporting subset without overwriting the raw list. Add canonical curriculum identity on top of the physical projection identity instead of replacing it.

**When to use:** All structured curriculum queries, all live eval traces, and all app-api request observability writes.

**Repo-level recommendation:**

- Extend evidence-level serialization with optional canonical fields such as `canonical_source_id`, `canonical_source_title`, `source_parent_document_id`, `source_unit_kind`, `source_unit_key`.
- Preserve the physical identity fields already in use: `doc_id`, `chunk_id`, `collection`, score, structural path.
- Add explicit raw retrieval collections to diagnostics/observability instead of relying on a post-selection `EvidenceBundle`.
- Keep citations chunk-level for grounding; canonical identity is for operator/eval truth, not a replacement for chunk provenance.

**Example:**

```python
# Recommended repo pattern, adapted from Ragas sample separation and OpenInference retriever/reranker semantics.
@dataclass(frozen=True)
class EvidenceTrace:
    retrieved_candidates: tuple[EvidenceSource, ...]
    supporting_sources: tuple[EvidenceSource, ...]
    canonical_citations: tuple[CanonicalCitation, ...]


supporting_sources = select_supporting_evidence_sources(...)
trace = EvidenceTrace(
    retrieved_candidates=retrieved_candidates,
    supporting_sources=supporting_sources,
    canonical_citations=build_canonical_citations(supporting_sources),
)
```

Source: Ragas evaluation schema, OpenInference semantic conventions, and LlamaIndex citation engine.

### Pattern 2: Structured Curriculum Query Path Above Generic Procedure

**What:** Queries like `课程地图怎么安排` should be resolved as curriculum-structure lookups, not procedural advice. The routing decision belongs in `rag-specialist`, not in the retrieval backend.

**When to use:** Queries targeting curriculum structure, course-map composition, semester arrangement, and repair cases where multiple complementary chunks from one plan are required.

**Repo-level recommendation:**

- Add structured curriculum cues for `课程地图` / `课程设置` / `修读建议` / `培养方案怎么安排`.
- Ensure `query_mode` prefers structured curriculum lookup over `procedure` when the query also resolves a curriculum entity.
- Replace first-source early stop for these intents with a coverage-aware support policy: require multiple complementary rows/chunks until the claim set is satisfied.
- Keep alias and intent interpretation in `curriculum_query_resolution.py` and `rag-specialist`, not in `backend_qdrant.py`.

**Example:**

```python
# Recommended repo pattern inspired by LlamaIndex multi-node synthesis.
if curriculum_intent in {"course_map", "course_structure", "study_advice"}:
    retrieved = retrieve_sources(...)
    support = select_curriculum_coverage_support(
        retrieved,
        min_distinct_claim_groups=2,
        allow_same_document_multi_chunk=True,
    )
    return compose_curriculum_structured_answer(support)
```

Source: LlamaIndex response synthesizers and citation engine.

### Pattern 3: Position-Preserving Semester Facts Materialization

**What:** Treat curriculum tables as cell grids with explicit row/column/span semantics. Empty leading cells are structural placeholders, not noise.

**When to use:** All `program_semester_facts` materialization from HTML/OCR tables, especially semester plans with merged headers, blank-leading rows, or continued rows.

**Repo-level recommendation:**

- Parse HTML and OCR tables into cell objects first.
- Reconstruct a dense grid that preserves row/col positions and spans.
- Only then resolve semester columns, course-title columns, and continued rows.
- Re-materialize only affected `program_semester_facts` artifacts after the projection fix; do not trigger a full curriculum rebuild in this phase.

**Example:**

```python
# Recommended repo pattern using existing local utilities.
cells = extract_html_table_cells(table_html)
grid = extract_html_table_grid(cells)
rows = normalize_table_grid(grid, preserve_empty_cells=True)
semester_rows = project_program_semester_facts(rows)
```

Source: Google Document AI / Azure table models and local `source_truth_common.py`.

### Pattern 4: Bounded Observability with Explicit Failure-Layer Separation

**What:** app-api and eval artifacts should record enough structure to tell whether failure happened in retrieval, support selection, citation shaping, or answer composition. Counts alone are not enough.

**When to use:** `SupervisorObservability`, app-api request observability persistence, live benchmark observed traces, release-gate rerun artifacts.

**Repo-level recommendation:**

- Persist bounded arrays of retrieved/supporting/canonical identifiers plus counts.
- Store `doc_id`, `chunk_id`, score, collection, canonical id/title, and perhaps a short title summary or snippet hash.
- Do not persist full retrieved chunk contents in request observability tables by default; use eval artifacts for richer text when needed.
- Model tracing boundaries as: retriever span -> reranker/support-selection span -> LLM/answer span -> evaluator span.

**Example:**

```json
{
  "retrievedCandidates": [
    {"docId": "program_semester_facts:...:semester-4", "chunkId": "chunk-0013", "score": 0.91}
  ],
  "supportingSources": [
    {"docId": "program_semester_facts:...:semester-4", "chunkId": "chunk-0013"}
  ],
  "canonicalSources": [
    {"canonicalSourceId": "curriculum:历史学（强基计划）本科人才培养方案"}
  ]
}
```

Source: OpenInference semantic conventions, OpenTelemetry GenAI retrieval spans, Ragas evaluation schema.

### Anti-Patterns to Avoid

- **Overwriting retrieval truth with support truth:** Do not let `_build_supporting_evidence()` become the only surviving evidence list for evals and observability.
- **Backend-owned alias magic:** Do not push `课程地图` / alias intent handling into `backend_qdrant.py` string rewriting.
- **Text-row table parsing:** Do not keep filtering empty `<td>` cells or flattening HTML tables into pipe rows before structural normalization.
- **Counts without identities:** `candidateCount` / `citationCount` without bounded id arrays cannot explain regressions.
- **Canonical id replacing physical provenance:** canonical curriculum identity supplements chunk/document provenance; it does not replace it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Raw-vs-support trace split | Another ad hoc mirror field on `ObservedTrace` | Separate retrieved/support/canonical collections aligned with Ragas and OpenInference | Prevents retrieval regressions from being mislabeled as answer regressions |
| Table materialization over merged cells | Custom regex / `td.get_text()` flattening inside the projection | `extract_html_table_cells()` / `extract_html_table_grid()` plus grid normalization | Existing utilities already model spans and positions; custom flattening loses structure |
| Multi-chunk structured curriculum answers | Top-doc lock plus first-source early stop | Coverage-aware selection with same-document multi-chunk allowance | `课程地图` answers need complementary claims from multiple chunks |
| Observability schema names | Opaque custom counters only | OpenInference / OTel-aligned semantics for retriever, reranker, LLM, evaluator boundaries | Makes traces composable and easier to reason about across runtime and eval tooling |

**Key insight:** The repo already has the right major components. What is missing is contract discipline between them. Hand-rolling more parsers, heuristics, or counters will deepen the drift instead of fixing it.

## Common Pitfalls

### Pitfall 1: Treating a Golden Mismatch as the Only Bug

**What goes wrong:** A follow-up replay fails because expected source ids still point to `curriculum:*`, while runtime correctly returns `program_semester_facts:*`.

**Why it happens:** Eval fixtures currently encode canonical curriculum truth and physical projection truth as if they were the same layer.

**How to avoid:** Add canonical curriculum identity to evidence/trace payloads, then update deterministic evals to assert canonical identity separately from physical unit identity.

**Warning signs:** Runtime answer passes and cites the right semester projection, but `expected_sources` still fail.

### Pitfall 2: Early Document Lock Drops Complementary Support

**What goes wrong:** The answer keeps only one chunk from a curriculum plan even though retrieval found multiple relevant chunks.

**Why it happens:** `select_supporting_evidence_sources()` can lock onto one top document, and answer shaping then stops after the first source yields enough rows.

**How to avoid:** For structured curriculum intents, require coverage-aware support selection and permit same-document multi-chunk accumulation until claim groups are satisfied.

**Warning signs:** `课程地图` answers mention one numeric rule but omit another complementary credit requirement from the same plan.

### Pitfall 3: Filtering Empty Cells Corrupts Table Semantics

**What goes wrong:** A course disappears from semester facts after projection.

**Why it happens:** Empty leading cells, merged cells, or continued rows are treated as removable noise instead of column placeholders.

**How to avoid:** Normalize from cell/span grids, preserve blank placeholders, and resolve continued-row semantics after positional reconstruction.

**Warning signs:** Only HTML/OCR tables with merged or sparse layouts fail; simple flat tables still pass.

### Pitfall 4: Observability Stores Counts but Not Enough Provenance

**What goes wrong:** Operators can see `candidateCount=6` and `citationCount=1`, but cannot tell which candidate was dropped or whether the drop happened before or after answer shaping.

**Why it happens:** Current app-api request observability stores summarized counts only, and `app_api_chat_runtime.py` mirrors `supporting_sources` into `retrieved_sources`.

**How to avoid:** Persist bounded id arrays and explicit layer-specific collections. Use traces to show retrieved candidates, selected support, and canonical citations separately.

**Warning signs:** Live benchmark failures say “retrieval missing” even when raw retriever actually returned the right chunks.

## Code Examples

Verified patterns from official and repo-local sources:

### Split Retrieved Contexts from Final Support

```python
# Recommended repo contract pattern.
sample = SingleTurnSample(
    user_input=user_goal,
    retrieved_contexts=[source.snippet for source in trace.retrieved_candidates],
    retrieved_context_ids=[source.doc_id for source in trace.retrieved_candidates],
    reference_context_ids=[citation.canonical_source_id for citation in trace.canonical_citations],
    response=answer_text,
)
```

Source: https://docs.ragas.io/en/stable/references/evaluation_schema/

### Use Citation Granularity Explicitly

```python
# Recommended synthesis pattern for curriculum answers.
query_engine = CitationQueryEngine(
    retriever=retriever,
    citation_chunk_size=512,
    citation_chunk_overlap=20,
)
```

Source: https://docs.llamaindex.ai/en/stable/api_reference/query_engine/citation/

### Use Multi-Chunk Synthesis Instead of Top-1 Extraction

```python
# Recommended synthesis mode for complementary curriculum chunks.
response_synthesizer = get_response_synthesizer(response_mode="compact")
response = response_synthesizer.synthesize(query_text, nodes=retrieved_nodes)
```

Source: https://docs.llamaindex.ai/en/stable/module_guides/querying/response_synthesizers/

### Reconstruct Tables from Cell/Span Truth

```python
# Recommended projection pattern.
for cell in table.cells:
    grid.place(
        row=cell.row_index,
        column=cell.column_index,
        row_span=cell.row_span,
        column_span=cell.column_span,
        content=cell.content,
    )
```

Source: https://learn.microsoft.com/en-us/dotnet/api/azure.ai.formrecognizer.documentanalysis.documenttablecell?view=azure-dotnet

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| One evidence list does retrieval, support, citation, and eval truth all at once | Separate retrieved contexts, reference contexts, and final response; trace retriever/reranker/evaluator independently | Reflected in current Ragas and OpenInference/OTel docs checked 2026-04-12 | Makes it possible to localize whether a regression is in retrieval, support selection, or answer composition |
| Flatten HTML/OCR tables into text rows early | Preserve table cells/grids with row/column/span semantics first | Reaffirmed in current Google Document AI and Azure table docs checked 2026-04-12 | Prevents merged/sparse cell layouts from silently losing courses |
| Generic “how/怎么” routing falls into procedure mode | Domain-specific structured query routing with multi-node synthesis for table-backed answers | Current LlamaIndex synthesis and citation docs emphasize multi-node answer assembly and citation granularity | Avoids `课程地图` answers collapsing into a single chunk excerpt |
| Operator observability stores only counts | Operator observability keeps bounded identifier lists plus counts, with semantically distinct trace stages | Current OpenInference and OTel GenAI specs checked 2026-04-12 | Gives operators enough detail to debug without turning app-api into a full artifact store |

**Deprecated/outdated:**

- Mirroring `retrieved_sources = supporting_sources` in app-api-backed eval traces.
- Filtering empty table cells during `program_semester_facts` projection.
- Letting canonical curriculum truth depend on whichever internal projection doc id happened to answer.
- Treating `课程地图怎么安排` as generic `procedure` when a resolved curriculum entity is already present.

## Open Questions

1. **Where should canonical curriculum identity live in contracts?**
   - What we know: `EvidenceSource` is already the cross-package carrier for doc/chunk provenance, and this phase needs canonical identity everywhere that provenance already travels.
   - What's unclear: Whether adding optional canonical fields to `EvidenceSource` is enough, or whether the repo wants a separate nested identity object immediately.
   - Recommendation: Add optional canonical fields directly to `EvidenceSource` and diagnostics in this phase. Only extract a separate type later if multiple domains need the same abstraction.

2. **How much raw retrieval detail should app-api persist?**
   - What we know: Counts alone are insufficient, but full chunk text in runtime DB rows is unnecessary and can bloat storage.
   - What's unclear: Whether operator workflows need score + title summaries only, or score + title + snippet hash.
   - Recommendation: Persist bounded JSON arrays of ids, chunk ids, scores, titles, and canonical ids. Keep full text in eval artifacts, not request observability facts.

3. **Should this phase upgrade `llama-index-core` to the latest release?**
   - What we know: Repo baseline `>=0.14.18` is already close to current `0.14.20`, and the required fixes are contract/routing/materialization changes, not missing framework capability.
   - What's unclear: Whether any current synthesis or citation issue is caused by an upstream bug rather than local logic.
   - Recommendation: Do not couple Phase 1000 to a dependency bump unless implementation hits a reproducible LlamaIndex bug that the release notes explicitly fix.

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | Python `unittest` as repo-default gate; Vitest `^4.1.0` for app-api worker/runtime lane |
| Config file | Root `/home/reptilian/code/campus-agent/pyproject.toml`; `/home/reptilian/code/campus-agent/apps/app-api/vitest.config.mts` |
| Quick run command | `uv run --all-packages python -m unittest tests.evals.test_curriculum_live_benchmark tests.evals.test_runtime_observability tests.ingestion.test_curriculum_program_semester_facts_projection tests.ingestion.test_curriculum_program_semester_facts_materialization tests.retrieval.test_curriculum_query_resolution` |
| Full suite command | `uv run --all-packages python -m unittest discover -s tests -t .` and `pnpm web:test:worker` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| CURR-01 | Canonical curriculum identity is asserted separately from physical `program_semester_facts` ids in follow-up replay cases | unit | `uv run --all-packages python -m unittest tests.evals.test_curriculum_live_benchmark` | ✅ |
| CURR-02 | Structured curriculum queries like `课程地图怎么安排` keep complementary support chunks and do not fall back to `procedure` | unit | `uv run --all-packages python -m unittest tests.evals.test_golden_cases tests.retrieval.test_curriculum_query_resolution` | ✅ |
| CURR-03 | Semester facts materialization preserves merged/sparse/continued rows and no longer drops `大学英语(四)` | unit | `uv run --all-packages python -m unittest tests.ingestion.test_curriculum_program_semester_facts_projection tests.ingestion.test_curriculum_program_semester_facts_materialization` | ✅ |
| CURR-04 | Live trace and app-api request observability distinguish retrieved candidates from supporting sources and canonical citations | unit + worker | `uv run --all-packages python -m unittest tests.evals.test_runtime_observability tests.evals.test_curriculum_live_benchmark` and `pnpm web:test:worker` | ✅ |

### Sampling Rate

- **Per task commit:** `uv run --all-packages python -m unittest tests.evals.test_curriculum_live_benchmark tests.ingestion.test_curriculum_program_semester_facts_projection tests.retrieval.test_curriculum_query_resolution`
- **Per wave merge:** `uv run --all-packages python -m unittest discover -s tests -t .`
- **Phase gate:** Full Python suite green plus `pnpm web:test:worker` green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/ingestion/test_curriculum_program_semester_facts_projection.py` — add merged/sparse/continued-row regression using the strong-base semester-4 fixture and assert `大学英语(四)` survives projection.
- [ ] `tests/ingestion/test_curriculum_program_semester_facts_materialization.py` — assert repaired projection re-materializes the affected `program_semester_facts` document id and semester row shape.
- [ ] `tests/evals/test_curriculum_live_benchmark.py` — add assertions for physical projection id, canonical curriculum id, and raw-vs-support trace separation in the two follow-up replay cases.
- [ ] `tests/evals/test_golden_cases.py` — add a dedicated `课程地图怎么安排` coverage regression that requires multiple complementary claims, not just one supporting chunk.
- [ ] `apps/app-api/test/request-observability.test.ts` — add persistence assertions for retrieved/supporting/canonical bounded arrays in request observability facts.

## Sources

### Primary (HIGH confidence)

- Local repo docs:
  - `/home/reptilian/code/campus-agent/docs/architecture/retrieval-serving-architecture.md`
  - `/home/reptilian/code/campus-agent/docs/decisions/adr-0021-institution-scoped-entity-alias-governance.md`
  - `/home/reptilian/code/campus-agent/.planning/phases/1000-curriculum-semester-facts/1000-CONTEXT.md`
- Local repo code:
  - `/home/reptilian/code/campus-agent/packages/rag-specialist/src/campus_rag_specialist/service.py`
  - `/home/reptilian/code/campus-agent/packages/rag-specialist/src/campus_rag_specialist/agent.py`
  - `/home/reptilian/code/campus-agent/packages/retrieval-core/src/campus_retrieval_core/evidence_ranking.py`
  - `/home/reptilian/code/campus-agent/packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
  - `/home/reptilian/code/campus-agent/packages/retrieval-core/src/campus_retrieval_core/curriculum_query_resolution.py`
  - `/home/reptilian/code/campus-agent/packages/ingestion-core/src/campus_ingestion_core/curriculum_program_semester_facts_projection.py`
  - `/home/reptilian/code/campus-agent/packages/ingestion-core/src/campus_ingestion_core/source_truth_common.py`
  - `/home/reptilian/code/campus-agent/packages/evals/src/campus_evals/app_api_chat_runtime.py`
  - `/home/reptilian/code/campus-agent/apps/app-api/src/modules/request-observability.ts`
  - `/home/reptilian/code/campus-agent/tests/evals/test_curriculum_live_benchmark.py`
- Official docs and specs:
  - LlamaIndex response synthesizers: https://docs.llamaindex.ai/en/stable/module_guides/querying/response_synthesizers/
  - LlamaIndex citation query engine: https://docs.llamaindex.ai/en/stable/api_reference/query_engine/citation/
  - Ragas evaluation schema: https://docs.ragas.io/en/stable/references/evaluation_schema/
  - Ragas context entity recall: https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_entities_recall/
  - OpenInference semantic conventions: https://arize-ai.github.io/openinference/spec/semantic_conventions.html
  - OpenTelemetry GenAI spans: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
  - Google Document AI `Document`: https://cloud.google.com/document-ai/docs/reference/rest/v1/Document
  - Azure `DocumentTableCell`: https://learn.microsoft.com/en-us/dotnet/api/azure.ai.formrecognizer.documentanalysis.documenttablecell?view=azure-dotnet
  - Azure `DocumentTable`: https://learn.microsoft.com/en-us/dotnet/api/azure.ai.formrecognizer.documentanalysis.documentanalysismodelfactory.documenttable?view=azure-dotnet
  - PyPI `llama-index-core`: https://pypi.org/project/llama-index-core/
  - PyPI `llama-index-vector-stores-qdrant`: https://pypi.org/project/llama-index-vector-stores-qdrant/

### Secondary (MEDIUM confidence)

- PyPI `qdrant-client`: https://pypi.org/project/qdrant-client/
- PyPI `ragas`: https://pypi.org/project/ragas/
- PyPI `opentelemetry-sdk`: https://pypi.org/project/opentelemetry-sdk/

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - repo already uses the key libraries, and official docs/specs match the exact phase boundary.
- Architecture: HIGH - current repo docs and code paths agree on internal surface ownership, specialist intent ownership, and the observed drift points.
- Pitfalls: MEDIUM - the coverage-policy recommendation is partly inferred from local failure behavior, though it is strongly supported by current synthesis/citation guidance.

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 for planning purposes; re-check package/spec pages if implementation starts later because OTel/OpenInference GenAI semantics are still moving.
