---
doc_type: index
status: completed
created: 2026-04-30
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Canonical Retrieval Release Hardening

这是 `canonical-retrieval-release-hardening` 的 native completed workstream 入口。
它承接 `canonical document artifacts -> document-units -> chunks -> embedding ->
Qdrant release -> retrieval evidence` 这条链路的发布安全、运行时漂移防护、
provenance、成本控制与 retrieval acceptance gate。

## Current Status

- status: `completed`
- current phase: `Phase 9` completed
- active implementation: none
- current posture: 基础链路已经存在；chunk preparation / release manifest / dense+sparse
  hybrid retrieval / metadata filter 已具备，query-enabled truth 已与 runtime profile /
  policy 收敛；registry-scope release 已支持 alias publish 前 deterministic retrieval
  acceptance gate；sparse/hybrid release provenance 已补齐；chunker/tokenizer preparation
  provenance 已补齐；retrieval runtime drift guard 已落地；embedding cache / cost counters
  已落地；eval-driven retrieval tuning runner、默认 query-enabled qrels denominator、qrels
  coverage gate、chunk quality audit helper 与 monitoring backlog intake 已落地；post-review
  closeout 已把 chunk quality helper 升级为 query-serving release blocking gate，runtime drift
  guard 升级为多点一致性校验，query embedding cache key 升级为 provider/model/dimension/profile
  identity，qrels coverage 升级为 scenario denominator，monitoring intake 升级为 JSONL CLI。
  runtime drift guard 必须在
  release/point payload provenance 补齐后执行，不能校验尚未落盘的字段。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Phase Plans

- Phase 0: `./phases/phase-00-scope-and-truth-alignment/PLAN.md`
- Phase 1: `./phases/phase-01-query-enabled-truth-fix/PLAN.md`
- Phase 2: `./phases/phase-02-release-retrieval-acceptance-gate/PLAN.md`
- Phase 3: `./phases/phase-03-sparse-and-hybrid-provenance/PLAN.md`
- Phase 4: `./phases/phase-04-chunker-tokenizer-provenance/PLAN.md`
- Phase 5: `./phases/phase-05-retrieval-runtime-drift-guard/PLAN.md`
- Phase 6: `./phases/phase-06-embedding-cache-and-cost-control/PLAN.md`
- Phase 7: `./phases/phase-07-eval-driven-retrieval-tuning/PLAN.md`
- Phase 8: `./phases/phase-08-acceptance-docs-and-closeout/PLAN.md`
- Phase 9: post-review release-quality closeout, tracked in `./ROADMAP.md` and
  `./STATE.md`

## Boundary Notes

- 这条线只处理已 admission 的 canonical retrieval chain，不重新打开 raw
  collector、source-specific scraping、notice routing taxonomy 或 campus services
  structured tools。
- `packages/ingestion-core` 继续拥有 offline data-plane、chunk preparation、index
  release 与 release manifest。
- `packages/retrieval-core` 继续拥有 Qdrant retrieval execution、hybrid query、
  filters、runtime drift guard 与 evidence shaping。
- `packages/rag-agent` / supervisor 只消费 retrieval evidence，不拥有 index release
  truth。
- structured runtime tools 继续读 projection / typed read model；不得为了方便把
  `campus_services/*` 或 generic notice card 回退成 retrieval alias。
- provider-response replay 不发布 serving alias；alias publish 只走 registry-scope
  release path。
- online retrieval runtime 不把 object-store manifest 作为 request-path 强依赖；runtime
  drift guard 首选 Qdrant point payload / current release metadata，object-store manifest
  只作为 audit-only / offline reference。

## Related Architecture

- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `docs/decisions/adr-0019-qdrant-physical-collection-retention-and-expiration.md`
- `docs/decisions/adr-0020-qdrant-cloud-backup-restore-and-object-store-transition.md`

## External Baseline

本 workstream 的 review baseline 参考以下外部一手资料，但实现 owner 仍以 repo
architecture 为准：

- OpenAI Embeddings guide (`https://platform.openai.com/docs/guides/embeddings`):
  model / dimensions are retrieval-critical runtime
  parameters.
- Qdrant hybrid queries (`https://qdrant.tech/documentation/concepts/hybrid-queries/`)
  and aliases (`https://qdrant.tech/documentation/concepts/collections/#collection-aliases`):
  dense+sparse prefetch, RRF, and alias switch are accepted serving shapes.
- Azure AI Search chunking guidance (`https://learn.microsoft.com/azure/search/vector-search-how-to-chunk-documents`):
  chunk size must preserve semantic context
  and respect token budgets.
- LlamaIndex ingestion pipeline (`https://docs.llamaindex.ai/en/stable/module_guides/loading/ingestion_pipeline/`):
  transformations and embedding cache are standard ingestion hardening patterns.
- Ragas metrics (`https://docs.ragas.io/`): retrieval acceptance should measure
  context precision / recall and faithfulness, not only index schema validity.
