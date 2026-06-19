# campus-regulation-semantics

Owner package for regulation semantic registries, answer-role taxonomy, and
answer-ready evidence metadata contracts.

This package owns regulation-domain semantics that are consumed by ingestion,
retrieval, RAG answer shaping, and evals. Generic constants, environment
bootstrap, and provider config remain in `campus-shared`; concrete provider
execution stays behind app/runtime boundaries.
