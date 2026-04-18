# Phase 1003: Official Web 新闻面 opening policy 与 runtime gate 收口 - Research

**Researched:** 2026-04-14
**Domain:** `official_web` news-serving policy, freshness-aware retrieval, runtime gating
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Stable reference remains the default institutional surface

- `official_web/stable_reference` 继续是默认 institutional reference surface。
- `fresh_news` 不得混进默认 stable reference 回答面。
- `news_archive` 只允许服务显式历史查询、operator、分析或评测。

### News quality variance is handled by narrower serving policy, not by mixing corpora

- `fresh_news` 质量波动大，不应因为“也来自官网”就与稳定说明页共用默认 retrieval surface。
- `article_detail` 是新闻问答主 evidence；`listing_page` 只做 discovery、freshness trigger、navigation fallback。
- seed baseline、local import/release 或离线 qrels 命中率，不自动等于 runtime opening approval。

### Runtime opening depends on freshness-aware routing

- query routing 必须显式区分稳定说明、近期新闻和强时效查询。
- “今天 / 最新 / 最近”类 query 必须经过 freshness gate；不足则 live search 或 fail-close。
- `news_archive` 不能作为 fresh-news 默认回填库参与混检。

### Claude's Discretion

- `1003-CONTEXT.md` 未提供单独的 `## Claude's Discretion` 小节；本 research 仅在未被锁定的实现细节上做收口，例如 metadata 字段分层、测试缺口和配置落点。

### Deferred Ideas (OUT OF SCOPE)

- browser/live-search provider concrete selection
- 新闻摘要生成风格与产品 UI 呈现
- `official_web` collector crawl expansion
- `news_archive` 的 operator UX 细节
</user_constraints>

## Summary

Repo truth 已经很明确：`official_web/muc_public_pages` 只是 mixed current-truth bridge，`official_web/stable_reference` 才是默认 institutional reference surface，`official_web/fresh_news` 虽然已有 seed split manifest、qrels 和 live-gate baseline，但仍保持 `offline_preparation`。因此本 phase 的正确目标不是“把新闻面开起来”，而是把“不该怎么开、满足什么条件才允许开、哪些条件绝不能由 seed baseline 代替”写死。

外部主流检索系统的官方文档也支持同一结论。Vertex AI Search、Azure AI Search、Elasticsearch 和 Haystack 都把 freshness 建模为显式 metadata、filter、排序/衰减和 routing 问题，而不是“把所有网页混进一个库，再靠 prompt 理解最近/最新”。这意味着 repo 的长期正确形态不是继续扩大 mixed bridge，而是保持 `stable_reference`、`fresh_news`、`news_archive` 三条语义不同的 surface，各自带不同的 opening policy。

`fresh_news` 的 opening 需要同时满足：detail-first evidence、可用的时间 metadata、cross-host duplicate collapse、freshness-aware routing，以及 stale 时的 live-search-or-fail-close contract。`news_archive` 不能作为 fresh-news 的 recall 补丁，它只能服务显式历史查询、operator、分析和评测。当前分支仍不应直接打开任何 news query-enabled surface。

**Primary recommendation:** 冻结 `stable_reference` 为默认公开官网回答面；`fresh_news` 只有在 detail-evidence、time metadata、duplicate collapse 和 freshness gate 全部机器可验后才可按窄 intent 开放；`news_archive` 保持非默认、显式历史意图专用。

## Why Separation Is Mandatory

1. `stable_reference` 的正确性 contract 是“长期稳定的机构事实”，而 `fresh_news` 的正确性 contract 是“在显式 freshness window 内仍然够新”。两者不是一个 ranking policy。
2. `fresh_news` 默认需要时间过滤、时间排序或 recency bias；这些策略如果直接施加在稳定说明页上，会把长期事实问答拉向新闻噪声。
3. `news_archive` 的存在是为了保留历史语义，不是为了帮 `fresh_news` 凑 recall。把 archive 混回默认近期新闻召回，会直接破坏“最新/最近”语义。
4. Repo 当前已有 split truth：`stable_reference` 已有真正的 release/alias 基线，`fresh_news` 只有 seed baseline；继续混用只会让 mixed bridge 冒充长期 serving truth。
5. 主流官方检索产品都要求显式 metadata 和 filtering/ranking primitives 才能做 freshness-aware serving，这进一步说明应分 surface 治理，而不是靠单一混库回收所有官网内容。

## Opening Criteria

### `fresh_news`

`fresh_news` 只有在以下条件同时成立时才允许从 `offline_preparation` 进入真实 query-serving runtime：

1. Query-enabled 文档默认以 `article_detail` 为主 evidence；`listing_page` 不能承担默认正文证据角色。
2. 每个 query-enabled 文档都具备可用的 `published_at`；若来源无法稳定给出 `published_at`，至少要有明确的 `crawled_at`、`last_seen_at`，且 runtime policy 必须把缺失发布时间的文档视为降级或不可答。
3. `published_at`、`crawled_at`、`last_seen_at`、`page_family`、`host`、`section`、`news_kind` 已进入 document/registry/runtime payload，可用于 filter、sort、stale 判定和 evidence 展示。
4. Cross-host duplicate news 已在逻辑 document/version 层收口，不能让同一条新闻以多个 host URL 作为 competing evidence 同时参与回答。
5. Supervisor / specialist 已显式区分三类 intent：
   - 稳定说明类
   - 近期新闻类
   - 明确历史新闻类
6. “今天 / 最新 / 最近 / 刚刚”类 query 进入专门 freshness gate；若本地 freshness 不足，必须 live search 或 fail-close，不能返回旧索引结果。
7. Runtime profile 已显式承载：
   - `query_enabled`
   - `surface_type=fresh_news`
   - 时间窗口
   - stale 阈值
   - 是否允许 live-search fallback
8. Eval 不能只覆盖 exact-title seed ask。opening 前必须新增面向 recency-sensitive ask 的 deterministic gate。

### `news_archive`

`news_archive` 的 opening 条件更严格：

1. 保持 `query_enabled_by_default=false`。
2. 只在以下场景允许命中：
   - 用户显式要求历史新闻
   - operator 回溯
   - 分析
   - 评测
3. 不得作为 `fresh_news` 的默认回填库。
4. 必须支持按时间范围或历史意图显式过滤；没有时间锚点时不应偷偷参与近期新闻 query。
5. 回答历史新闻时仍必须返回标题、URL、发布时间；不能把旧报道改写成当前状态断言。

## Metadata, Routing, And Evidence Rules

### Required Metadata

| Field | Scope | Why It Is Required |
|-------|-------|--------------------|
| `published_at` | `fresh_news`, `news_archive` | recent/historical intent routing、排序、证据展示 |
| `crawled_at` | `fresh_news`, `news_archive` | 判断本地索引最近一次实际观察时间 |
| `last_seen_at` | `fresh_news`, `news_archive` | 判断页面是否仍在源站可见、是否 stale |
| `last_changed_at` | `fresh_news`, `news_archive` | 区分“刚抓过”与“最近真的变过” |
| `page_family` | all `official_web/*` | 强制 `article_detail` 与 `listing_page` 分工 |
| `host` | all `official_web/*` | provenance、cross-host duplicate audit、operator 查询 |
| `section` | `fresh_news`, `news_archive` | 栏目路由、学院/频道锚点过滤 |
| `news_kind` | `fresh_news`, `news_archive` | 区分新闻、公告、讲座、活动等窗口策略 |
| `is_current` | all `official_web/*` | 版本 current truth；但不能单独代表 freshness |
| `normalized_canonical_url` | all `official_web/*` | stable URL identity、dedupe 和 evidence 回链 |
| `raw_asset_id` / `raw_version_id` | all `official_web/*` | 保持 source-truth 到 evidence 的追溯链 |
| `main_content_hash` | all `official_web/*` | 变化判定和 duplicate collapse 的稳定基础 |

### Routing Rules

| Query intent | Allowed surface | Required gate | Failure mode |
|--------------|-----------------|---------------|--------------|
| 稳定说明 / 机构事实 / 联系方式 / 办事说明 | `official_web/stable_reference` | normal scope gate | `no_answer` / `needs_clarification` |
| 校园新闻 / 近期活动 / 公告 / 讲座 / 近况 | `official_web/fresh_news` | freshness gate + time metadata coverage | stale 时 live search 或 `no_answer` |
| 历史新闻 / 某年某月 / 过往活动回溯 | `official_web/news_archive` | explicit history intent gate | 缺少历史锚点时 fail-close |
| “今天 / 最新 / 最近 / 刚刚” | `official_web/fresh_news` only | freshness gate before retrieval | stale 时绝不回填 `news_archive` |

### Evidence Rules

1. `article_detail` 是新闻问答默认主 evidence。
2. `listing_page` 只承担 discovery、freshness trigger、navigation fallback；默认不得进入正文事实回答。
3. 新闻回答至少返回：
   - 标题
   - 来源 URL
   - 发布时间
   - 必要时的抓取时间
4. 如果只有 listing/navigation 线索而没有 detail 证据，答案必须明确降级为导航级线索，而不是正文事实。
5. 旧新闻不能因为 `latest_url`、标题相似或措辞润色就被包装成当前事实。
6. `news_archive` 命中结果必须显式保留历史语义，不能写成“目前/现在/近期已…”。

## Out Of Scope For This Branch

1. 不在当前分支直接把 `fresh_news` 或 `news_archive` 打开为 query-enabled surface。
2. 不扩面 `official_web` crawl scope，不新增 collector host allowlist 目标。
3. 不重写 parser / cleaner / chunker / extraction 低层实现。
4. 不选择具体 browser provider 或 live-search provider。
5. 不设计新闻摘要生成风格、前端 UI 呈现或 operator archive UX。
6. 不把 `official_web` 重新并回单一默认知识库，也不让 `muc_public_pages` 重新扮演长期 serving surface。

## Standard Stack

No new third-party package is recommended for this phase. Use the repo’s existing `official_web` control-plane, retrieval, runtime-profile, and eval stack.

### Core

| Library / Component | Version | Purpose | Why Standard |
|---------------------|---------|---------|--------------|
| `apps/app-api` official-web control plane | repo current (`0.1.0`) | owns `page_freshness`, `page_observations`, `plans:resolve`, operator freshness views | repo architecture already freezes `app-api` as durable freshness/control-plane owner |
| `packages/retrieval-core` + runtime profiles | repo current | metadata pre-filter, hybrid retrieval, RRF, evidence shaping | accepted retrieval baseline already supports collection-specific serving policy |
| `packages/evals` official-web benchmarks | repo current | split-scope qrels and deterministic live gates | existing machine-checkable truth for `stable_reference` and `fresh_news` seed baselines |
| `apps/official-web-collector` lane model | repo current (`0.1.0`) | `baseline` / `hot` / `repair` crawl lanes feeding freshness truth | required upstream signal for any freshness-aware opening policy |

### Supporting

| Library / Component | Version | Purpose | When to Use |
|---------------------|---------|---------|-------------|
| `packages/official-web-core` | `0.1.0` | split-manifest and official-web config helpers | scope-specific manifest/profile work |
| `apps/app-api` Vitest suite | Vitest `4.1.0` | Worker/control-plane route and service verification | planner, command, query, projection contract changes |
| repo Python test/eval suite | Python `3.12` + `pytest>=8` installed, `unittest` execution convention | query policy, retrieval fixtures, live-gate helpers | scope/routing/evidence policy changes |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| split `stable_reference` / `fresh_news` / `news_archive` surfaces | one mixed `muc_public_pages` surface | simpler short term, but breaks stable fact answering and recency semantics |
| explicit freshness gate | prompt-only “latest” heuristics | cheaper initially, but not auditable and cannot fail-close safely |
| explicit historical route | implicit archive backfill | raises recall, but silently corrupts “latest/recent” answers |

**Installation:**

```bash
# None. This phase should not introduce a new package dependency.
```

**Version verification:** Not applicable for new external packages; this phase should reuse the repo-local stack above.

## Architecture Patterns

### Recommended Project Structure

```text
docs/architecture/                           # policy truth
configs/ingestion/official_web/
├── stable_reference/                        # current default institutional surface
├── fresh_news/                              # future freshness-sensitive surface
└── news_archive/                            # future explicit-history surface
apps/app-api/src/modules/official-web-*.ts   # control plane, planner, query, projection
packages/evals/src/campus_evals/             # split-scope live gate and qrels
tests/ingestion/                             # runtime profile and import/release guards
tests/evals/                                 # live benchmark and retrieval fixture guards
tests/supervisor/                            # routing / query policy guards
```

### Pattern 1: Surface-First Routing

**What:** Decide `stable_reference` vs `fresh_news` vs `news_archive` before dense/sparse retrieval, based on query intent and freshness requirements.

**When to use:** Every `official_web` request, especially when the user asks for “最近 / 最新 / 今天 / 刚刚”.

**Example:**

```typescript
// Source: repo architecture docs + official metadata-routing guidance from
// Haystack / Azure / Elasticsearch / Vertex docs listed in Sources.
function routeOfficialWebQuery(input: QueryIntent): "stable_reference" | "fresh_news" | "news_archive" | "live_search" | "fail_close" {
  if (input.kind === "stable_reference") return "stable_reference";
  if (input.kind === "historical_news") return "news_archive";
  if (input.kind === "recent_news") {
    if (input.localFreshEnough) return "fresh_news";
    return input.liveSearchAllowed ? "live_search" : "fail_close";
  }
  return "stable_reference";
}
```

### Pattern 2: Freshness Gate Before Ranking

**What:** Apply time-window eligibility before recency boosting or retrieval ranking.

**When to use:** `fresh_news` and any query that claims currentness.

**Example:**

```typescript
// Inference from official search docs: filter first, then rank within eligible docs.
const freshNewsWindow = {
  minPublishedAt: nowMinusDays(30),
  minObservedAt: nowMinusHours(6),
};

const eligible = docs.filter((doc) =>
  doc.surface === "fresh_news" &&
  doc.published_at >= freshNewsWindow.minPublishedAt &&
  doc.last_seen_at >= freshNewsWindow.minObservedAt,
);
```

### Pattern 3: Detail-First Evidence Shaping

**What:** Only `article_detail` can be primary fact evidence for news answers; `listing_page` stays discovery-only unless the product explicitly accepts navigation-grade output.

**When to use:** Any `fresh_news` or `news_archive` answer composition.

**Example:**

```typescript
// Source: repo official-web serving strategy and fresh-news handoff docs.
function chooseNewsEvidence(candidates: EvidenceDoc[]): EvidenceDoc[] {
  const detail = candidates.filter((doc) => doc.page_family === "article_detail");
  if (detail.length > 0) return detail;
  return [];
}
```

### Pattern 4: Archive Is Explicit, Never Silent Fallback

**What:** `news_archive` is queried only when the user explicitly asks for historical material or the operator is running analysis/evals.

**When to use:** Historical queries, operator surfaces, replay, evals.

**Example:**

```typescript
function allowArchive(query: QueryIntent): boolean {
  return query.kind === "historical_news" || query.caller === "operator" || query.mode === "eval";
}
```

### Anti-Patterns to Avoid

- **Mixed default corpus:** Do not send stable-reference and news docs into one default `official_web` answering surface.
- **`is_current` equals “fresh”:** `is_current=true` only means current revision track, not recent-enough-for-latest questions.
- **Seed baseline equals opening proof:** exact-title `8/8` on seed `fresh_news` cases is not runtime opening approval.
- **Listing pages as answer truth:** listing snippets are not acceptable substitutes for detail evidence.
- **Archive backfill:** do not let `news_archive` silently rescue a stale `fresh_news` query.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| “最新/最近” detection | prompt-only heuristics | explicit query-intent classification + freshness gate | reproducible, auditable, fail-close capable |
| News ranking | one mixed corpus with ad-hoc weights | surface split + metadata filter + recency ranking | matches mainstream search primitives and repo boundary docs |
| Duplicate news handling | answer-time “pick one URL” patch | logical document/version collapse before serving | prevents competing evidence from mirror hosts |
| Historical fallback | hidden archive recall | explicit `news_archive` route only | preserves recency semantics |
| Freshness truth | infer recency from snippets or titles | `page_freshness` / `page_observations` + lane-aware crawl truth | durable control-plane state already exists in repo |

**Key insight:** Current search stacks already expose metadata filtering, date ranking, and explicit routing. The hard problem here is not “better prompting”; it is preserving distinct correctness contracts for stable facts, fresh news, and historical news.

## Common Pitfalls

### Pitfall 1: Treating Seed Baselines As Opening Approval

**What goes wrong:** Teams see `8/8` fresh-news seed retrieval/live-gate pass and assume the surface is ready for default runtime traffic.

**Why it happens:** The seed baseline only covers exact-title asks over a small handoff set.

**How to avoid:** Require dedicated recency-sensitive eval cases plus runtime freshness thresholds before opening.

**Warning signs:** Documents pass exact-title tests, but there is no test for “最近/最新/今天”.

### Pitfall 2: Using `is_current` As A Freshness Proxy

**What goes wrong:** Old but current-version news items are answered as if they were recent.

**Why it happens:** `is_current` is a versioning signal, not a recency SLO.

**How to avoid:** Gate `fresh_news` on `published_at`, `crawled_at`, `last_seen_at`, and explicit stale thresholds.

**Warning signs:** A document is `is_current=true` but last observed days or weeks ago.

### Pitfall 3: Letting Listing Pages Reenter Primary Evidence

**What goes wrong:** Answers cite list snippets or navigation text instead of article bodies.

**Why it happens:** Listing pages are easier to collect frequently, so they get reused as fact evidence.

**How to avoid:** Enforce `article_detail` primary-evidence-only rules in retrieval and answer shaping.

**Warning signs:** Answers can be produced even when no detail page is in the support set.

### Pitfall 4: Silent Archive Backfill

**What goes wrong:** `news_archive` rescues `fresh_news` misses, and users receive stale news framed as current.

**Why it happens:** Archive improves recall if mixed blindly.

**How to avoid:** Only route to archive on explicit historical intent or operator/eval mode.

**Warning signs:** “最新” asks start citing items clearly outside the current freshness window.

### Pitfall 5: Solving Runtime Gaps In Prompt Copy

**What goes wrong:** The system tries to hide stale or weak evidence by changing wording instead of blocking the answer.

**Why it happens:** Prompt updates are faster than fixing routing and metadata.

**How to avoid:** Keep freshness and surface eligibility in runtime policy, not prompt text.

**Warning signs:** The answer sounds cautious, but the cited document is still old or wrong-surface.

## Code Examples

Verified patterns from official sources. Field names are adapted to repo semantics.

### Vertex AI Search: Website Metadata + Filter + Order By Date

```json
// Source:
// https://docs.cloud.google.com/generative-ai-app-builder/docs/add-website-metadata
// https://docs.cloud.google.com/generative-ai-app-builder/docs/filter-website-search
// https://docs.cloud.google.com/generative-ai-app-builder/docs/order-web-search-results
{
  "filter": "surface: ANY(\"fresh_news\")",
  "orderBy": "published_at desc"
}
```

### Vertex AI Search: Custom Ranking Using Date Metadata

```text
// Source: https://cloud.google.com/generative-ai-app-builder/docs/custom-ranking
surface="fresh_news", custom-ranking-expression = "0.8 * relevance_score + 0.2 * freshness_signal"
```

### Azure AI Search: Freshness Scoring + Pre-Filter

```json
// Source:
// https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles
// https://learn.microsoft.com/en-us/azure/search/vector-search-filters
{
  "filter": "surface eq 'fresh_news'",
  "vectorFilterMode": "preFilter",
  "scoringProfile": "fresh_news_by_published_at"
}
```

### Elasticsearch: Filtered Date Decay For News

```json
// Source: https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-function-score-query
{
  "query": {
    "function_score": {
      "query": {
        "bool": {
          "filter": [
            { "term": { "surface": "fresh_news" } },
            { "range": { "published_at": { "gte": "now-30d" } } }
          ]
        }
      },
      "functions": [
        {
          "gauss": {
            "published_at": {
              "origin": "now",
              "scale": "7d"
            }
          }
        }
      ],
      "boost_mode": "multiply"
    }
  }
}
```

### Haystack: Metadata-Driven Retrieval Routing

```python
# Source:
# https://docs.haystack.deepset.ai/docs/filterretriever
# https://docs.haystack.deepset.ai/v2.1/docs/metadatarouter
filters = {
    "operator": "AND",
    "conditions": [
        {"field": "surface", "operator": "==", "value": "fresh_news"},
        {"field": "published_at", "operator": ">=", "value": cutoff_iso},
    ],
}
```

## State Of The Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Mixed `official_web/muc_public_pages` bridge treated as future serving truth | Split `stable_reference` / `fresh_news` / `news_archive` surfaces | Repo accepted on 2026-04-05; reaffirmed in 2026-04-14 context/docs | Stable facts, fresh news, and history get separate correctness contracts |
| `is_current` or “latest-looking title” used as recency hint | Explicit `published_at` / `crawled_at` / `last_seen_at` freshness gate with live-search-or-fail-close fallback | Current repo freshness architecture + current primary vendor docs | “今天/最新/最近” queries can fail safely instead of hallucinating |
| Listing pages reused as answer evidence | `article_detail` primary evidence, `listing_page` discovery-only | Repo handoff/policy docs updated 2026-04-04 to 2026-04-14 | Better evidence quality and less title/listing leakage |

**Deprecated/outdated:**

- Treating `muc_public_pages` as the long-term default official-web query surface.
- Reusing stable-reference gate evidence as proof that `fresh_news` is runtime-ready.
- Trying to solve freshness with prompt wording instead of routing and metadata.

## Open Questions

1. **What exact freshness windows should `fresh_news` use by `news_kind`?**
   - What we know: official search platforms support date filters, date ordering, and freshness boosts; the repo already has `page_freshness` truth.
   - What's unclear: whether the initial window should be one global threshold or multiple thresholds by `news_kind`.
   - Recommendation: implement explicit config fields in the runtime profile; do not hardcode one universal value in prompt or code comments.

2. **When stale, should runtime prefer live search or direct fail-close?**
   - What we know: the policy must be explicit and machine-testable; provider selection is deferred.
   - What's unclear: default fallback posture before a live-search provider is chosen.
   - Recommendation: phase plan should treat fallback mode as a runtime-profile flag with `fail_close` as the safe default until a provider is accepted.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Python `unittest` via `uv run --all-packages` + Vitest `4.1.0` for Worker/TS |
| Config file | `pyproject.toml`, `apps/app-api/vitest.config.mts`, `turbo.json` |
| Quick run command | `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_query_policy tests.evals.test_official_web_live_benchmark tests.ingestion.test_corpus_runtime_profile && pnpm --dir apps/app-api exec vitest run test/official-web-planner.route.test.ts test/official-web-command.service.test.ts` |
| Full suite command | `uv run --all-packages python -m unittest discover -s tests -t .` and `pnpm web:test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OW-1003-01 | `stable_reference` remains the only default official-web public surface | unit | `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_query_policy` | ✅ |
| OW-1003-02 | `stable_reference` and `fresh_news` split scopes stay distinct in live-gate helpers | unit/eval | `uv run --all-packages python -m unittest tests.evals.test_official_web_live_benchmark` | ✅ |
| OW-1003-03 | runtime profiles continue to distinguish stable-reference-like collections from `fresh_news` / `news_archive` | unit | `uv run --all-packages python -m unittest tests.ingestion.test_corpus_runtime_profile` | ✅ |
| OW-1003-04 | official-web control plane preserves lane-aware freshness truth and planner resolution inputs | unit | `pnpm --dir apps/app-api exec vitest run test/official-web-planner.route.test.ts test/official-web-command.service.test.ts` | ✅ |
| OW-1003-05 | opening policy rejects recency-sensitive answers when freshness proof is missing | unit/eval | `uv run --all-packages python -m unittest tests.evals.test_official_web_live_benchmark` | ✅ partial |

### Sampling Rate

- **Per task commit:** `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_query_policy tests.evals.test_official_web_live_benchmark tests.ingestion.test_corpus_runtime_profile` plus `pnpm --dir apps/app-api exec vitest run test/official-web-planner.route.test.ts test/official-web-command.service.test.ts`
- **Per wave merge:** `uv run --all-packages python -m unittest discover -s tests -t .` and `pnpm web:test`
- **Phase gate:** Full targeted Python + app-api Worker tests green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] Add a policy test that `news_archive` never participates in default `fresh_news` or `stable_reference` routing.
- [ ] Add a runtime-profile / ingestion test that `published_at` + `crawled_at` + `last_seen_at` coverage is required before `fresh_news.query_enabled=true`.
- [ ] Add an eval case for stale `fresh_news` queries that distinguishes `live_search` from `fail_close`.
- [ ] Add an evidence-shaping test that forbids `listing_page` as primary support for news answers once `fresh_news` is opened.

## Sources

### Primary (HIGH confidence)

- Repo docs:
  - `docs/architecture/official-web-architecture.md` - source-channel boundary and control-plane ownership
  - `docs/architecture/official-web-serving-and-news-retrieval-strategy.md` - split-surface policy and opening posture
  - `docs/architecture/official-web-freshness-and-incremental-crawling.md` - lane model and freshness truth
  - `docs/architecture/official-web-source-truth-contract.md` - upstream/source-truth field boundaries
  - `docs/domains/official-web.md` - domain reading order
  - `.planning/PROJECT.md`, `.planning/STATE.md`, `.planning/ROADMAP.md` - current worktree and roadmap truth
  - `docs/reference/official-web-fresh-news-surface-handoff.md` - mixed bridge vs future fresh-news handoff
  - `docs/reference/official-web-fresh-news-eval-baseline-20260405.md` - seed baseline boundary
  - `docs/reference/official-web-stable-reference-eval-baseline-20260405.md` - stable-reference baseline boundary
- Google / Vertex AI Search:
  - https://docs.cloud.google.com/generative-ai-app-builder/docs/add-website-metadata - website metadata fields for search
  - https://docs.cloud.google.com/generative-ai-app-builder/docs/filter-website-search - metadata-based filtering
  - https://docs.cloud.google.com/generative-ai-app-builder/docs/order-web-search-results - ordering web results by metadata/date
  - https://cloud.google.com/generative-ai-app-builder/docs/custom-ranking - custom ranking expressions, including datetime attributes
  - https://cloud.google.com/generative-ai-app-builder/docs/recrawl-websites - automatic/manual refresh posture for website search
- Azure AI Search:
  - https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles - freshness scoring profiles and interaction with ranking
  - https://learn.microsoft.com/en-us/azure/search/vector-search-filters - pre/post vector filtering
- Elasticsearch:
  - https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-function-score-query - filtered function scoring and date decay
- Haystack:
  - https://docs.haystack.deepset.ai/docs/filterretriever - metadata filtering
  - https://docs.haystack.deepset.ai/v2.1/docs/metadatarouter - metadata-based routing

### Secondary (MEDIUM confidence)

- None.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - repo-local stack already exists; this phase should not add new dependencies.
- Architecture: HIGH - repo docs are explicit, and external primary docs independently reinforce metadata/routing/freshness separation.
- Pitfalls: MEDIUM-HIGH - strongly supported by repo history and official search primitives, but exact stale windows remain phase-implementation choices.

**Research date:** 2026-04-14
**Valid until:** 2026-04-21
