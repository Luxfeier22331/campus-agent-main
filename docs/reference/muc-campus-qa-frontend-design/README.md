---
doc_type: reference
truth_scope: product
owner_boundary: apps/campus-web
status: active
created: 2026-06-08
updated: 2026-06-08
---

# MUC Campus Q&A Frontend Design

This directory stores the frontend design input package for the MUC Campus Q&A
surface. It is a design reference, not runtime topology, deployment truth,
active implementation status, or the current dining feature contract.

For dining behavior and scope, the current source of truth is:

- `docs/architecture/domains/dining/architecture.md`
- `docs/contracts/app-api-dining-http.md`
- `docs/contracts/app-api-dining-ops-http.md`
- `docs/data/dining-operations-schema.md`

## Scope

The package defines the frontend experience direction for:

- assistant-first conversation entry
- conversation threads with inline source and attachment cards
- documentation pages
- campus map pages backed by GeoJSON-style place markers
- dining floorplan pages backed by SVG layout plus a separate name/price list
- a single global feedback entry

The design boundary is intentionally not an app launcher. Docs, map, dining
floorplan, and feedback are supporting pages around the Q&A experience.

## Contents

- `prototype/muc_campus_qa_design_prototype_v1_3.html`
  - high-fidelity static HTML prototype
- `screenshots/`
  - key page screenshots for visual reference
- `design-map/muc_campus_qa_design_map_v1_3.json`
  - page, route, content, and excluded-scope mapping
- `design-notes/muc_campus_qa_design_notes_v1_3.md`
  - product boundary and page structure notes
- `tokens/muc_campus_qa_design_tokens_v1_3_1.json`
  - DTCG-style design tokens
- `tokens/muc_campus_qa_design_tokens_v1_3_1.css`
  - CSS variable output for implementation
- `tokens/muc_campus_qa_tailwind_theme_v1_3_1.js`
  - Tailwind theme mapping example
- `tokens/muc_campus_qa_design_tokens_v1_3_1.md`
  - token usage notes
- `config/wrangler_v1_3_example.toml`
  - static preview example only

## Implementation Rules

- Treat `design-map/muc_campus_qa_design_map_v1_3.json` as historical design
  input for included and excluded UI scope. It does not override current
  dining contracts or implemented workspace behavior.
- Use the v1.3.1 token files as the implementation token source; avoid
  hardcoded component state values when a token exists.
- Do not read the Wrangler example as an app deployment architecture decision.
- Replace prototype-only placeholders with real authorized marks and real data
  sources during implementation.
- Do not add dining realtime status, route planning, local per-page feedback
  widgets, or right-side reference rails unless a later accepted design changes
  the design map.
