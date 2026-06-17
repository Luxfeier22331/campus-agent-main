---
doc_type: index
truth_scope: capability
owner_boundary: domains/dining
status: active
created: 2026-06-08
updated: 2026-06-11
---
# Dining Domain Hub

## Canonical Reading Order

1. `architecture/domains/dining/architecture.md`
   - dining domain owner、draft/release candidate/release/published projection
     与 navigation boundary
2. `decisions/adr-0055-unified-operator-console-surface.md`
   - 为什么 dining operations 属于统一 Operator Console，而不是第二个长期后台产品
3. `decisions/adr-0049-campus-ops-control-plane.md`
   - candidate-first release control plane 与 dining lifecycle boundary
4. `contracts/app-api-operator-ops-http.md`
   - ops authz、error、release、audit 横切 contract
5. `contracts/app-api-dining-ops-http.md`
   - dining ops accepted target endpoints、current implementation gap 与 reserved
     source observation boundary
6. `data/dining-operations-schema.md`
   - `dining.*` schema ownership 与 object boundary
7. `architecture/system/operator-console-operations-architecture.md`
   - Operator Console operations domain 与当前 `operator-console-web` Worker
     shell / proxy allowlist

## Boundary Summary

- `apps/app-api` owns dining draft, release candidate, release, audit and
  published projection truth.
- Operator Console is the long-term operator workspace concept; current dining
  operations implementation surface is `apps/operator-console-web`.
- `apps/campus-web` reads only published `/api/dining/*` and never reads draft or
  release candidate state.
- Source observations are reserved proposal inputs, not current implemented route
  surface or student-visible truth.
- Dining floor/window geometry is not navigation spatial truth.
