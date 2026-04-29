# Phase 8: Official Web Repo Hardening And Expansion - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning and execution
**Source:** Derived from current worktree official-web architecture docs, runbooks, current `muc_public` config truth, recent `law/history` live batch evidence, and the repo-level follow-up decision to document before execution

<domain>
## Phase Boundary

Phase 8 is a repo-level follow-up for `official_web`.

Its job is to turn the current worktree's official-web experience into one explicit, repeatable execution shape:

- `collector extraction -> source-truth validator -> qc-report -> projection replay -> projection validator -> ingestion/import handoff`

The phase is intentionally narrower than "expand everything".

It must first stabilize the repo truth for:

- page-family classification on hard pages such as thin roster and aggregate listing templates
- the distinction between the stable regression gate and low-budget host-expansion validation batches
- the handoff boundary between source-truth QC and projection replay

This phase does not:

- reopen retrieval architecture
- promote new query-serving scope
- turn newly validated hosts into hot-lane scheduler truth
- move collector logic into `app-api` or `ingestion-worker`

</domain>

<decisions>
## Implementation Decisions

### Locked by architecture and runbooks
- `official_web` remains a source channel, not a retrieval/runtime shortcut.
- `apps/official-web-collector` owns crawl, canonicalization, provider extraction, source-truth artifacts, validator, and QC report.
- `packages/official-web-core` owns config, policy, page-family/source-truth shared contract, and replay-facing typed truth.
- `apps/ingestion-worker` owns projection replay, projection validation, and import persistence; it must not return to raw HTML to re-extract source truth.
- `apps/app-api` remains the official-web control-plane owner and is not the place to solve extractor or page-family bugs.

### Locked by current worktree truth
- Current repo-tracked `muc_public` host scope already includes more than the stable 5-host gate; the stable gate is only a regression surface, not the full host allowlist truth.
- `law.muc.edu.cn` and `history.muc.edu.cn` have already passed a low-budget Batch A source-truth and replay validation cycle in this worktree.
- The most concrete remaining inconsistency is no longer `history` aggregate cards; it is the mismatch between live `law.muc.edu.cn/szdw1.htm` family truth and the repo's written audit narrative.
- Current extraction strategy should keep source-truth ownership in the collector. Projection replay may validate and consume page families, but it must not compensate for extractor misclassification.

### Phase sequencing decisions
- Phase 8 starts by resolving thin roster family truth and aligning repo docs with validated live evidence.
- Only after that truth is stable do we freeze the repo-level expansion workflow for future host batches.
- Scheduler lane changes, cadence increases, and broader host promotion remain deferred until the regression and expansion gates are both stable.

### The agent's Discretion
- Exact helper names, signal names, and fixture shapes in `page-artifacts.ts` and `page-artifacts.test.ts`
- Whether the direct thin-roster fix uses new page signals or a tighter directory fallback, as long as it does not regress aggregate listing or category-hub behavior
- The exact wording and file placement of audit/update notes, as long as the canonical runbooks and reference docs remain consistent

</decisions>

<canonical_refs>
## Canonical References

**Downstream execution must read these before implementation.**

### Repo and planning truth
- `AGENTS.md`
- `README.md`
- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`

### Official-web architecture and contracts
- `docs/architecture/official-web-source-channel.md`
- `docs/architecture/official-web-source-truth-contract.md`
- `docs/architecture/official-web-control-plane-on-app-api.md`
- `docs/architecture/official-web-crawl-policy.md`
- `docs/architecture/official-web-freshness-and-incremental-crawling.md`

### Official-web runbooks and current reference truth
- `apps/official-web-collector/README.md`
- `docs/runbooks/official-web-collector-smoke-and-audit.md`
- `docs/runbooks/official-web-source-truth-projection-replay.md`
- `docs/reference/official-web-muc-public-batch-a-law-history-audit-20260402.md`

### Config and shared contract truth
- `configs/sources/official_web/muc_public/site.json`
- `configs/sources/official_web/muc_public/hosts.json`
- `configs/sources/official_web/muc_public/seeds.json`
- `configs/sources/official_web/muc_public/projection-declarations.json`
- `packages/official-web-core/src/source-truth.ts`
- `packages/official-web-core/src/policy.ts`

</canonical_refs>

<specifics>
## Specific Ideas

- Plan `08-01` should resolve `law.muc.edu.cn/szdw1.htm` family truth using current live evidence and targeted regression fixtures.
- Plan `08-01` should also align the Batch A audit/reference docs with the latest validated result instead of leaving stale narrative in repo docs.
- Plan `08-02` should freeze one explicit repo workflow split:
  - stable regression gate
  - low-budget host-expansion validation batch
- Expansion docs should keep projection replay/import as mandatory gates before any host is treated as stable baseline truth.

</specifics>

<deferred>
## Deferred Ideas

- Promoting any new host directly into `scheduler-policy.json` hot lane
- Broadening query-serving or retrieval scope based on official-web pages
- Reworking app-api control-plane ownership
- Generalizing this phase into a generic "all source channels" effort

</deferred>

---

*Phase: 08-official-web-repo-hardening-and-expansion*
*Context gathered: 2026-04-02*
