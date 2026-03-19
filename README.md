# campus-agent

Workflow-first bootstrap scaffold for the campus entry agent.

## Scope of this bootstrap

- repo scaffold for a standalone `campus-agent` package
- explicit workflow state model with in-memory persistence skeleton
- mock RAG adapter that preserves the canonical v1 contract while mapping to the current `campusRag` runtime shape
- workflow skeleton with clear extension boundaries for directory, map, and navigation tools

## Current constraints

- `campus_rag_search` and `campus_rag_answer` are the only implemented tool paths in this bootstrap.
- `campus_directory_lookup`, `campus_map_resolve`, and `campus_navigation_plan` remain declared but intentionally unimplemented until their contracts freeze.
- `P-003` is still open, so actor snapshot and HITL payload persistence are kept as structured extension points instead of a frozen schema.

## Local verification

```bash
python3 -m unittest discover -s tests -t . -p 'test_*.py'
```

