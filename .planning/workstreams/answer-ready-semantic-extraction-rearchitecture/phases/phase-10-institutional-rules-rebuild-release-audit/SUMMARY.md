---
doc_type: phase_summary
status: completed
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 10 Institutional Rules Rebuild Release Audit

## Result

Phase 10 is complete. `regulations/institutional_rules` now has real v3 rebuild/release/adoption
evidence through the frozen regulation RAG release lane, including fresh chunk preparation,
release-admission proof, retrieval acceptance, component eval attachment, alias publish and runtime
readiness probe.

## Changed Files

- `packages/shared/src/campus_shared/regulation_semantic_registry.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_semantics.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py`
- `tests/ingestion/test_institutional_regulation_semantic_regressions.py`
- `tests/shared/test_regulation_semantic_regressions.py`
- `.planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/SUMMARY.md`

## Key Outcomes

- Real institutional profile residual semantic conflicts were closed without weakening release
  gates:
  - positive confidentiality/security requirements now resolve to
    `security_or_confidentiality_requirement` instead of being forced into exclusion-only semantics
  - mixed condition/procedure child splitting now keeps true procedure-only formal-regulation
    clauses as `procedure_step` instead of fabricating `eligibility_condition` heads
- Fresh institutional prep/admission succeeded on the real `institutional_rules_semantic_v1`
  profile:
  - `prep-20260508-022800`
  - `admit-20260508-institutional-rules-v7`
  - `answer_ready_contract_version=answer_ready_evidence.v3`
  - `answer_ready_contract_status=passed`
  - `semantic_oracle_status=passed`
  - `fallback_budget_status=passed`
- Real registry-scope release succeeded and published serving alias:
  - `release_id=r20260507_183741_842762_06e3f390`
  - `physical_collection_name=institutional_rules__r20260507_183741_842762_06e3f390`
  - `previous_physical_collection_name=institutional_rules__r20260507_032508_168288_34ba55ee`
  - `retrieval_acceptance_status=passed`
  - `component_eval_status=passed`
  - `post_publish_audit_status=passed`
  - `release_manifest_field_audit_status=passed`
  - `admission_manifest_field_audit_status=passed`
  - `cross_check_status=passed`
- Runtime probe now shows current serving truth is healthy:
  - alias target is the latest physical collection
  - release metadata guard passes
  - readiness status is `ready`
- The release lane remained fail-closed during execution:
  - stale prep fingerprints were rejected until fresh prep was regenerated
  - remote Qdrant WAL exhaustion blocked publish until repo-governed preview GC reclaimed space
  - no release gate, fingerprint rule or payload metadata guard was weakened

## Artifacts

- prep report:
  - `.planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_prepare_registry_scope_chunks_report_v3.json`
- admission report:
  - `.planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_release_admission_report_v7.json`
- release report:
  - `.planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_registry_scope_release_report_v7.json`
- runtime probe:
  - `.planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_runtime_probe_v2.json`
- release/admission manifest field audit:
  - `.planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_release_manifest_field_audit_v1.json`
- component eval summary used by admission/release:
  - `.planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_preview_component_eval_summary.json`
- Qdrant preview GC evidence:
  - `.planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_qdrant_gc_delete_r20260507_160544_038218_5df5b8b0.json`
  - `.planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_qdrant_gc_delete_r20260507_182003_116643_6af76967.json`
  - `.planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/qdrant_gc_preview_candidates_space_recovery.jsonl`

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline tests.shared.test_regulation_semantic_registry tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance tests.ingestion.test_institutional_regulation_semantic_regressions tests.shared.test_regulation_semantic_regressions -q
```

Result: `Ran 125 tests in 0.081s` and `OK`.

```bash
uv run --all-packages python -m campus_ingestion_worker.prepare_registry_scope_chunks --corpus regulations --collection institutional_rules --preparation-run-id prep-20260508-022800
```

Result: `validation_status=passed`, `document_count=59`, `chunk_count=2594`.

```bash
uv run --all-packages python -m campus_ingestion_worker.admit_regulation_rag_release --corpus regulations --collection institutional_rules --preparation-run-id prep-20260508-022800 --admission-run-id admit-20260508-institutional-rules-v7 --component-eval-summary-path .planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_preview_component_eval_summary.json
```

Result: `answer_ready_contract_status=passed`, `semantic_oracle_status=passed`,
`fallback_budget_status=passed`.

```bash
uv run --all-packages python -m campus_ingestion_worker.release_registry_scope --corpus regulations --collection institutional_rules --preparation-run-id prep-20260508-022800 --release-admission-manifest-key regulations/operations/regulation-rag-release-admission/admit-20260508-institutional-rules-v7/institutional_rules/release-admission.json --acceptance-case-path packages/evals/fixtures/institutional_rules_release_acceptance.v1.json --component-eval-summary-path .planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_preview_component_eval_summary.json --publish-alias
```

Result: `release_id=r20260507_183741_842762_06e3f390`, `retrieval_acceptance_status=passed`,
`component_eval_status=passed`, `post_publish_audit_status=passed`,
`release_admission_status=passed`.

```bash
uv run --all-packages python -m campus_ingestion_worker.probe_regulation_rag_release_runtime --scope regulations/institutional_rules
```

Result: `alias_target=institutional_rules__r20260507_183741_842762_06e3f390`,
`release_metadata_guard_status=passed`, `readiness_status=ready`.

```bash
uv run --all-packages python -m campus_ingestion_worker.audit_regulation_rag_release_manifests --corpus regulations --collection institutional_rules --release-id r20260507_183741_842762_06e3f390 --output-path .planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_release_manifest_field_audit_v1.json
```

Result: `overall_status=passed`, `answer_ready_contract_version=answer_ready_evidence.v3`,
`release_manifest_missing_fields=[]`, `admission_manifest_missing_fields=[]`,
`cross_check_issues=[]`.

## Residual Gaps

- Legacy old-index quarantine and workstream closeout docs remain owned by Phase 11.
- Older published institutional releases still exist in the release family, but current serving
  alias now points to a fully admitted/component-eval-attached release and runtime guard passes.

## Next Phase

Phase 11: Legacy Quarantine Docs Closeout.
