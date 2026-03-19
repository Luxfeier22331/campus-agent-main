# Campus Agent

## What This Repo Is

Entry workflow system for the campus platform. Uses workflow-first orchestration (plain Python dataclasses + Protocol, no framework dependency).
Consumes `campusRag` as a downstream RAG service via adapter.

## Boundaries

- **Owns**: workflows, workflow/session persistence, tool routing, workflow-level HITL, entry response composition, downstream tool integration
- **Does NOT own**: RAG retrieval internals, Qdrant runtime truth, RAG ACL implementation, bundle/alias control plane

Do NOT move RAG retrieval, ACL, or bundle logic into this repo.

## Architecture

- Workflow engine: plain Python (labeled "agno_workflow_first" in config, but no Agno framework import)
- State persistence: `InMemoryWorkflowStateStore` (bootstrap; target: Supabase/Postgres)
- RAG integration: `CampusRagAdapter` wraps campusRag flat responses into canonical envelope
- Tools: 5 frozen tools, currently fixture-backed except RAG (mock-backed)

## Current State

- Phase 2A.1 in progress: `resume()` and `apply_user_choice()` implemented
- 46 tests passing across workflows, state, adapters, and tools
- All bootstrap gates (1/2/3) completed

## Frozen Tools

1. `campus_rag_search` — via CampusRagAdapter → campusRag `/api/search`
2. `campus_rag_answer` — via CampusRagAdapter → campusRag `/api/answer`
3. `campus_directory_lookup` — fixture-backed (`tools/directory/lookup.py`)
4. `campus_map_resolve` — fixture-backed (`tools/map/resolve.py`)
5. `campus_navigation_plan` — fixture-backed (`tools/navigation/plan.py`)

## Key Paths

- Workflow: `src/campus_agent/workflows/skeleton.py`
- State models: `src/campus_agent/state/models.py`
- State store: `src/campus_agent/state/store.py`
- RAG adapter: `src/campus_agent/adapters/rag.py`
- Config: `src/campus_agent/config/settings.py`
- Tests: `tests/`

## Cross-Repo Coordination

- Coordination docs: `/home/reptilian/code/_coordination/campus-platform/`
- Tool contract: `2026-03-19-tool-contract-v1.md` (all 5 tool schemas)
- Workflow state contract: `2026-03-19-workflow-state-v1.md`
- Decision log: `2026-03-19-decision-log.md`

Do not change shared contract fields without decision-log approval from the coordination owner.

## Running Tests

```bash
python3 -m unittest discover -s tests -t . -p 'test_*.py'
```
