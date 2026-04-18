# Phase 1003: Official Web 新闻面 opening policy 与 runtime gate 收口 - Context

**Gathered:** 2026-04-14
**Status:** Ready for research and planning
**Source:** Repo architecture consolidation + web retrieval best-practice review

<domain>
## Phase Boundary

本 phase 只处理 `official_web/fresh_news` 与 `official_web/news_archive` 的长期 opening policy、runtime gate 和 query-serving acceptance criteria。

目标是把以下问题写死：

- 新闻面何时允许进入真实 query-serving runtime
- `fresh_news` 与 `news_archive` 分别面向什么 query intent
- 哪些 metadata / retrieval / freshness / evidence 条件是 opening 的硬门槛

本 phase 不处理：

- collector crawl 扩面
- parser / cleaner / chunker 的低层实现重写
- 在当前分支直接把 `fresh_news` 或 `news_archive` 打开为 query-enabled surface
- 把 `official_web` 重新并回单一默认知识库

</domain>

<decisions>
## Implementation Decisions

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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture / planning truth

- `docs/architecture/official-web-architecture.md` — source channel、control-plane ownership、runtime opening guardrail
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md` — news serving split、opening posture 与 retrieval policy
- `docs/architecture/official-web-freshness-and-incremental-crawling.md` — hot lane / freshness posture
- `docs/architecture/official-web-source-truth-contract.md` — source-truth 不变量
- `docs/domains/official-web.md` — domain reading order
- `.planning/PROJECT.md` — 当前 active item 与 worktree boundary
- `.planning/STATE.md` — 仍在独立 official-web worktree 处理的 current truth
- `.planning/ROADMAP.md` — Phase 1003 phase record

### Active reference / handoff

- `docs/reference/official-web-fresh-news-surface-handoff.md`
- `docs/reference/official-web-fresh-news-eval-baseline-20260405.md`
- `docs/reference/official-web-stable-reference-eval-baseline-20260405.md`

</canonical_refs>

<specifics>
## Specific Facts To Preserve

- 当前 `official_web/muc_public_pages` 仍只是 mixed current-truth bridge，不是默认 query-serving collection。
- 当前 worktree-local `future_fresh_news_surface` seed set 是 handoff seed，不是 runtime opening proof。
- 当前 `fresh_news` / `news_archive` 仍留在独立 official-web worktree，不在当前分支直接开放。

### External best-practice directions to validate during research

- Google / Vertex AI Search custom ranking or freshness-aware website retrieval
- Azure AI Search freshness scoring / recency handling
- Elasticsearch date decay / function score / metadata filtering
- Haystack metadata routing / filter-based retrieval

</specifics>

<deferred>
## Deferred Ideas

- browser/live-search provider concrete selection
- 新闻摘要生成风格与产品 UI 呈现
- `official_web` collector crawl expansion
- `news_archive` 的 operator UX 细节

</deferred>

---

*Phase: 1003-official-web-opening-policy-runtime-gate*
*Context gathered: 2026-04-14 via repo architecture consolidation + web retrieval review*
