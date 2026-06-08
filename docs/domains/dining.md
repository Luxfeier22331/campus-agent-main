---
doc_type: index
status: active
created: 2026-06-08
updated: 2026-06-08
---
# Dining Domain Hub

## Canonical Reading Order

1. `architecture/domains/dining/architecture.md`
   - dining domain owner、draft/release/published projection 与 navigation boundary
2. `decisions/adr-0049-campus-ops-control-plane.md`
   - 为什么新建 `apps/campus-ops-web` 与 draft -> publish control plane
3. `contracts/app-api-campus-ops-http.md`
   - ops authz、error、release、audit 横切 contract
4. `contracts/app-api-dining-ops-http.md`
   - dining ops implemented HTTP endpoints 与 future source observation contract
5. `data/dining-operations-schema.md`
   - `dining.*` schema ownership 与 object boundary
6. `architecture/system/campus-ops-web-architecture.md`
   - `campus-ops-web` Worker shell、proxy allowlist 与 workspace boundary

## Boundary Summary

- `apps/app-api` owns dining draft, release, audit and published projection truth.
- `apps/campus-ops-web` is the operator workspace.
- `apps/campus-web` reads only published `/api/dining/*`.
- Source observations are proposal inputs, not student-visible truth.
- Dining floor/window geometry is not navigation spatial truth.
