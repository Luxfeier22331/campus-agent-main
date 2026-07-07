# campus-shared

Shared constants and lightweight environment helpers for campus-agent v2.

Domain-specific regulation semantics do not live in this package. Do not add
answer-ready evidence contracts, regulation registries, or domain taxonomies
here; if they are needed again, re-admit them under the current ingestion owner
boundary instead of restoring a shared Python package.

Provider-facing online model execution is owned by app/runtime boundaries via
provider-config profiles; do not re-export provider transport code from this
package.
