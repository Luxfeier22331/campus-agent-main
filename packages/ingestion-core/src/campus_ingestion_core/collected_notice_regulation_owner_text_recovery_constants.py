from __future__ import annotations

PHASE_06_R1A_ID = "phase-06-r1a-regulation-owner-text-recovery-mini-batch"
PHASE_06_R1B_ID = "phase-06-r1b-regulation-owner-text-recovery-execution"

REGULATION_OWNER_TEXT_RECOVERY_TARGET = "regulation_owner_text_recovery"
REGULATION_OWNER_TEXT_RECOVERY_BATCH_SCHEMA_VERSION = (
    "collected_notice_regulation_owner_text_recovery_batch.v1"
)
REGULATION_OWNER_TEXT_EXECUTION_REPORT_SCHEMA_VERSION = (
    "collected_notice_regulation_owner_text_execution_report.v1"
)
REGULATION_OWNER_TEXT_ATTEMPT_PLAN_SCHEMA_VERSION = (
    "collected_notice_regulation_owner_text_attempt_plan.v1"
)
REGULATION_OWNER_TEXT_SEARCHABLE_MERGE_CONTRACT_SCHEMA_VERSION = (
    "collected_notice_regulation_owner_text_searchable_merge_contract.v1"
)
REGULATION_OWNER_TEXT_READINESS_GAP_REPORT_SCHEMA_VERSION = (
    "collected_notice_regulation_owner_text_readiness_gap_report.v1"
)

DEFAULT_REGULATION_OWNER_TEXT_RECOVERY_BATCH_LIMIT = 10
DEFAULT_REGULATION_OWNER_TEXT_SOURCE_SURFACES = ("file_release",)
DEFAULT_REGULATION_OWNER_TEXT_MEDIA_KINDS = ("pdf", "office")

PHASE_05_ID = "phase-05-multimodal-ocr-consumption-readiness"
PHASE_06_R1_ID = "phase-06-r1-regulation-candidate-audit-and-admission"
PHASE_06_R2_ID = "phase-06-r2-regulation-promotion-dry-run-and-gated-materialization"
