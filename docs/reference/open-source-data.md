---
doc_type: reference
truth_scope: repository
owner_boundary: open-source-readiness
status: active
created: 2026-06-30
updated: 2026-06-30
---

# Open Source Data Inventory

This inventory classifies tracked source/data artifacts that are not ordinary
repo-owned source code. It exists to decide what can remain in a public
repository under the repo-level Apache-2.0 license posture, what needs upstream
attribution, and what should be removed or replaced before publication.

## Scope

Generated from tracked files in the `chore/open-source-readiness` worktree on
2026-06-30. Local artifacts under `.venv`, `target`, caches, worktrees and
ignored runtime output are out of scope.

This inventory is a working-tree fact report. The governing policy is
`docs/policies/public-source-data.md`.

## Summary

| Area | Files | Size | Risk |
| --- | ---: | ---: | --- |
| `apps/campus-web/public` | 10 | 48 KB | low |
| `apps/source-collector/adapters/official-web/test/assertions/pages` | 20 | 32 KB | low |
| `apps/campus-web/test/fixtures` | 3 | 20 KB | low |
| `configs/ingestion` | 111 | 1.1 MB | medium |
| `configs/sources` | 19 | 116 KB | low |
| `packages/eval-langfuse/test/fixtures` | 1 | 635 B | low |
| `packages/contracts/fixtures` | 31 | 27 KB | low |
| `packages/eval-langfuse/fixtures` | 4 | 9 KB | low |
| `docs/reference/eval` | 2 | 7 KB | low |

Medium-risk areas contain operational schemas or synthetic fixtures and require
static source-clean enforcement before public release. Low-risk areas can remain
after confirming examples are synthetic or attribution-only.

## Findings

### Campus Web Public Assets

Paths:

- `apps/campus-web/public/assets/dining/*.svg`
- `apps/campus-web/public/assets/dining/reviews/`
- `apps/campus-web/public/map-assets/`

Assessment:

- The dining floorplan SVG files are retained repo-authored schematic drawings
  for current UI tests and local campus-web rendering.
- Dining review photographs were temporary media and are not retained in the
  public repository.
- Real campus GeoJSON and tile assets are external map data. They are served
  through the runtime `/map-data/*` object-storage boundary and are not covered
  by the repository Apache-2.0 license grant.

Action:

- Keep self-authored dining SVGs under the repository Apache-2.0 posture.
- Keep `apps/campus-web/public/assets/dining/reviews/` empty unless media
  has explicit provenance and a separate publication decision.
- Do not commit real `apps/campus-web/public/map-assets/**` assets. Use the
  existing S3-compatible derived object store and the `/map-data/*` Worker proxy
  instead; map data lives under
  `campus_navigation/releases/map_data/...`, not in a feature-specific bucket.

### Official Web HTML Fixtures

Paths:

- `apps/source-collector/adapters/official-web/test/assertions/pages/*.html`

Assessment:

- These fixtures are synthetic structural pages that preserve parser DOM
  coverage without publishing real article/body text.
- Parser assertions cover listing/detail/directory/shell behavior against
  synthetic titles, names, body paragraphs, links and copyright text.

Action:

- Keep fixture filenames and selector coverage stable where tests depend on
  structure.
- Do not add source-derived article text, person names, ICP records or
  institution-owned body copy back into this fixture root.

### Campus Web Test Fixtures

Paths:

- `apps/campus-web/test/fixtures/map-page-data.ts`
- `apps/campus-web/test/fixtures/virtual-page-data.ts`

Assessment:

- The map page fixture uses synthetic places, coordinates and feature ids while
  preserving search, grouping, marker, polygon-selection and URL-state coverage.
- It does not publish real OSM feature ids, real campus coordinates or
  source-derived place descriptions.

Action:

- Keep as a small UI behavior fixture.
- Do not treat this fixture as campus map truth or as a replacement for licensed
  map data provenance.

### Campus Navigation Place Catalog

Paths:

- `configs/ingestion/campus_navigation/place_catalog/seed.v1.json`

Assessment:

- The retained place catalog is a repo-owned seed for self-authored, low-frequency
  map/place annotations.
- It is not a third-party tile set, official GeoJSON dump or runtime current
  serving truth.

Action:

- Keep while it remains self-authored and low-frequency.
- If place data is copied from third-party maps, official basemaps or
  source-derived files, move it to the private content/data boundary or document
  redistribution rights before publication.

### Ingestion Configs And Curated Corpora

Paths:

- `configs/ingestion/**`

Assessment:

- Runtime profiles, chunk profiles, canonical profiles and schema-like config
  are repo-owned operational config.
- Public repo historical notice batches, source projections, academic calendar
  source truth, curriculum split manifests, curriculum samples, student-rules
  split manifests, public regulation ledgers and routing eval JSONL files are
  synthetic contract fixtures.
- Real source-derived corpora, notice ids, campus URLs, reviewed split
  manifests, source projections, calendar releases and eval truth live in the
  private data/artifact boundary and are not licensed by the repository.

Action:

- Keep pure runtime/profile/schema config in repo.
- Keep only synthetic source-shape fixtures in the public repository.
- Do not add source-derived corpora or extracted text unless provenance,
  redistribution rights and license boundary are explicit.

### Source Configs

Paths:

- `configs/sources/**`

Assessment:

- Crawl policy, host allowlist, source site config and credential schema are
  repo-owned config.
- Source packs, target inventories and target source maps are syntheticized in
  the public repository and no longer encode true crawl targets.

Action:

- Keep host/policy/schema files after confirming they contain no credentials.
- Keep true operational source selection data in private data config.

### Test And Eval Fixtures

Paths:

- `packages/contracts/fixtures/**`
- `packages/eval-langfuse/test/fixtures/**`
- `packages/eval-langfuse/fixtures/**`
- `docs/reference/eval/*.json`

Assessment:

- Repo-tracked public fixtures under `packages/contracts/fixtures/**`,
  `packages/eval-langfuse/test/fixtures/**`,
  `apps/campus-web/test/fixtures/**` and `packages/eval-langfuse/fixtures/**`
  now use synthetic examples for schema, parser, projection, qrels and
  dataset-manifest smoke coverage.
- Real curriculum, handbook, institutional-rules and official-web qrels /
  answer-quality truth must live outside the public repository as private
  release data or Langfuse datasets.
- `pnpm repo:static` runs public source-clean guards to reject known
  source-derived institution tokens in public fixture text files, public web
  assets and tracked source/data config under `configs/ingestion/**` and
  `configs/sources/**`.
- The fixtures do not appear to contain real secrets from the sampled scans,
  but this inventory is not a git-history secret audit.

Action:

- Keep synthetic contract fixtures.
- Keep public RAG/eval fixtures as synthetic mini-corpora only.
- Do not reintroduce source-derived gold cases into these public fixture roots
  unless the source license and redistribution boundary are explicit and the
  static source-clean policy is intentionally updated.

## Publication Gate

Before making the repository public:

1. Keep source/data config and fixtures synthetic unless redistribution rights
   are explicit.
2. Add explicit provenance notes for retained repo-authored assets.
3. Keep source-derived data outside the repo unless it has clear redistribution
   rights and a documented license boundary.
4. Run a separate git-history secret scan. This inventory only covers tracked
   working tree content.
