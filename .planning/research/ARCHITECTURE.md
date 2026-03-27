# Architecture Research

**Domain:** Supervisor-led multi-agent campus QA with retrieval-backed specialist handoffs  
**Researched:** 2026-03-23  
**Confidence:** MEDIUM

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────┐
│ Runtime / Transport boundary (apps/supervisor-api, traps, ACL)│
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐      │
│  │ Supervisor   │──▶│ Auth + ACL   │──▶│ Trace / Audit │      │
│  │ API ingress  │   │ filtering    │   │ enrichment   │      │
│  └────┬─────────┘   └────┬──────────┘   └────┬──────────┘      │
├──────────────────────────────────────────────────────────────┤
│ Orchestration boundary (packages/supervisor-core + specialist)│
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐      │
│  │ Supervisor   │──▶│ Contract     │──▶│ RAG Specialist│──▶   │
│  │ policy/router│   │ validation   │   │ (packages/    │      │
│  └────┬─────────┘   └────┬──────────┘   └────┬──────────┘      │
├──────────────────────────────────────────────────────────────┤
│ Contract / Data plane boundary (packages/contracts + ingestion)│
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐      │
│  │ Contracts /  │──▶│ Registries   │──▶│ Chunk + Index │      │
│  │ schema       │   │ (document /  │   │ layer (Qdrant)│      │
│  └──────────────┘   └──────────────┘   └──────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

The diagram emphasizes the runtime boundary housed in `apps/`, the policy-driven orchestration in `packages/supervisor-core` and the separate contract/data plane layers (`packages/contracts`, ingestion, retrieval, object storage) described in the long-term architecture docs.

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `apps/supervisor-api` | Transport/runtime ingress, request/response glue, ACL enforcement, trace propagation, HTTP/websocket adapters | Lightweight FastAPI/Agno AgentOS entry point that only passes structured payloads to supervisor-core |
| `packages/supervisor-core` | Global policy routing, intent normalization, specialist selection, multi-stage upgrades (clarify/reject/synthesize), auditing, evidence scoring | Decision graph, retry loop, policy filters that call specialists via contracts |
| `packages/contracts` | Typed handoffs (request, evidence, document, chunk metadata), audit payload shapes, ACL collateral | Pure schema bundle shared with supervisor, specialist, retrieval, and evaluation |
| `packages/rag-specialist` | Retrieval-facing worker, query rewriting, retrieval strategy, evidence normalizer, confidence summarizer | Adapter around LlamaIndex/Agno specialist agents that obey the contract schema |
| `packages/retrieval-core` | Retrieval abstraction layer, evidence bundling, registry lookups, vector store connectors (Qdrant) | Reusable retrieval kernel without infra-specific types |
| `packages/ingestion-core` | Ingestion/data plane logic: dedupe, parser, chunking, embedding writes, registry updates, stable IDs | Queue consumer logic running inside ingestion-worker shell |
| `apps/ingestion-worker` | Ingestion runtime shell, queue polls, MinIO writers, job lifecycle control | Agnostically hosts ingestion-core, handles source/derived object paths |
| `packages/evals` | Baselines, trace-based grading, runbooks, gating, smoke scenarios that exercise supervisor/specialist flows | Runner/expectation library separate from live request path |
| `packages/shared` | Minimal shared constants/utilities (types, logging, config) that are safe to re-export | General helpers without business logic |

### Boundaries

- **Runtime boundary:** `apps/supervisor-api` (query-serving) and `apps/ingestion-worker` (data-plane runtime). These layers own transport concerns (FastAPI, Agno host, HTTP/webhook specifics) and keep framework dependencies out of the logic packages.
- **Orchestration boundary:** `packages/supervisor-core` and `packages/rag-specialist` host the supervisor-led policies and specialist logic. This boundary owns multi-agent coordination and encapsulates workflow concerns.
- **Contract boundary:** `packages/contracts` freezes the schema for requests, evidence bundles, document and chunk metadata, ACL tags, and audit payloads. All interactions between runtime/orchestration/data-plane layers go through these contracts so retrieval or infrastructure specifics never leak into the orchestrator.

## Brownfield Migration Implications

- Legacy `campusRAG` was a flat RAG tool; migrating it means replacing that tool with a specialist that satisfies the new handoff contract rather than reusing the old API. The supervisor remains the single entry point, so the migration path traces: old `/api/search` → supervisor entry + new contract, not a direct call from the client to `rag-specialist`.
- Evidence sources must first align with the ingestion/data plane (`packages/ingestion-core`, MinIO, Qdrant) so that the new retrieval core can serve the same documents. Rebuilding the contracts upfront avoids patching supervisor with ad-hoc fields later.
- Avoid pulling retrieval or index details back into `packages/supervisor-core`; instead wrap the legacy Qdrant/LlamaIndex layers inside `packages/rag-specialist` and keep `packages/contracts` agnostic of those implementations.
- Deployment order follows the stabilized path: contract → ingestion/data-plane → retrieval → supervisor → evals. This keeps the migration manageable and ensures each layer has reliable inputs.

## Recommended Project Structure

```
apps/
├── supervisor-api/           # runtime transport for query-serving
└── ingestion-worker/         # ingestion shell, queue consumer, job lifecycle
packages/
├── supervisor-core/          # global policy router, intent normalization, audit projection
├── rag-specialist/           # retrieval-specialist handler
├── retrieval-core/           # registry + vector store abstraction
├── ingestion-core/           # dedupe/chunk/embedding pipeline
├── contracts/                # shared declaration of request/evidence/doc/chunk schema
├── evals/                    # trace-based baselines and smoke tests
└── shared/                   # minimal helpers, constants, logging
docs/                          # reference architecture, ADRs, plans
.planning/                     # project runway, research, codebase maps
```

### Structure Rationale

- **apps/** isolates transport/runtime code (FastAPI/Agno) so policy packages remain framework-agnostic; it also defines the runtime boundary required by the brownfield constraints.
- **packages/supervisor-core** plus **rag-specialist** form the orchestrator/specialist split required by the supervisor-led system; combining them would risk recreating the old flat campusRAG tool.
- **packages/ingestion-core** and **packages/retrieval-core** keep ingestion/data plane logic out of online query routing while providing clear build targets for MinIO/Qdrant-based storage and retrieval.

## Architectural Patterns

### Pattern 1: Supervisor-as-Manager
**What:** A single supervisor orchestrator routes every incoming request, normalizes intent, enforces ACLs, and decides which specialist(s) to call.  
**When to use:** Multi-domain agent system where coordination, auditing, and policy upgrades must remain centralized.  
**Trade-offs:** Central control simplifies governance but becomes a single point of failure in the absence of health monitoring; mitigate with retries and circuit breakers.  
**Example:**

```python
async def handle_request(payload):
    request = contracts.Request.parse(payload)
    if not acl.check(request.user):
        return deny("permission")
    specialist = selector.choose(request.corpus)
    evidence = await specialist.retrieve(request.query, request.constraints)
    return supervisor.synthesize(evidence, request.user)
```

### Pattern 2: Explicit Specialist Handoff
**What:** Supervisor and specialist only communicate via `packages/contracts`, keeping retrieval/internal logic hidden.  
**When to use:** Brownfield migration from `campusRAG`—wrap the legacy retrieval stack in `rag-specialist` and expose only contract-friendly evidence bundles.  
**Trade-offs:** Adds boilerplate serialization but preserves the ability to swap retrieval backends; avoids leaking vector store or MinIO details into supervisor.  
**Example:**

```python
response = specialist_client.call({
    "request": contracts.RequestSchema.dump(request),
    "constraints": contracts.ACLTagList.dump(acls),
})
evidence = contracts.EvidenceBundle.load(response["evidence"])
```

### Pattern 3: Layered Data Plane
**What:** Separate raw assets, processed artifacts, document registry, and chunk/index layers.  
**When to use:** When ingestion pipelines produce mutable data that must be versioned and audited (Phase 1 uses MinIO + Qdrant).  
**Trade-offs:** Initial operational overhead in storing multiple artifacts, but it unlocks reprocessing, traceability, and extensibility without breaking the query pipeline.

## Build Order Implications

1. **Contracts first:** Freeze document, chunk, evidence, ACL, and audit schema (`packages/contracts`) so orchestrator, ingestion, and specialist implementations share stable types.
2. **Ingestion/data-plane second:** Deploy ingestion workers plus MinIO buckets and registries to create source/derived artifacts referenced by queries.
3. **Retrieval core third:** Build Qdrant connectors + evidence bundler so specialists can return canonical chunks to supervisor.
4. **Supervisor core fourth:** Wire up policy routing and specialist selection once retrieval and ingestion provide reliable data.
5. **Evals last:** Layer smoke/regression tests once the pipeline is stable rather than letting evals drive architectural decisions.

## Data Flow

### Request Flow

```
[User] 
    ↓
[apps/supervisor-api (runtime boundary)] 
    ↓
[supervisor-core intent framing + policy routing]
    ↓
[rag-specialist (retrieval specialist)] → [packages/retrieval-core + Qdrant + Document registry]
    ↓
[contracts.evidence bundle] 
    ↓
[supervisor synthesis & audit projection] 
    ↓
[apps/supervisor-api, response]
```

ACL filtering and trace propagation happen at the runtime boundary, but actual evidence collection and registry lookups stay within the specialist and retrieval layers, matching the architecture doc’s requirements.

### State Management

State lives in the document registry, raw asset registry, and chunk/index layers so operator code stays stateless. Query-serving code subscribes to these registries through retrieval-core helpers, while ingestion-core writers update them in transactional steps.

### Key Data Flows

1. **Query-serving (phase-1):** `apps/supervisor-api → supervisor-core → rag-specialist → retrieval-core → Qdrant + registry → evidence bundle → supervisor-core → response`. ACL filters and contract validation happen before the specialist call; the evidence bundle carries document IDs, chunk IDs, ACL tags, and trace IDs for audit.
2. **Ingestion/data plane:** `crawler/job → queue → apps/ingestion-worker → ingestion-core (dedupe → parse → chunk → embed → MinIO + registries) → Qdrant chunk metadata`. Stable IDs (`document_id`, `version_id`, `chunk_id`) are assigned before registry writes so retrieval core can always resolve sources.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-1k users | Single supervisor + specialist instance, local MinIO/Qdrant, synchronous retrieval, manual ingestion worker ops. |
| 1k-100k users | Horizontalize supervisor replicas, add queue-backed request throttling, scale ingestion workers and Qdrant read replicas, add caching in retrieval-core for hot documents. |
| 100k+ users | Partition corpora across vector indexes, introduce read-only replicas for document registry, split ingestion into regional pipelines with dedicated MinIO, consider sharding supervisors per campus context. |

### Scaling Priorities

1. **Retrieval throughput:** Qdrant or vector index concurrency is the first bottleneck; pre-warm cache, split indexes per corpus, or add async batching.
2. **Ingestion throughput:** Processing raw documents becomes the second bottleneck; scale queue workers, shard MinIO buckets, and emit ACL-aware checkpointing logs to keep pipelines observable.

## Anti-Patterns

### Anti-Pattern 1: Flattening retrieval into supervisor
**What people do:** They pull vector DB calls and chunk metadata handling directly into `packages/supervisor-core`, effectively recreating the old campusRAG tool.  
**Why it's wrong:** It leaks infrastructure details, couples the orchestrator with Qdrant/LlamaIndex, and makes it impossible to swap retrieval backends without touching policy logic.  
**Do this instead:** Wrap Qdrant + evidence enrichment entirely in `packages/retrieval-core` and `packages/rag-specialist`, exposing only contract-approved evidence bundles.

### Anti-Pattern 2: Mixing ingestion and query paths
**What people do:** They reuse ingestion-worker code paths for online queries or let the query API access raw MinIO assets directly.  
**Why it's wrong:** It violates the runtime/data-plane boundary, risks reprocessing delays affecting query latency, and blurs audit responsibilities.  
**Do this instead:** Keep ingestion workers in `apps/ingestion-worker` with queue-triggered flows and limit queries to evidence bundles produced via retrieval-core.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| MinIO (S3-compatible) | Ingestion-core writes source/derived artifacts to bucket-separated paths (`campus-rag-source`, `campus-rag-derived`) | Phase-1 uses local MinIO but treats it as S3; source bucket prefixes are `pdf/`, `ocr/`, `source-truth/`, and derived bucket prefixes remain corpus-scoped to ease future cloud migration. |
| Qdrant | Retrieval-core manages chunk metadata and vector search, specialist queries Qdrant through abstraction | Qdrant remains the canonical chunk store; any exports for backup are derived copies only. |
| Agno / OpenAI Agents SDK (optional) | Supervisor API or rag-specialist can host Agno agent wrappers while keeping contracts pure | Allow Agno for runtime hosting but do not leak Agno-specific types into contracts or retrieval-core. |
| Observability stack (tracing/logs) | Runtime boundary enriches requests with trace IDs that flow through supervisor-core and into evidence bundles | Provides auditability required by governance (user, route, source, status). |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `apps/supervisor-api` ↔ `packages/supervisor-core` | HTTP/JSON or in-process call | Runtime boundary keeps transport concerns isolated; supervisor-core only sees structured requests. |
| `packages/supervisor-core` ↔ `packages/rag-specialist` | Contract-based API + evidence bundle | All interactions respect `packages/contracts`; supervisor never inspects specialist internals. |
| `packages/rag-specialist` ↔ `packages/retrieval-core` | Library call or RPC | Retrieval-core abstracts vector store and registry queries; specialist focuses on query strategy. |
| `apps/ingestion-worker` ↔ `packages/ingestion-core` | Queue messages → ingestion routines | Ingestion worker passes job payloads; ingestion-core handles dedupe, chunking, registry writes. |
| `packages/contracts` ↔ All packages | Schema-only import | Contracts connect runtime, orchestration, ingestion, and evaluation layers; no infra leakage allowed. |

## Sources

- OpenAI, “A practical guide to building AI agents” (accessed 2026-03-23).  
- Microsoft Azure Architecture Center, “AI agent design patterns” (accessed 2026-03-23).  
- `docs/architecture/long-term-architecture.md` (2026-03-22).  
- `docs/architecture/phase1-ingestion-and-storage-architecture.md` (2026-03-22).

---
*Architecture research for: supervisor-led multi-agent campus QA system*  
*Researched: 2026-03-23*
