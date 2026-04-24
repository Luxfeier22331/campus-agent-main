---
doc_type: phase_summary
phase: "6"
phase_name: "Institutional Regulations Target Chunk-Prep Parity"
status: completed
completed: 2026-04-22
---

# Phase 6 Summary

Completed dual-lane target chunk-prep parity for
`regulations/institutional_rules` and `regulations/scoped_rules`.

Frozen parity contract:

- both lanes consume isolated `documents.json` plus isolated object-store root;
- both lanes emit `chunk-prep-manifest.json`, `validation-summary.json`, and
  `document-reports.jsonl`;
- each lane keeps collection-specific validation counters;
- stop point remains `offline_preparation`.

This enabled Phase 7 to run the full bounded acceptance rerun.
