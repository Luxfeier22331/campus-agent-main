from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts.models_shared import (
    AllowedCorpus,
    RevisionTrack,
    SourceChannel,
    SourceTrustTier,
    VersionQueryMode,
    _normalize_source_trust_tier,
    _validate_collection,
    _validate_collection_scope,
    _validate_corpus,
    _validate_remote_content_suspicion_label,
    _validate_revision_track,
    _validate_source_channel,
    _validate_version_query_mode,
)


@dataclass(frozen=True, slots=True)
class KnowledgeScope:
    corpus: AllowedCorpus
    collection: str

    def __post_init__(self) -> None:
        _validate_corpus(self.corpus)
        _validate_collection(self.collection)
        _validate_collection_scope(self.corpus, self.collection)


@dataclass(frozen=True, slots=True)
class DocumentRef:
    document_id: str
    revision_track: RevisionTrack
    version_id: str
    corpus: AllowedCorpus
    collection: str
    source_uri: str
    content_hash: str

    def __post_init__(self) -> None:
        _validate_corpus(self.corpus)
        _validate_collection(self.collection)
        _validate_collection_scope(self.corpus, self.collection)
        _validate_revision_track(self.revision_track)


@dataclass(frozen=True, slots=True)
class EvidenceSource:
    doc_id: str
    revision_track: RevisionTrack
    version_id: str
    chunk_id: str
    anchor: dict[str, object]
    canonical_url: str
    latest_url: str
    source_channel: SourceChannel
    collection: str
    is_current: bool
    snippet: str
    score: float
    source_title: str = ""
    structural_path: tuple[str, ...] = field(default_factory=tuple)
    content_kind: str = ""
    content_role: str = ""
    detail_label: str = ""
    semantic_role: str = ""
    polarity: str = ""
    action_type: str = ""
    claim_type: str = ""
    audience_scope: str = ""
    article_no: str = ""
    clause_no: str = ""
    section_kind: str = ""
    is_answer_bearing: bool = False
    canonical_source_id: str = ""
    canonical_source_title: str = ""
    source_unit_kind: str = ""
    source_unit_key: str = ""
    source_trust_tier: SourceTrustTier | str = field(default="", compare=False)
    remote_content_suspicion_labels: tuple[str, ...] = field(default_factory=tuple, compare=False)

    def __post_init__(self) -> None:
        _validate_revision_track(self.revision_track)
        _validate_source_channel(self.source_channel)
        _validate_collection(self.collection)
        normalized_source_trust_tier = _normalize_source_trust_tier(
            self.source_trust_tier,
            collection=self.collection,
            source_channel=self.source_channel,
        )
        if normalized_source_trust_tier != self.source_trust_tier:
            object.__setattr__(self, "source_trust_tier", normalized_source_trust_tier)
        for label in self.remote_content_suspicion_labels:
            _validate_remote_content_suspicion_label(label)


@dataclass(frozen=True, slots=True)
class EvidenceBundle:
    corpus: AllowedCorpus
    collection: str
    query_text: str = ""
    sources: tuple[EvidenceSource, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        _validate_corpus(self.corpus)
        _validate_collection(self.collection)
        _validate_collection_scope(self.corpus, self.collection)
        for source in self.sources:
            normalized_source_trust_tier = _normalize_source_trust_tier(
                source.source_trust_tier,
                collection=source.collection or self.collection,
                source_channel=source.source_channel,
            )
            if normalized_source_trust_tier != source.source_trust_tier:
                object.__setattr__(source, "source_trust_tier", normalized_source_trust_tier)


@dataclass(frozen=True, slots=True)
class ErrorInfo:
    code: str
    message: str
    retryable: bool = False


@dataclass(frozen=True, slots=True)
class VersionQuery:
    mode: VersionQueryMode = "current"
    as_of: str = ""
    version_id: str = ""
    compare_to_version_id: str = ""

    def __post_init__(self) -> None:
        _validate_version_query_mode(self.mode)
        normalized_as_of = self.as_of.strip()
        normalized_version_id = self.version_id.strip()
        normalized_compare_to_version_id = self.compare_to_version_id.strip()
        if normalized_as_of != self.as_of:
            object.__setattr__(self, "as_of", normalized_as_of)
        if normalized_version_id != self.version_id:
            object.__setattr__(self, "version_id", normalized_version_id)
        if normalized_compare_to_version_id != self.compare_to_version_id:
            object.__setattr__(self, "compare_to_version_id", normalized_compare_to_version_id)
        if self.mode == "as_of":
            if not normalized_as_of:
                raise ValueError("as_of is required when version mode is as_of")
            if normalized_version_id:
                raise ValueError("version_id is not allowed when version mode is as_of")
            if normalized_compare_to_version_id:
                raise ValueError(
                    "compare_to_version_id is only allowed when version mode is compare"
                )
        elif normalized_as_of:
            raise ValueError("as_of is only allowed when version mode is as_of")
        if self.mode not in {"historical", "compare"} and normalized_version_id:
            raise ValueError(
                "version_id is only allowed when version mode is historical or compare"
            )
        if self.mode != "compare" and normalized_compare_to_version_id:
            raise ValueError("compare_to_version_id is only allowed when version mode is compare")
        if normalized_compare_to_version_id and not normalized_version_id:
            raise ValueError("version_id is required when compare_to_version_id is set")
