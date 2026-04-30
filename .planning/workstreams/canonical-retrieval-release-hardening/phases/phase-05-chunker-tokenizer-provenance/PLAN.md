---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Plan: Phase 5 Chunker And Tokenizer Provenance

## Goal

Make chunk preparation reproducible across config, tokenizer, normalizer, and implementation
changes.

## Requirements

- Preparation manifest records tokenizer identity and chunker implementation identity.
- Release gate rejects preparation truth produced by stale tokenizer/chunker/normalizer identity
  when the collection requires preparation.
- Existing mandatory preparation scopes stay mandatory.
- Non-mandatory scopes remain backward-compatible.

## Implementation Tasks

1. Add RED tests.
   - Preparation manifest contains tokenizer/chunker fields.
   - Release rejects stale tokenizer identity.
   - Release rejects stale chunker implementation identity.
   - Old optional-scope manifests remain tolerated where preparation is not mandatory.

2. Add provenance resolver.
   - Tokenizer name/model and package version.
   - Chunking strategy implementation version.
   - Normalizer / document-units schema version where available.

3. Add manifest fields and hash.
   - Include provenance fields in manifest.
   - Include provenance in hash used by `require_verified_chunk_preparation`.

4. Update operator docs.
   - Config bump versus implementation bump rule.
   - When to rerun preparation.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_internal_notice_scope_chunk_pipeline \
  tests.ingestion.test_regulation_serving_release_gates \
  tests.ingestion.test_chunking_policy
uv run --all-packages ruff check <touched-python-files>
uv run --all-packages ruff format <touched-python-files> --check
pnpm docs:lint
```

## Done Criteria

- Preparation manifest tells which tokenizer/chunker produced the chunks.
- Release cannot consume stale mandatory preparation truth.
- Operator docs explain rerun requirements.
