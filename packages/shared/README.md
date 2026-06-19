# campus-shared

Shared constants and lightweight environment helpers for campus-agent v2.

Domain-specific regulation semantics live in `packages/regulation-semantics`;
do not add answer-ready evidence contracts, regulation registries, or domain
taxonomies here.

Provider-facing online model execution is owned by app/runtime boundaries via
provider-config profiles; do not re-export provider transport code from this
package.
