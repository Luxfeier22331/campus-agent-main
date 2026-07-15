---
doc_type: reference
truth_scope: repository
owner_boundary: open-source-readiness
status: active
created: 2026-06-30
updated: 2026-07-13
---

# Public Source Data

## Boundary

This reference classifies data-like artifacts that may appear in the public
repository. It does not preserve a file-count snapshot, working-tree audit or
publication checklist. The governing policy is
`docs/policies/public-source-data.md`.

Runtime data, private content packs and current serving truth remain outside
the repository even when they use the same schemas as public fixtures.

## Allowed By Default

These categories may remain under the repository Apache-2.0 posture when they
are repo-authored and contain no source-derived institutional content:

- executable schemas, validators and runtime-neutral configuration;
- synthetic contract, parser, projection and UI fixtures;
- synthetic eval cases and mini-corpora;
- self-authored schematic SVGs and low-frequency seed data;
- source-shape examples with fictional names, URLs, identifiers and text.

Primary tracked roots include:

- `packages/contracts/fixtures/**`;
- `packages/eval-langfuse/assets/datasets/rag/**`;
- `apps/campus-web/test/fixtures/**`;
- `apps/source-collector/adapters/official-web/test/assertions/pages/**`;
- repo-authored profiles and schema-like files under `configs/ingestion/**` and
  `configs/sources/**`.

## Conditional Artifacts

Third-party or source-derived material may be tracked only when redistribution
rights, provenance, attribution and license compatibility are explicit.

Examples include:

- map tiles, GeoJSON, OSM-derived features and campus coordinates;
- photographs, logos and institution-owned visual media;
- copied regulations, notices, handbooks, curricula and website text;
- real document samples, OCR output or provider response payloads;
- third-party model/tokenizer assets.

Attribution alone does not grant redistribution rights. When rights are
unclear, keep the artifact in the private source/data boundary.

## Repository-Excluded Data

Do not commit:

- credentials, cookies, tokens, private endpoints or database connection
  strings;
- raw notices, collected pages, authenticated portal exports or attachments;
- canonical document artifacts, chunks, indexes, embeddings or Qdrant dumps;
- real institutional eval gold truth, qrels or reviewed badcases;
- object-store manifests, current pointers or environment serving state;
- local generated reader assets, crawl output, logs, traces or closeout files.

These artifacts belong to provider systems, object storage, databases,
Langfuse, deployment secret management or private data repositories according
to their owning contract.

## Path Guidance

### Campus Web Assets

Repo-authored dining floorplan SVGs may remain as schematic UI assets. Real
dining photographs and map data do not belong in
`apps/campus-web/public/**`; runtime map data is delivered through the admitted
object-storage boundary.

### Collection And Source Config

`configs/ingestion/**` and `configs/sources/**` may expose reusable schema,
policy and synthetic source shapes. Real source selection, reviewed split
manifests, institution URLs, release pointers and source-derived corpora remain
private.

### Contract And Eval Fixtures

Contract fixtures and public Langfuse dataset cases must stay synthetic. Real
institutional cases may use the same schema from a private asset root or an
approved private Langfuse dataset without being copied into git.

## Verification

- `pnpm repo:static` checks formatting and text hygiene only; it is not a
  source-license or source-clean validator.
- Owning package/app tests validate fixture shape and executable contracts.
- Pre-commit and PR CI run Gitleaks for secret hygiene.
- A public release requires a separate git-history secret and data review;
  working-tree checks do not prove history is publishable.
- Any new third-party/source-derived artifact must update `NOTICE`,
  `THIRD_PARTY_NOTICES.md` or the owning provenance document as applicable.

Dynamic file counts, sizes and cleanup history belong in tooling output and git
history, not in this reference.
