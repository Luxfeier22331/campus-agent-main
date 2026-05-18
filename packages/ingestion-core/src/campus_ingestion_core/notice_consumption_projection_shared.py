from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now

DEFAULT_NOTICE_CONSUMPTION_PROJECTION_SCHEMA = "ingestion_projection"
DEFAULT_NOTICE_CONSUMPTION_PROJECTION_TABLE = (
    f"{DEFAULT_NOTICE_CONSUMPTION_PROJECTION_SCHEMA}.notice_consumption_projection"
)
DEFAULT_NOTICE_CONSUMPTION_PROJECTION_ENV_KEY = "NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL"
DEFAULT_NOTICE_CONSUMPTION_PROJECTION_OPERATOR_ENV_KEY = (
    "NOTICE_CONSUMPTION_PROJECTION_OPERATOR_DATABASE_URL"
)

NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED = "internal_notice_restricted"
NOTICE_SOURCE_FAMILY_OFFICIAL_WEB_PUBLIC = "official_web_public_notice"
NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC = "wechat_public_notice"

NOTICE_PRIMARY_ROLE_NOTICE_WINDOW = "notice_window"
NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY = "attachment_rule_body"
NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE = "annual_cycle_rule"
NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE = "time_bound_operational_rule"
NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE = "procurement_notice"
NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION = "roster_publication"
NOTICE_PRIMARY_ROLE_LECTURE_ACTIVITY = "lecture_activity"
NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE = "service_status_override"
NOTICE_PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE = "special_service_notice"
NOTICE_PRIMARY_ROLE_STABLE_CONTACT_UPDATE = "stable_contact_update"
NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE = "attachment_form_template"

NOTICE_SEMANTIC_OWNER_NOTICE_BODY = "notice_body"
NOTICE_SEMANTIC_OWNER_ATTACHMENT_DOCUMENT = "attachment_document"
NOTICE_SEMANTIC_OWNER_WRAPPER_NOTICE = "wrapper_notice"
NOTICE_SEMANTIC_OWNER_AUTHORITY_PENDING = "authority_pending"

NOTICE_DEFAULT_AGENT_NOTICE = "notice-agent"
NOTICE_DEFAULT_AGENT_RAG = "rag-agent"
NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES = "campus-services-agent"

NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY = "notice_level_query"
NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY = "procurement_notice_history"
NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE = "regulations/*"
NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES = "regulations/institutional_rules"
NOTICE_TARGET_SURFACE_SCOPED_RULES = "regulations/scoped_rules"
NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE = "campus_services/service_status_candidate"
NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE = "campus_services/special_service_candidate"
NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE = "campus_services/stable_contact_candidate"
NOTICE_TARGET_SURFACE_PUBLICATION_CANDIDATE = "publication_surface_candidate"
NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE = "multimodal_processing_candidate"
NOTICE_TARGET_SURFACE_UNSUPPORTED = "unsupported"

NOTICE_TARGET_SURFACE_NOTICE_RUNTIME = NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY
NOTICE_TARGET_SURFACE_SERVICE_STATUS_RUNTIME = NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE

NOTICE_TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW = "announcement_window"
NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED = "standing_until_replaced"
NOTICE_TEMPORAL_POLICY_EXPLICIT_YEAR_ONLY = "explicit_year_only"
NOTICE_TEMPORAL_POLICY_TIME_WINDOWED = "time_windowed"
NOTICE_TEMPORAL_POLICY_POINT_IN_TIME_PUBLICATION = "point_in_time_publication"
NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE = "current_override"

NOTICE_COMPLETENESS_COMPLETE = "complete"
NOTICE_COMPLETENESS_AUTHORITATIVE_ATTACHMENT_MISSING = "authoritative_attachment_missing"
NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING = "requires_multimodal_processing"
NOTICE_COMPLETENESS_REFERENCE_ONLY = "reference_only"

NOTICE_ANSWERABILITY_ANSWERABLE = "answerable"
NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE = "body_only_answerable"
NOTICE_ANSWERABILITY_REFERENCE_ONLY = "reference_only"
NOTICE_ANSWERABILITY_NOT_ANSWERABLE = "not_answerable"

NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY = "retained_for_notice_query"
NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET = "ready_for_target_materialization"
NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING = "pending_multimodal_processing"
NOTICE_CONSUMPTION_STATUS_NO_ADOPTION = "no_adoption"

NOTICE_CONSUMPTION_STATUS_NOTICE_RUNTIME = NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY


@dataclass(frozen=True, slots=True)
class NoticeConsumptionProjectionEntry:
    source_family: str
    source_corpus: str
    source_collection: str
    source_notice_id: str
    unit_id: str
    primary_role: str
    semantic_owner: str
    default_agent: str
    target_surface: str
    temporal_policy: str
    completeness_status: str
    answerability: str
    consumption_status: str
    source_notice_document_id: str
    source_document_id: str | None = None
    source_attachment_ref_ids: tuple[str, ...] = ()
    source_notice_release_time: str | None = None
    role_metadata: dict[str, Any] = field(default_factory=dict)
    updated_at: str = field(default_factory=utc_now)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> NoticeConsumptionProjectionEntry:
        raw = dict(payload)
        raw["source_attachment_ref_ids"] = tuple(
            str(item).strip()
            for item in list(raw.get("source_attachment_ref_ids") or [])
            if str(item).strip()
        )
        raw["role_metadata"] = dict(raw.get("role_metadata") or {})
        return cls(**raw)


class NoticeConsumptionProjectionStore(Protocol):
    def upsert_many(self, records: Sequence[NoticeConsumptionProjectionEntry]) -> None: ...

    def replace_scope(
        self,
        source_corpus: str,
        source_collection: str,
        records: Sequence[NoticeConsumptionProjectionEntry],
    ) -> None: ...

    def replace_notices(
        self,
        source_corpus: str,
        source_collection: str,
        notice_ids: Sequence[str],
        records: Sequence[NoticeConsumptionProjectionEntry],
    ) -> None: ...

    def list_by_scope(
        self,
        source_corpus: str,
        source_collection: str,
        *,
        notice_ids: Sequence[str] = (),
    ) -> tuple[NoticeConsumptionProjectionEntry, ...]: ...


def normalize_notice_ids(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(sorted({str(value).strip() for value in values if str(value).strip()}))


def is_notice_query_retained_consumption_status(value: str) -> bool:
    return str(value).strip() == NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY
