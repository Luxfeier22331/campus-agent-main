---
doc_type: evidence
status: captured
created: 2026-04-28
updated: 2026-04-28
phase: Phase 8
workstream: authenticated-notice-service-status-consumption
---
# Phase 8 Evidence: Broader Live Family Coverage

<!-- markdownlint-disable MD013 -->

## Scope

Phase 8 uses real authenticated notice export samples to validate broader
service-status family coverage after the Phase 7 `355650` live loop.

Selected notice ids:

- `247726` — campus-card / network-fee / electricity-fee recharge shutdown
- `352345` — library holiday opening arrangement
- `354502` — logistics comprehensive service hall holiday service window
- `354575` — campus hospital holiday duty window
- `354674` — information portal maintenance outage
- `354845` — Fengtai campus hospital dermatology clinic opening

## Evidence Files

- `source-candidate-audit.json` records the source export search and selected
  candidates.
- `selected-bundle.json` and `selected-bundle-manifest.json` are the bounded
  real-source sample bundle.
- `consumer-admission-manifest.json` admits the six selected notices using
  `upsert_selected` semantics.
- `notice-consumption-projection-rebuild.json` records rebuilt
  `notice_consumption_projection` entries.
- `service-status-candidate-list.json` records ready service-status candidate
  rows after rebuild.
- `service-status-preview-current-20260428/` is current-as-of preview evidence.
- `service-status-preview-20260211/`,
  `service-status-preview-20251002/`, and
  `service-status-preview-20251230/` are historical as-of preview evidence.

## Preview Results

| Anchor | Materialized records | Notes |
| --- | --- | --- |
| `2026-04-28T12:20:00+08:00` | `354845` | Current preview only; not promoted to PG current truth. |
| `2026-02-11T21:00:00+08:00` | `354502`, `354575`, `354674` | Historical comprehensive service hall, campus hospital and information portal windows. |
| `2025-10-02T12:00:00+08:00` | `352345` | Historical library holiday service window. |
| `2025-12-30T12:00:00+08:00` | `247726` | Historical campus-card recharge shutdown window. |

## Boundary Notes

- These previews are evidence only. Phase 8 does not replace the Phase 7 PG
  current read model.
- Historical notices are validated with as-of preview anchors instead of being
  promoted as current truth.
- Regulation, schedule, service-guide, contact-directory and generic
  notice-query records are not counted as service-status success.
