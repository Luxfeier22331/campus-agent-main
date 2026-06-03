# campus-shared

Shared constants and lightweight environment helpers for campus-agent v2.

Domain-specific regulation semantics live in `packages/regulation-semantics`;
do not add answer-ready evidence contracts, regulation registries, or domain
taxonomies here.

Provider-facing prompt execution lives in `packages/prompt-runtime`; do not
re-export prompt runtime classes or provider transport code from this package.
